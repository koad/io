'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// Registered interaction type slugs per harness tool spec
const VALID_INTERACTION_TYPES = new Set([
  'greeting',
  'question-answered',
  'insight-acknowledged',
  'feedback-received',
  'idea-explored',
  'challenge-posed',
]);

// EASILY_RECOGNIZABLE alphabet — mirrors koad.generate.cid.fromBytes in global-helpers.js
// (VESTA-SPEC-147 §3.2)
const EASILY_RECOGNIZABLE = '23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Compute a 17-character kingdom-native CID from raw bytes.
 * SHA-256 of bytes → 17 chars mapped via EASILY_RECOGNIZABLE alphabet.
 */
function cidFromBytes(bytes) {
  const digest = crypto.createHash('sha256').update(bytes).digest();
  let cid = '';
  for (let i = 0; i < 17; i++) {
    cid += EASILY_RECOGNIZABLE[digest[i] % EASILY_RECOGNIZABLE.length];
  }
  return cid;
}

/**
 * Load the entity's Ed25519 device key from disk.
 *
 * Key location: ~/.<entity>/id/devices/<device>/device.key
 *   — 64-char hex string = 32-byte raw Ed25519 seed
 *
 * Prefers HOSTNAME env var to select device dir; falls back to first available.
 * Returns { privateKey: KeyObject, fingerprint: string } or throws with a
 * descriptive message the caller converts to { error }.
 */
