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
 * Build a Node KeyObject from a raw 32-byte Ed25519 seed (Buffer).
 * Uses RFC 8410 PKCS8 DER structure (fixed 15-byte header + 1-byte length + seed).
 */
function seedToKeyObject(seed) {
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  return crypto.createPrivateKey({
    key:    Buffer.concat([prefix, seed]),
    format: 'der',
    type:   'pkcs8',
  });
}

/**
 * Load the entity's Ed25519 device key from disk.
 *
 * Primary path: ~/.<entity>/id/devices/<device>/device.key
 *   — 64-char lowercase hex = 32-byte raw Ed25519 seed
 *
 * Falls back to first device directory found that contains device.key.
 * Returns { privateKey: KeyObject, fingerprint: string } or throws.
 */
function loadDeviceKey(idDir) {
  const devicesDir = path.join(idDir, 'devices');

  if (!fs.existsSync(devicesDir)) {
    throw new Error(`signing key not found at ${devicesDir}`);
  }

  // Prefer HOSTNAME or os.hostname(); fall back to first device dir
  const candidates = [];
  for (const h of [process.env.HOSTNAME, require('os').hostname()].filter(Boolean)) {
    candidates.push(h);
  }

  let deviceDir = null;
  for (const h of [...new Set(candidates)]) {
    const d = path.join(devicesDir, h);
    if (fs.existsSync(path.join(d, 'device.key'))) { deviceDir = d; break; }
  }

  if (!deviceDir) {
    const entries = fs.readdirSync(devicesDir, { withFileTypes: true });
    const found   = entries.find(
      e => e.isDirectory() && fs.existsSync(path.join(devicesDir, e.name, 'device.key'))
    );
    if (!found) throw new Error(`signing key not found at ${devicesDir}/<device>/device.key`);
    deviceDir = path.join(devicesDir, found.name);
  }

  const keyFilePath = path.join(deviceDir, 'device.key');
  const hexSeed     = fs.readFileSync(keyFilePath, 'utf8').trim();

  if (!/^[0-9a-fA-F]{64}$/.test(hexSeed)) {
    throw new Error(`signing key at ${keyFilePath} is not a 64-char hex seed`);
  }

  const privateKey = seedToKeyObject(Buffer.from(hexSeed, 'hex'));
  const publicKey  = crypto.createPublicKey(privateKey);

  // Fingerprint: hex SHA-256 of 32-byte raw Ed25519 public key
  const pubJwk      = publicKey.export({ format: 'jwk' });
  const pubRaw      = Buffer.from(pubJwk.x, 'base64url');
  const fingerprint = crypto.createHash('sha256').update(pubRaw).digest('hex');

  return { privateKey, fingerprint };
}

module.exports = async function sign_interaction(params = {}, context = {}) {
  try {
    // --- Input validation ---
    if (!VALID_INTERACTION_TYPES.has(params.interaction_type)) {
      return { error: `unknown interaction_type: ${params.interaction_type}` };
    }

    if (!params.visitor_id || !String(params.visitor_id).trim()) {
      return { error: 'visitor_id is required and must not be empty' };
    }

    // --- Resolve entity paths ---
    const entity    = context.entity    || process.env.ENTITY_NAME || 'unknown';
    const entityDir = path.join(context.entityBaseDir || process.env.HOME || '/home/koad', `.${entity}`);
    const idDir     = path.join(entityDir, 'id');

    // --- Load signing key ---
    let privateKey, fingerprint;
    try {
      ({ privateKey, fingerprint } = loadDeviceKey(idDir));
    } catch (e) {
      return { error: e.message };
    }

    // --- Build proof object (SPEC-193 §3 simplified harness schema) ---
    const timestamp = new Date().toISOString();
    const proof_id  = crypto.randomBytes(8).toString('hex'); // 16-char hex

    const proof = {
      version:          '1',
      entity:           entity,
      visitor_id:       String(params.visitor_id).trim(),
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

    // --- Compute kingdom-native CID of canonical payload bytes (VESTA-SPEC-147 §3.2) ---
    const cid = cidFromBytes(payloadBytes);

    // --- Assemble signed proof record ---
    const signedProof = {
      ...proof,
      issuer_fingerprint: fingerprint,
      signature,
      cid,
    };

    // --- Persist to ~/.<entity>/proofs/ ---
    const proofsDir   = path.join(entityDir, 'proofs');
    const indexPath   = path.join(proofsDir, 'index.jsonl');

    // Date-partitioned archival copy: proofs/issued/YYYY/MM/YYYY-MM-DD-<cid>.jsonl
    const dateSlice   = timestamp.slice(0, 10);
    const year        = timestamp.slice(0, 4);
    const month       = timestamp.slice(5, 7);
    const issuedDir   = path.join(proofsDir, 'issued', year, month);
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
  } catch (e) {
    return { error: e.message };
  }
};
