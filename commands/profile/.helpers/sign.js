#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// sign.js — Ed25519 signing helper for sovereign profile sigchain entries.
// Implements VESTA-SPEC-111 §3 (canonical serialization, signing, CID computation).
//
// Usage (via stdin/stdout JSON protocol):
//   echo '{"op":"sign","entryPath":"/path/to/entry.json","keyPath":"/path/to/key"}' | node sign.js
//   echo '{"op":"verify","entryPath":"/path/to/entry.json","pubkeyPath":"/path/to/key.pub"}' | node sign.js
//   echo '{"op":"pubkey","keyPath":"/path/to/key.pub"}' | node sign.js
//   echo '{"op":"cid","bytes":"hex-encoded-bytes"}' | node sign.js
//   echo '{"op":"deviceKeyAdd","entry":{...},"deviceKeyPath":"/path/to/device.key","authKeyPath":"/path/to/root.key"}' | node sign.js
//
// Returns JSON on stdout. On error: {"error": "message", "code": "ERROR_CODE"}
// On success: {"ok": true, ...result fields}
//
// Key formats supported:
//   PEM PKCS8 (-----BEGIN PRIVATE KEY-----)  — e.g. sibyl's ed25519.key
//   OpenSSH   (-----BEGIN OPENSSH PRIVATE KEY-----) — e.g. astro's ed25519
//   OpenSSH public key (ssh-ed25519 BASE64 comment) — for verify
//   PEM SPKI  (-----BEGIN PUBLIC KEY-----)  — for verify
//
// Dependencies: Node built-in crypto only + @noble/ed25519 (CJS build from core package).
// No npm install required — uses existing packages in koad-io framework.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ── Noble ed25519 ─────────────────────────────────────────────────────────────

const NOBLE_PATH = path.join(
  __dirname,
  '../../../packages/core/.npm/package/node_modules/@noble/ed25519/lib/index.js'
);

