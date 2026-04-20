// SPDX-License-Identifier: AGPL-3.0-or-later
//
// keystore.js — File-based entity keystore reader for the daemon context
// Consumer: daemon / server-side sovereign-profiles API
//
// Reads Ed25519 keys from the entity's id/ directory (OpenSSH format on disk).
// Entry point: SovereignProfileKeystore.readEntityKeys(entityDir)
//
// Entity dir layout (per koad:io entity convention):
//   <entityDir>/id/ed25519      — OpenSSH private key (Ed25519)
//   <entityDir>/id/ed25519.pub  — OpenSSH public key
//   <entityDir>/passenger.json  — entity manifest (name, version, etc.)
//
// The keystore does NOT hold keys in memory beyond the call — it reads on demand.
// Callers are responsible for zeroizing private key material after use.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── OpenSSH key parsing ───────────────────────────────────────────────────────

// OpenSSH private key file format (unencrypted Ed25519):
//   -----BEGIN OPENSSH PRIVATE KEY-----
//   <base64 blob>
//   -----END OPENSSH PRIVATE KEY-----
//
// The blob decodes to:
//   "openssh-key-v1\0"  (15 bytes + null)
//   uint32 ciphername_len + ciphername ("none")
//   uint32 kdfname_len  + kdfname ("none")
//   uint32 kdfoptions_len (0)
//   uint32 nkeys (1)
//   uint32 pubkey_len
//     uint32 keytype_len + keytype ("ssh-ed25519")
//     uint32 pub_len (32) + pub_bytes
//   uint32 private_len
//     uint32 check1
//     uint32 check2
//     uint32 keytype_len + keytype ("ssh-ed25519")
//     uint32 pub_len (32) + pub_bytes
//     uint32 priv_len (64) + priv_bytes  ← first 32 = seed, last 32 = pub
//     uint32 comment_len + comment
//     padding bytes

/**
 * Read a big-endian uint32 from a Buffer at the given offset.
 * @param {Buffer} buf
 * @param {number} offset
 * @returns {{ value: number, next: number }}
 */
function readUint32(buf, offset) {
  const value = buf.readUInt32BE(offset);
  return { value, next: offset + 4 };
}

/**
 * Read a length-prefixed byte string from a Buffer.
 * @param {Buffer} buf
 * @param {number} offset
 * @returns {{ data: Buffer, next: number }}
 */
function readBytes(buf, offset) {
  const { value: len, next } = readUint32(buf, offset);
  return { data: buf.slice(next, next + len), next: next + len };
}

/**
 * Parse an unencrypted OpenSSH Ed25519 private key blob.
 * Returns the 32-byte seed (private key scalar) and 32-byte public key.
 *
 * Throws if the key is encrypted (passphrase-protected) or not Ed25519.
 *
 * @param {Buffer} keyBlob — raw base64-decoded OpenSSH key blob
 * @returns {{ seedBytes: Buffer, pubKeyBytes: Buffer }}
 */
function parseOpenSSHEd25519PrivKey(keyBlob) {
  const MAGIC = 'openssh-key-v1\0';
  const magicBuf = Buffer.from(MAGIC, 'ascii');

  if (!keyBlob.slice(0, magicBuf.length).equals(magicBuf)) {
    throw new Error('keystore: not an OpenSSH private key file (bad magic)');
  }

  let pos = magicBuf.length;

  // ciphername
  const { data: ciphernameBuf, next: p1 } = readBytes(keyBlob, pos);
  pos = p1;
  const ciphername = ciphernameBuf.toString('utf8');
  if (ciphername !== 'none') {
    throw new Error(`keystore: encrypted keys are not supported (cipher: ${ciphername}). Decrypt the key first.`);
  }

  // kdfname
  const { next: p2 } = readBytes(keyBlob, pos);
  pos = p2;

  // kdfoptions
  const { next: p3 } = readBytes(keyBlob, pos);
  pos = p3;

  // nkeys
  const { value: nkeys, next: p4 } = readUint32(keyBlob, pos);
  pos = p4;
  if (nkeys !== 1) {
    throw new Error(`keystore: expected 1 key, got ${nkeys}`);
  }

  // public key block (skip — we extract pub from private block)
  const { next: p5 } = readBytes(keyBlob, pos);
  pos = p5;

  // private key block
  const { data: privBlock, next: p6 } = readBytes(keyBlob, pos);
  pos = p6; // pos unused after this

  // parse private block
  let pp = 0;

  // check1, check2 (must match — both are the same random uint32)
  const check1 = privBlock.readUInt32BE(pp); pp += 4;
  const check2 = privBlock.readUInt32BE(pp); pp += 4;
  if (check1 !== check2) {
    throw new Error('keystore: private key check bytes mismatch — key may be corrupted');
  }

  // keytype
  const { data: keytypeBuf, next: pp2 } = readBytes(privBlock, pp);
  pp = pp2;
  const keytype = keytypeBuf.toString('utf8');
  if (keytype !== 'ssh-ed25519') {
    throw new Error(`keystore: expected ssh-ed25519, got ${keytype}`);
  }

  // public key (32 bytes)
  const { data: pubKeyBytes, next: pp3 } = readBytes(privBlock, pp);
  pp = pp3;

  // private key (64 bytes: first 32 = seed, last 32 = pub key copy)
  const { data: privKeyBytes, next: _pp4 } = readBytes(privBlock, pp);

  if (privKeyBytes.length !== 64) {
    throw new Error(`keystore: expected 64 private key bytes, got ${privKeyBytes.length}`);
  }
  if (pubKeyBytes.length !== 32) {
    throw new Error(`keystore: expected 32 public key bytes, got ${pubKeyBytes.length}`);
  }

  // seed = first 32 bytes of the 64-byte private key blob
  const seedBytes = privKeyBytes.slice(0, 32);

  return { seedBytes, pubKeyBytes };
}

