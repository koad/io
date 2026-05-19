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

  if (!/^[0-9a-fA-F]{64}$/.test(hexSeed)) {
    throw new Error(`signing key at ${keyFilePath} is not a 64-char hex seed`);
  }

  const seedBytes = Buffer.from(hexSeed, 'hex');

  // Build PKCS8 DER for Ed25519 from raw 32-byte seed (RFC 8410).
  // Fixed header: SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.112 }, OCTET STRING { OCTET STRING <seed> } }
  const pkcs8Header = Buffer.from('302e020100300506032b6570042204', 'hex');
  const pkcs8Der    = Buffer.concat([pkcs8Header, Buffer.from('20', 'hex'), seedBytes]);

  const privateKey = crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  const publicKey  = crypto.createPublicKey(privateKey);

  // Fingerprint: hex SHA-256 of the 32-byte raw public key
  const pubJwk    = publicKey.export({ format: 'jwk' });
  const pubRaw    = Buffer.from(pubJwk.x, 'base64url');
  const fingerprint = crypto.createHash('sha256').update(pubRaw).digest('hex');

  return { privateKey, fingerprint };
}

module.exports = async function sign_interaction(params, context) {
  // --- Input validation ---
  if (!VALID_INTERACTION_TYPES.has(params.interaction_type)) {
    return { error: `unknown interaction_type: ${params.interaction_type}` };
  }

  if (!params.visitor_id || !params.visitor_id.trim()) {
    return { error: 'visitor_id is required and must not be empty' };
  }

  // --- Resolve paths ---
  const baseDir   = context.entityBaseDir || process.env.HOME || '/home/koad';
  const entity    = context.entity        || process.env.ENTITY_NAME || 'unknown';
  const entityDir = path.join(baseDir, `.${entity}`);
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