function loadDeviceKey(idDir) {
  const devicesDir = path.join(idDir, 'devices');

  if (!fs.existsSync(devicesDir)) {
    throw new Error(`signing key not found at ${devicesDir}`);
  }

  // Prefer device matching HOSTNAME; fall back to first dir with a device.key
  const hostname = process.env.HOSTNAME || '';
  let deviceDir  = hostname ? path.join(devicesDir, hostname) : null;

  if (!deviceDir || !fs.existsSync(path.join(deviceDir, 'device.key'))) {
    const entries = fs.readdirSync(devicesDir, { withFileTypes: true });
    const found   = entries.find(
      e => e.isDirectory() && fs.existsSync(path.join(devicesDir, e.name, 'device.key'))
    );
    if (!found) {
      throw new Error(`signing key not found at ${devicesDir}/<device>/device.key`);
    }
    deviceDir = path.join(devicesDir, found.name);
  }

  const keyFilePath = path.join(deviceDir, 'device.key');
  const hexSeed     = fs.readFileSync(keyFilePath, 'utf8').trim();

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

// EASILY_RECOGNIZABLE alphabet — mirrors koad.generate.cid.fromBytes in global-helpers.js
// (VESTA-SPEC-147 §3.2)
const EASILY_RECOGNIZABLE = '23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * 17-character kingdom-native CID from raw bytes (SHA-256, EASILY_RECOGNIZABLE alphabet).
 */
function cidFromBytes(bytes) {
  const digest = crypto.createHash('sha256').update(bytes).digest();
  let cid = '';
  for (let i = 0; i < 17; i++) {
    cid += EASILY_RECOGNIZABLE[digest[i] % EASILY_RECOGNIZABLE.length];
  }
  return cid;
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

    if (!params.visitor_id || !String(params.visitor_id).trim()) {
      return { error: 'visitor_id is required and must not be empty' };
    }

    const entity    = context.entity || process.env.ENTITY_NAME;
    const entityDir = path.join(context.entityBaseDir || process.env.HOME || '/home/koad', `.${entity}`);
    const idDir     = path.join(entityDir, 'id');
    const { keyPath, expectedPath } = findSigningKey(idDir, entity);

    if (!keyPath) {
      return { error: `signing key not found at ${expectedPath}` };
    }

    const proof = {
      version:          '1',
      entity,
      visitor_id:       String(params.visitor_id).trim(),
      interaction_type: interactionType,
      brief_ref:        params.brief_ref    || null,
      context_note:     params.context_note || null,
      timestamp:        new Date().toISOString(),
      proof_id:         crypto.randomBytes(8).toString('hex'),
    };

    const canonicalJson  = JSON.stringify(proof, Object.keys(proof).sort());
    const payloadBytes   = Buffer.from(canonicalJson, 'utf8');
    let signature;

    try {
      const privateKey = loadPrivateKey(keyPath);
      signature = crypto.sign(null, payloadBytes, privateKey).toString('base64url');
    } catch (e) {
      return { error: `signing failed: ${e.message}` };
    }

    // Compute kingdom-native CID of canonical payload bytes (VESTA-SPEC-147 §3.2)
    const cid         = cidFromBytes(payloadBytes);
    const signedProof = { ...proof, signature, cid };

    // Persist to ~/.<entity>/proofs/
    const proofsDir  = path.join(entityDir, 'proofs');
    const indexPath  = path.join(proofsDir, 'index.jsonl');

    // Date-partitioned archival copy: proofs/issued/YYYY/MM/YYYY-MM-DD-<cid>.jsonl
    const dateSlice   = proof.timestamp.slice(0, 10);
    const year        = proof.timestamp.slice(0, 4);
    const month       = proof.timestamp.slice(5, 7);
    const issuedDir   = path.join(proofsDir, 'issued', year, month);
    const archivePath = path.join(issuedDir, `${dateSlice}-${cid}.jsonl`);

    if (!indexPath.startsWith(proofsDir + path.sep)) {
      return { error: 'path outside proofs directory' };
    }

    fs.mkdirSync(proofsDir,  { recursive: true });
    fs.mkdirSync(issuedDir,  { recursive: true });

    const line = JSON.stringify(signedProof) + '\n';
    fs.appendFileSync(indexPath,  line, 'utf8');
    fs.writeFileSync(archivePath, line, 'utf8');

    return signedProof;
  } catch (e) {
    return { error: e.message };
  }

  // --- Build proof object (SPEC-193 §3 simplified harness schema) ---
  const timestamp = new Date().toISOString();
  const proof_id  = crypto.randomBytes(8).toString('hex'); // 16-char hex

  const proof = {
    version:          '1',
    entity:           entity,
    visitor_id:       params.visitor_id.trim(),
    interaction_type: params.interaction_type,
    brief_ref:        params.brief_ref    || null,
    context_note:     params.context_note || null,
    timestamp:        timestamp,
    proof_id:         proof_id,
  };

  // Canonical JSON: sorted keys, no whitespace
  const canonicalJson = JSON.stringify(proof, Object.keys(proof).sort());
  const payloadBytes  = Buffer.from(canonicalJson, 'utf8');

  // --- Sign ---
  let signatureBytes;
  try {
    signatureBytes = crypto.sign(null, payloadBytes, privateKey);
  } catch (e) {
    return { error: `signing failed: ${e.message}` };
  }

  // base64url, no padding
  const signature = signatureBytes.toString('base64url').replace(/=/g, '');

  // --- Compute CID of canonical payload bytes ---
  const cid = cidFromBytes(payloadBytes);

  // --- Assemble signed proof record ---
  const signedProof = {
    ...proof,
    issuer_fingerprint: fingerprint,
    signature,
    cid,
  };

  // --- Persist to ~/.<entity>/proofs/ ---
  const proofsDir = path.join(entityDir, 'proofs');
  const indexPath = path.join(proofsDir, 'index.jsonl');

  // Date-partitioned archival copy: proofs/issued/YYYY/MM/YYYY-MM-DD-<cid>.jsonl
  const dateSlice  = timestamp.slice(0, 10);          // YYYY-MM-DD
  const year       = timestamp.slice(0, 4);
  const month      = timestamp.slice(5, 7);
  const issuedDir  = path.join(proofsDir, 'issued', year, month);
  const archivePath = path.join(issuedDir, `${dateSlice}-${cid}.jsonl`);

  try {
    if (!fs.existsSync(proofsDir)) fs.mkdirSync(proofsDir, { recursive: true });
    if (!fs.existsSync(issuedDir)) fs.mkdirSync(issuedDir, { recursive: true });

    const line = JSON.stringify(signedProof) + '\n';
    fs.appendFileSync(indexPath,   line, 'utf8');
    fs.writeFileSync(archivePath,  line, 'utf8');
  } catch (e) {
    return { error: `failed to persist proof: ${e.message}` };
  }

  return signedProof;
};
