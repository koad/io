'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const INTERACTION_TYPES = new Set([
  'greeting',
  'question-answered',
  'insight-acknowledged',
  'feedback-received',
  'idea-explored',
  'challenge-posed',
]);

const KEY_FILENAMES = [
  'ed25519_private.pem',
  'ed25519.pem',
  'ed25519',
  'id_ed25519',
  'interaction-issuer.pem',
  'interaction_issuer.pem',
  'interaction-issuer_private.pem',
  'entity_ed25519_private.pem',
];

function readUint32(buffer, offset) {
  if (offset + 4 > buffer.length) {
    throw new Error('truncated OpenSSH private key');
  }
  return buffer.readUInt32BE(offset);
}

function readString(buffer, offset) {
  const length = readUint32(buffer, offset);
  const start = offset + 4;
  const end = start + length;
  if (end > buffer.length) {
    throw new Error('truncated OpenSSH private key');
  }
  return { value: buffer.subarray(start, end), offset: end };
}

function ed25519SeedToKeyObject(seed) {
  if (!Buffer.isBuffer(seed) || seed.length !== 32) {
    throw new Error('Ed25519 seed must be 32 bytes');
  }

  // RFC 8410 PKCS#8 DER wrapper for a raw Ed25519 private key seed.
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  return crypto.createPrivateKey({
    key: Buffer.concat([prefix, seed]),
    format: 'der',
    type: 'pkcs8',
  });
}

function loadOpenSshEd25519PrivateKey(pem) {
  const b64 = pem
    .replace(/-----BEGIN OPENSSH PRIVATE KEY-----/g, '')
    .replace(/-----END OPENSSH PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const buffer = Buffer.from(b64, 'base64');
  const magic = Buffer.from('openssh-key-v1\0', 'utf8');

  if (!buffer.subarray(0, magic.length).equals(magic)) {
    throw new Error('invalid OpenSSH private key');
  }

  let offset = magic.length;
  let part = readString(buffer, offset);
  const ciphername = part.value.toString('utf8');
  offset = part.offset;

  part = readString(buffer, offset);
  const kdfname = part.value.toString('utf8');
  offset = part.offset;

  part = readString(buffer, offset); // kdf options
  offset = part.offset;

  const nkeys = readUint32(buffer, offset);
  offset += 4;

  if (ciphername !== 'none' || kdfname !== 'none') {
    throw new Error('encrypted OpenSSH private keys are not supported');
  }
  if (nkeys !== 1) {
    throw new Error(`unsupported OpenSSH key count: ${nkeys}`);
  }

  part = readString(buffer, offset); // public key blob
  offset = part.offset;

  part = readString(buffer, offset);
  const privateBlob = part.value;
  offset = 0;

  const check1 = readUint32(privateBlob, offset);
  offset += 4;
  const check2 = readUint32(privateBlob, offset);
  offset += 4;
  if (check1 !== check2) {
    throw new Error('invalid OpenSSH private key checkints');
  }

  part = readString(privateBlob, offset);
  const keytype = part.value.toString('utf8');
  offset = part.offset;
  if (keytype !== 'ssh-ed25519') {
    throw new Error(`unsupported OpenSSH key type: ${keytype}`);
  }

  part = readString(privateBlob, offset); // public key
  offset = part.offset;

  part = readString(privateBlob, offset);
  const privateKey = part.value;
  if (privateKey.length !== 64) {
    throw new Error('invalid OpenSSH Ed25519 private key length');
  }

  return ed25519SeedToKeyObject(privateKey.subarray(0, 32));
}

function loadRawSeedKey(data) {
  if (data.length === 32) {
    return ed25519SeedToKeyObject(data);
  }

  const text = data.toString('utf8').trim();
  if (/^[0-9a-fA-F]{64}$/.test(text)) {
    return ed25519SeedToKeyObject(Buffer.from(text, 'hex'));
  }

  const normalized = text.replace(/-/g, '+').replace(/_/g, '/');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    const decoded = Buffer.from(normalized, 'base64');
    if (decoded.length === 32) {
      return ed25519SeedToKeyObject(decoded);
    }
  }

  throw new Error('unsupported Ed25519 private key format');
}