/**
 * Parse an OpenSSH Ed25519 public key string.
 * Supports "ssh-ed25519 <base64> <comment>" format.
 *
 * @param {string} pubkeyStr — contents of ed25519.pub
 * @returns {Buffer} — 32-byte public key
 */
function parseOpenSSHPubKey(pubkeyStr) {
  const parts = pubkeyStr.trim().split(/\s+/);
  if (parts.length < 2) {
    throw new Error('keystore: invalid OpenSSH public key format');
  }
  const [keytype, b64] = parts;
  if (keytype !== 'ssh-ed25519') {
    throw new Error(`keystore: expected ssh-ed25519 public key, got ${keytype}`);
  }

  const blob = Buffer.from(b64, 'base64');

  // OpenSSH public key blob: uint32 namelen + name + uint32 keylen + keybytes
  let pos = 0;
  const { next: p1 } = readBytes(blob, pos);
  pos = p1; // skip key type name
  const { data: keyBytes } = readBytes(blob, pos);

  if (keyBytes.length !== 32) {
    throw new Error(`keystore: expected 32-byte Ed25519 public key, got ${keyBytes.length}`);
  }

  return keyBytes;
}

// ── Public API ────────────────────────────────────────────────────────────────

const SovereignProfileKeystore = {};

/**
 * Read entity keys from the file-based keystore at <entityDir>/id/.
 * Returns both the seed (private key scalar) and public key as Uint8Array.
 *
 * The returned key material is NOT cached — read on demand, zeroize after use.
 *
 * @param {string} entityDir — absolute path to entity home dir (e.g. /home/koad/.juno)
 * @returns {{ seedBytes: Uint8Array, pubKeyBytes: Uint8Array, entityName: string }}
 */
SovereignProfileKeystore.readEntityKeys = function(entityDir) {
  const idDir = path.join(entityDir, 'id');
  const privKeyPath = path.join(idDir, 'ed25519');
  const pubKeyPath  = path.join(idDir, 'ed25519.pub');

  if (!fs.existsSync(privKeyPath)) {
    throw new Error(`keystore: private key not found at ${privKeyPath}`);
  }

  const privKeyPem = fs.readFileSync(privKeyPath, 'utf8');

  // Strip PEM headers and decode base64
  const b64 = privKeyPem
    .replace('-----BEGIN OPENSSH PRIVATE KEY-----', '')
    .replace('-----END OPENSSH PRIVATE KEY-----', '')
    .replace(/\s+/g, '');

  const keyBlob = Buffer.from(b64, 'base64');
  const { seedBytes, pubKeyBytes } = parseOpenSSHEd25519PrivKey(keyBlob);

  // Also read passenger.json for entity name if present
  let entityName = path.basename(entityDir).replace(/^\./, '');
  const passengerPath = path.join(entityDir, 'passenger.json');
  if (fs.existsSync(passengerPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(passengerPath, 'utf8'));
      if (manifest.name) entityName = manifest.name;
    } catch (_) {
      // non-fatal: use dir name fallback
    }
  }

  return {
    seedBytes: new Uint8Array(seedBytes),
    pubKeyBytes: new Uint8Array(pubKeyBytes),
    entityName,
  };
};

/**
 * Read only the public key from <entityDir>/id/ed25519.pub.
 * Does not touch the private key file. Safe to call without elevated perms.
 *
 * @param {string} entityDir
 * @returns {Uint8Array} — 32-byte Ed25519 public key
 */
SovereignProfileKeystore.readPublicKey = function(entityDir) {
  const pubKeyPath = path.join(entityDir, 'id', 'ed25519.pub');

  if (!fs.existsSync(pubKeyPath)) {
    throw new Error(`keystore: public key not found at ${pubKeyPath}`);
  }

  const pubKeyStr = fs.readFileSync(pubKeyPath, 'utf8');
  return new Uint8Array(parseOpenSSHPubKey(pubKeyStr));
};

/**
 * Compose a profile object from an entity directory.
 * Reads keys + passenger.json, returns an object ready for SovereignProfile.genesis()
 * and SovereignProfile.create().
 *
 * @param {string} entityDir — absolute path to entity home dir
 * @returns {{ entityName: string, pubKeyBytes: Uint8Array, seedBytes: Uint8Array, manifest: object }}
 */
SovereignProfileKeystore.fromEntityDir = function(entityDir) {
  const { seedBytes, pubKeyBytes, entityName } = SovereignProfileKeystore.readEntityKeys(entityDir);

  let manifest = {};
  const passengerPath = path.join(entityDir, 'passenger.json');
  if (fs.existsSync(passengerPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(passengerPath, 'utf8'));
    } catch (_) {
      // non-fatal
    }
  }

  return { entityName, pubKeyBytes, seedBytes, manifest };
};

// Attach to globalThis for cross-file access in Meteor server context
globalThis.SovereignProfileKeystore = SovereignProfileKeystore;

export { SovereignProfileKeystore };