let ed;
try {
  ed = require(NOBLE_PATH);
} catch (e) {
  fatal('NOBLE_LOAD_FAILED', `Failed to load @noble/ed25519 from ${NOBLE_PATH}: ${e.message}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fatal(code, msg) {
  process.stdout.write(JSON.stringify({ error: msg, code }) + '\n');
  process.exit(1);
}

function ok(result) {
  process.stdout.write(JSON.stringify({ ok: true, ...result }) + '\n');
  process.exit(0);
}

function toBase64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(pad), 'base64');
}

// ── Key loading ───────────────────────────────────────────────────────────────

/**
 * Load an Ed25519 private key from a file.
 * Supports:
 *   - PEM PKCS8 (-----BEGIN PRIVATE KEY-----)
 *   - OpenSSH   (-----BEGIN OPENSSH PRIVATE KEY-----)
 *
 * Returns: { seed: Buffer(32), pubkey: Buffer(32) }
 */
function loadPrivateKey(keyPath) {
  let keyData;
  try {
    keyData = fs.readFileSync(keyPath, 'utf8').trim();
  } catch (e) {
    fatal('KEY_READ_FAILED', `Cannot read key file: ${keyPath}: ${e.message}`);
  }

  if (keyData.startsWith('-----BEGIN PRIVATE KEY-----')) {
    // PEM PKCS8 format (e.g. sibyl's ed25519.key)
    try {
      const privKey = crypto.createPrivateKey(keyData);
      const der = privKey.export({ type: 'pkcs8', format: 'der' });
      // PKCS8 Ed25519 DER: 48 bytes total, last 32 = seed
      if (der.length < 32) {
        fatal('KEY_PARSE_FAILED', 'PKCS8 DER too short for Ed25519 key');
      }
      const seed = der.slice(-32);
      const pubKey = crypto.createPublicKey(privKey).export({ type: 'spki', format: 'der' });
      return { seed, pubkey: pubKey.slice(-32) };
    } catch (e) {
      fatal('KEY_PARSE_FAILED', `Failed to parse PKCS8 PEM key: ${e.message}`);
    }
  }

  if (keyData.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')) {
    // OpenSSH private key format
    // Structure: magic(15) + null(1) + ciphername + kdfname + kdfoptions + numkeys
    //            + pubkey_block + private_section
    // private_section: checkint1 + checkint2 + keytype + pub(32) + priv(64) + comment
    // priv[0:32] = seed, priv[32:64] = public key bytes
    try {
      const lines = keyData.split('\n');
      const b64 = lines.slice(1, -1).join('');
      const buf = Buffer.from(b64, 'base64');

      // 'openssh-key-v1\0' = 14 ASCII + 1 null = 15 bytes
      let offset = 15;

      function ru32() {
        const v = buf.readUInt32BE(offset);
        offset += 4;
        return v;
      }
      function rstr() {
        const len = ru32();
        const s = buf.slice(offset, offset + len);
        offset += len;
        return s;
      }

      const cipher = rstr().toString();
      rstr(); // kdfname
      rstr(); // kdfoptions
      const numkeys = ru32();

      if (cipher !== 'none') {
        fatal('KEY_ENCRYPTED', 'OpenSSH key is passphrase-encrypted; remove passphrase first');
      }
      if (numkeys !== 1) {
        fatal('KEY_MULTI', 'OpenSSH key file contains multiple keys; expected exactly 1');
      }

      rstr(); // pubkey block (skip — we'll get pub from private section)

      const privSec = rstr();
      let p = 0;
      function rp32() { const v = privSec.readUInt32BE(p); p += 4; return v; }
      function rpstr() { const len = rp32(); const s = privSec.slice(p, p + len); p += len; return s; }

      const ci1 = rp32();
      const ci2 = rp32();
      if (ci1 !== ci2) {
        fatal('KEY_CORRUPT', 'OpenSSH key: checkint mismatch — key data corrupted or passphrase required');
      }

      const keytype = rpstr().toString();
      if (keytype !== 'ssh-ed25519') {
        fatal('KEY_WRONG_TYPE', `Expected ssh-ed25519 key, got: ${keytype}`);
      }

      rpstr(); // public key bytes (32) — present but we read from priv section
      const privBytes = rpstr(); // 64 bytes: first 32 = seed, last 32 = pub

      if (privBytes.length < 64) {
        fatal('KEY_PARSE_FAILED', `OpenSSH ed25519 private key too short: ${privBytes.length} bytes`);
      }

      return {
        seed: privBytes.slice(0, 32),
        pubkey: privBytes.slice(32, 64),
      };
    } catch (e) {
      if (e.code && e.code.startsWith('KEY_')) throw e;
      fatal('KEY_PARSE_FAILED', `Failed to parse OpenSSH private key: ${e.message}`);
    }
  }

  fatal('KEY_FORMAT_UNKNOWN', `Unrecognized key format in ${keyPath}. Expected PEM PKCS8 or OpenSSH.`);
}

/**
 * Load an Ed25519 public key from a file.
 * Supports:
 *   - OpenSSH public key (ssh-ed25519 BASE64 comment)
 *   - PEM SPKI (-----BEGIN PUBLIC KEY-----)
 *
 * Returns: Buffer(32) raw public key bytes
 */
function loadPublicKey(pubkeyPath) {
  let data;
  try {
    data = fs.readFileSync(pubkeyPath, 'utf8').trim();
  } catch (e) {
    fatal('PUBKEY_READ_FAILED', `Cannot read public key file: ${pubkeyPath}: ${e.message}`);
  }

  if (data.startsWith('ssh-ed25519 ')) {
    // OpenSSH public key: 'ssh-ed25519 BASE64 comment'
    const parts = data.split(' ');
    if (parts.length < 2) {
      fatal('PUBKEY_PARSE_FAILED', 'Invalid OpenSSH public key line');
    }
    const keydata = Buffer.from(parts[1], 'base64');
    // Structure: uint32(11) + 'ssh-ed25519' + uint32(32) + raw_key_bytes
    const ktlen = keydata.readUInt32BE(0);
    const keyBytesOffset = 4 + ktlen + 4;
    const keylen = keydata.readUInt32BE(4 + ktlen);
    if (keylen !== 32) {
      fatal('PUBKEY_PARSE_FAILED', `Unexpected ed25519 public key length: ${keylen}`);
    }
    return keydata.slice(keyBytesOffset, keyBytesOffset + 32);
  }

  if (data.startsWith('-----BEGIN PUBLIC KEY-----')) {
    // PEM SPKI format
    try {
      const pk = crypto.createPublicKey(data);
      const der = pk.export({ type: 'spki', format: 'der' });
      return der.slice(-32);
    } catch (e) {
      fatal('PUBKEY_PARSE_FAILED', `Failed to parse PEM public key: ${e.message}`);
    }
  }

  fatal('PUBKEY_FORMAT_UNKNOWN', `Unrecognized public key format in ${pubkeyPath}`);
}

// ── Canonical pre-image ───────────────────────────────────────────────────────

/**
 * Produce the canonical dag-json pre-image for signing (SPEC-111 §3.2).
 * Fields sorted lexicographically: entity, payload, previous, timestamp, type, version.
 * The `signature` field is intentionally absent.
 * Payload sub-fields are also sorted.
 *
 * For SPEC-111 entries (no IPLD special types), dag-json encoding is equivalent
 * to JSON.stringify of a key-sorted object. Whitespace-free.
 */
function sortKeysDeep(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const sorted = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = sortKeysDeep(obj[k]);
  }
  return sorted;
}

function canonicalPreImage(entry) {
  // Remove signature field; sort all keys
  const { signature, ...withoutSig } = entry;
  return Buffer.from(JSON.stringify(sortKeysDeep(withoutSig)));
}

// ── CID computation ───────────────────────────────────────────────────────────

/**
 * Encode a number as unsigned varint (LEB128).
 */
function encodeVarint(n) {
  const bytes = [];
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n = n >>> 7;
  }
  bytes.push(n & 0x7f);
  return Buffer.from(bytes);
}

/**
 * Encode bytes as base32lowercase (multibase 'b' prefix).
 * CIDv1 default display is base32lowercase.
 */
function base32lower(bytes) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  let result = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) result += alphabet[(value << (5 - bits)) & 0x1f];
  return result;
}

/**
 * Compute a CIDv1 (dag-json codec 0x0129, sha2-256) from the given bytes.
 * Per SPEC-111 §3.1: returns base32lowercase CIDv1 string with 'b' multibase prefix.
 * Resulting CIDs have the 'bagu' prefix per spec convention.
 *
 * @param {Buffer} bytes — the dag-json bytes of the signed entry
 * @returns {string} — CIDv1 base32lower string, e.g. "baguczsaa..."
 */
function computeCID(bytes) {
  const digest = crypto.createHash('sha256').update(bytes).digest();

  // CIDv1 binary: version(varint 1) + codec(varint 0x0129) + multihash
  // multihash: code(varint 0x12 = sha2-256) + len(varint 32) + digest(32 bytes)
  const version = Buffer.from([0x01]);
  const codec = encodeVarint(0x0129); // dag-json
  const mhCode = encodeVarint(0x12);  // sha2-256
  const mhLen = encodeVarint(32);
  const multihash = Buffer.concat([mhCode, mhLen, digest]);
  const cidBytes = Buffer.concat([version, codec, multihash]);

  return 'b' + base32lower(cidBytes);
}

// ── Operations ────────────────────────────────────────────────────────────────

async function opSign(req) {
  // Load entry
  let entry;
  if (req.entry) {
    entry = req.entry;
  } else if (req.entryPath) {
    try {
      entry = JSON.parse(fs.readFileSync(req.entryPath, 'utf8'));
    } catch (e) {
      fatal('ENTRY_READ_FAILED', `Cannot read entry file: ${req.entryPath}: ${e.message}`);
    }
  } else {
    fatal('MISSING_PARAM', 'sign requires "entry" object or "entryPath" string');
  }

  if (!req.keyPath) {
    fatal('MISSING_PARAM', 'sign requires "keyPath"');
  }

  // Load key
  const { seed, pubkey } = loadPrivateKey(req.keyPath);

  // Canonical pre-image (signature field absent)
  const preImage = canonicalPreImage(entry);

  // Sign
  const sigBytes = await ed.sign(preImage, seed);
  const signature = toBase64Url(sigBytes);

  // Build signed entry (add signature field; keep all other fields)
  const signedEntry = { ...entry, signature };

  // Compute CID of the signed entry
  const entryBytes = Buffer.from(JSON.stringify(sortKeysDeep(signedEntry)));
  const cid = computeCID(entryBytes);

  ok({
    signedEntry,
    cid,
    pubkeyBase64Url: toBase64Url(pubkey),
  });
}

async function opVerify(req) {
  // Load signed entry
  let entry;
  if (req.entry) {
    entry = req.entry;
  } else if (req.entryPath) {
    try {
      entry = JSON.parse(fs.readFileSync(req.entryPath, 'utf8'));
    } catch (e) {
      fatal('ENTRY_READ_FAILED', `Cannot read entry file: ${req.entryPath}: ${e.message}`);
    }
  } else {
    fatal('MISSING_PARAM', 'verify requires "entry" object or "entryPath" string');
  }

  if (!req.pubkeyPath && !req.pubkeyBase64Url) {
    fatal('MISSING_PARAM', 'verify requires "pubkeyPath" or "pubkeyBase64Url"');
  }

  // Load public key
  let rawPub;
  if (req.pubkeyBase64Url) {
    rawPub = fromBase64Url(req.pubkeyBase64Url);
  } else {
    rawPub = loadPublicKey(req.pubkeyPath);
  }

  // Recompute CID from entry bytes (verify content integrity)
  const entryBytes = Buffer.from(JSON.stringify(sortKeysDeep(entry)));
  const computedCid = computeCID(entryBytes);

  // Extract signature
  if (!entry.signature) {
    fatal('MISSING_SIGNATURE', 'Entry has no signature field');
  }
  const sigBytes = fromBase64Url(entry.signature);

  // Canonical pre-image (without signature)
  const preImage = canonicalPreImage(entry);

  // Verify
  let valid;
  try {
    valid = await ed.verify(sigBytes, preImage, rawPub);
  } catch (e) {
    fatal('VERIFY_ERROR', `Signature verification error: ${e.message}`);
  }

  ok({
    valid,
    cid: computedCid,
    type: entry.type,
    entity: entry.entity,
    timestamp: entry.timestamp,
    previous: entry.previous,
  });
}

function opPubkey(req) {
  if (!req.keyPath) {
    fatal('MISSING_PARAM', 'pubkey requires "keyPath"');
  }

  // Try as private key first (extract pub from it)
  const keyData = fs.readFileSync(req.keyPath, 'utf8').trim();

  if (keyData.startsWith('ssh-ed25519 ') || keyData.startsWith('-----BEGIN PUBLIC KEY-----')) {
    // It's a public key file
    const rawPub = loadPublicKey(req.keyPath);
    ok({ pubkeyBase64Url: toBase64Url(rawPub), pubkeyHex: rawPub.toString('hex') });
  } else {
    // It's a private key file
    const { pubkey } = loadPrivateKey(req.keyPath);
    ok({ pubkeyBase64Url: toBase64Url(pubkey), pubkeyHex: pubkey.toString('hex') });
  }
}

function opCid(req) {
  if (!req.entry && !req.bytes) {
    fatal('MISSING_PARAM', 'cid requires "entry" object or "bytes" hex string');
  }

  let bytes;
  if (req.entry) {
    bytes = Buffer.from(JSON.stringify(sortKeysDeep(req.entry)));
  } else {
    bytes = Buffer.from(req.bytes, 'hex');
  }

  ok({ cid: computeCID(bytes) });
}

/**
 * deviceKeyAdd — implement the SPEC-111 §5.4.1 reverse_sig two-step protocol.
 *
 * Input:
 *   req.entry         — the koad.device-key-add entry WITHOUT reverse_sig and WITHOUT signature
 *   req.deviceKeyPath — path to the new device's private key (signs first → reverse_sig)
 *   req.authKeyPath   — path to the authorizing key (root or authorized device key)
 *
 * Protocol (per SPEC-111 §5.4.1):
 *   1. Build entry with payload sans reverse_sig
 *   2. Device key signs canonical pre-image → reverse_sig
 *   3. Add reverse_sig to payload
 *   4. Authorizing key signs full pre-image → signature
 *   5. Compute final CID
 *
 * Output (ok):
 *   signedEntry        — complete signed koad.device-key-add entry
 *   cid                — CIDv1 of the final entry
 *   reverseSig         — the reverse_sig value (for inspection)
 *   devicePubkeyB64Url — device public key (base64url)
 *   authPubkeyB64Url   — authorizing public key (base64url)
 */
async function opDeviceKeyAdd(req) {
  if (!req.entry) {
    fatal('MISSING_PARAM', 'deviceKeyAdd requires "entry" object');
  }
  if (!req.deviceKeyPath) {
    fatal('MISSING_PARAM', 'deviceKeyAdd requires "deviceKeyPath"');
  }
  if (!req.authKeyPath) {
    fatal('MISSING_PARAM', 'deviceKeyAdd requires "authKeyPath"');
  }

  // Validate entry type
  if (req.entry.type !== 'koad.device-key-add') {
    fatal('WRONG_ENTRY_TYPE', `Expected type koad.device-key-add, got: ${req.entry.type}`);
  }

  // Load keys
  const { seed: deviceSeed, pubkey: devicePubkey } = loadPrivateKey(req.deviceKeyPath);
  const { seed: authSeed,   pubkey: authPubkey   } = loadPrivateKey(req.authKeyPath);

  // Step 1: build entry WITHOUT reverse_sig in payload
  const payloadWithoutReverseSig = { ...req.entry.payload };
  delete payloadWithoutReverseSig.reverse_sig;

  const entryWithoutReverseSig = {
    entity:    req.entry.entity,
    payload:   payloadWithoutReverseSig,
    previous:  req.entry.previous,
    timestamp: req.entry.timestamp,
    type:      req.entry.type,
    version:   req.entry.version,
  };

  // Step 2: device key signs the pre-image (signature field absent via canonicalPreImage)
  const preImageForDevice = canonicalPreImage(entryWithoutReverseSig);
  const reverseSigBytes   = await ed.sign(preImageForDevice, deviceSeed);
  const reverseSig        = toBase64Url(reverseSigBytes);

  // Step 3: add reverse_sig to payload
  const fullPayload = {
    ...payloadWithoutReverseSig,
    reverse_sig: reverseSig,
  };

  const fullEntry = {
    entity:    req.entry.entity,
    payload:   fullPayload,
    previous:  req.entry.previous,
    timestamp: req.entry.timestamp,
    type:      req.entry.type,
    version:   req.entry.version,
  };

  // Step 4: authorizing key signs full pre-image (reverse_sig present, signature absent)
  const preImageForAuth = canonicalPreImage(fullEntry);
  const sigBytes        = await ed.sign(preImageForAuth, authSeed);
  const signature       = toBase64Url(sigBytes);

  // Build final signed entry
  const signedEntry = { ...fullEntry, signature };

  // Step 5: compute CID
  const entryBytes = Buffer.from(JSON.stringify(sortKeysDeep(signedEntry)));
  const cid        = computeCID(entryBytes);

  ok({
    signedEntry,
    cid,
    reverseSig,
    devicePubkeyB64Url: toBase64Url(devicePubkey),
    authPubkeyB64Url:   toBase64Url(authPubkey),
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  let req;
  try {
    req = JSON.parse(input.trim());
  } catch (e) {
    fatal('INVALID_INPUT', `Invalid JSON input: ${e.message}`);
  }

  if (!req.op) {
    fatal('MISSING_OP', 'Request must include "op" field: sign | verify | pubkey | cid');
  }

  switch (req.op) {
    case 'sign':
      opSign(req).catch(e => fatal('INTERNAL', e.message));
      break;
    case 'verify':
      opVerify(req).catch(e => fatal('INTERNAL', e.message));
      break;
    case 'pubkey':
      opPubkey(req);
      break;
    case 'cid':
      opCid(req);
      break;
    case 'deviceKeyAdd':
      opDeviceKeyAdd(req).catch(e => fatal('INTERNAL', e.message));
      break;
    default:
      fatal('UNKNOWN_OP', `Unknown op: ${req.op}. Valid: sign | verify | pubkey | cid | deviceKeyAdd`);
  }
});