function loadPrivateKey(keyPath) {
  const data = fs.readFileSync(keyPath);
  const text = data.toString('utf8');

  try {
    return crypto.createPrivateKey(data);
  } catch (createPrivateKeyError) {
    if (text.includes('BEGIN OPENSSH PRIVATE KEY')) {
      return loadOpenSshEd25519PrivateKey(text);
    }

    try {
      return loadRawSeedKey(data);
    } catch (rawSeedError) {
      throw createPrivateKeyError;
    }
  }
}

function deviceKeyCandidates(idDir) {
  const devicesDir = path.join(idDir, 'devices');
  const candidates = [];
  const hostnames = [process.env.HOSTNAME, require('os').hostname()].filter(Boolean);

  for (const hostname of [...new Set(hostnames)]) {
    candidates.push(path.join(devicesDir, hostname, 'device.key'));
  }

  if (fs.existsSync(devicesDir)) {
    for (const entry of fs.readdirSync(devicesDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        candidates.push(path.join(devicesDir, entry.name, 'device.key'));
      }
    }
  }

  return [...new Set(candidates)];
}

function signingKeyCandidates(idDir, entity) {
  const candidates = deviceKeyCandidates(idDir);
  for (const filename of KEY_FILENAMES) {
    candidates.push(path.join(idDir, filename));
  }
  if (entity) {
    candidates.push(
      path.join(idDir, `${entity}_ed25519`),
      path.join(idDir, `${entity}_ed25519.pem`),
      path.join(idDir, `${entity}_ed25519_private.pem`)
    );
  }
  return [...new Set(candidates)];
}

function findSigningKey(idDir, entity) {
  const candidates = signingKeyCandidates(idDir, entity);
  return {
    keyPath: candidates.find(candidate => fs.existsSync(candidate)) || null,
    expectedPath: candidates[0] || path.join(idDir, KEY_FILENAMES[0]),
  };
}

module.exports = async function sign_interaction(params = {}, context = {}) {
  try {
    const interactionType = params.interaction_type;
    if (!INTERACTION_TYPES.has(interactionType)) {
      return { error: `unknown interaction_type: ${interactionType}` };
    }

    const entity = context.entity || process.env.ENTITY_NAME;
    const entityDir = path.join(context.entityBaseDir || process.env.HOME || '/home/koad', `.${entity}`);
    const idDir = path.join(entityDir, 'id');
    const { keyPath, expectedPath } = findSigningKey(idDir, entity);

    if (!keyPath) {
      return { error: `signing key not found at ${expectedPath}` };
    }

    const proof = {
      version: '1',
      entity,
      visitor_id: params.visitor_id,
      interaction_type: interactionType,
      brief_ref: params.brief_ref || null,
      context_note: params.context_note || null,
      timestamp: new Date().toISOString(),
      proof_id: crypto.randomBytes(8).toString('hex'),
    };

    const canonicalJson = JSON.stringify(proof, Object.keys(proof).sort());
    let signature;

    try {
      const privateKey = loadPrivateKey(keyPath);
      signature = crypto
        .sign(null, Buffer.from(canonicalJson, 'utf8'), privateKey)
        .toString('base64url');
    } catch (e) {
      return { error: `signing failed: ${e.message}` };
    }

    const signedProof = { ...proof, signature };
    const proofsDir = path.join(entityDir, 'proofs');
    const indexPath = path.join(proofsDir, 'index.jsonl');

    if (!indexPath.startsWith(proofsDir + path.sep)) {
      return { error: 'path outside proofs directory' };
    }

    fs.mkdirSync(proofsDir, { recursive: true });
    fs.appendFileSync(indexPath, `${JSON.stringify(signedProof)}\n`, 'utf8');

    return signedProof;
  } catch (e) {
    return { error: e.message };
  }
};
