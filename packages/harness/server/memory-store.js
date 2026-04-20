// MemoryStore — VESTA-SPEC-134 §4.2 (write path) + §4.3 (read path) — Phase 2
//
// write(plaintext, metadata, kek) → { cid, wrapped_dek, blob_size }
// read(cid, wrapped_dek, kek)    → Uint8Array (plaintext bytes)
//
// The IPFS backend is pluggable. Phase 2 uses MockIPFS (Mongo-backed).
// Phase 6 swaps in the real kingdom gateway client.
//
// SPEC-134 §6.4 — KEY_ROTATION_REQUIRED:
//   unwrapDEK failure surfaces as 'KEY_ROTATION_REQUIRED' error code
//   (distinguishable from generic decrypt error, not shown to user as a failure).
//
// This module runs server-side. The DEK wrap/unwrap uses the server's Node crypto
// via the Web Crypto API (available in Meteor 3 / Node 22 globalThis.crypto).

import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

// ── MockIPFS — Mongo-backed synthetic CID store ───────────────────────────────
// Synthetic CID = SHA-256 hex of the padded ciphertext bytes.
// Phase 6 swaps this for the real kingdom gateway client (koad:io-ipfs-client).

const MockIPFSBlobs = new Mongo.Collection('MockIPFSBlobs');

// Expose globally for cleanup in tests
globalThis.MockIPFSBlobsCollection = MockIPFSBlobs;

async function mockIPFSWrite(paddedBytes) {
  // Synthetic CID: hex-encoded SHA-256 of bytes
  // Using Node's crypto since this runs server-side
  const { createHash } = await import('crypto');
  const hash = createHash('sha256').update(Buffer.from(paddedBytes)).digest('hex');
  const cid  = `mock-sha2-256-${hash}`;

  // Idempotent insert — same bytes → same CID → same doc
  const existing = await MockIPFSBlobs.findOneAsync({ _id: cid });
  if (!existing) {
    await MockIPFSBlobs.insertAsync({
      _id:   cid,
      bytes: Array.from(paddedBytes),  // Mongo can't store Uint8Array directly
      stored_at: new Date(),
    });
  }
  return cid;
}

async function mockIPFSRead(cid) {
  const doc = await MockIPFSBlobs.findOneAsync({ _id: cid });
  if (!doc) throw new Error(`mockIPFSRead: CID not found: ${cid}`);
  return new Uint8Array(doc.bytes);
}

// Pluggable IPFS backend — swapped in Phase 6
globalThis.KoadMemoryStoreIPFS = {
  write: mockIPFSWrite,
  read:  mockIPFSRead,
};

// ── Server-side crypto shim ───────────────────────────────────────────────────
// On the server (Node 22), globalThis.crypto is the Web Crypto API.
// The same blob-crypto functions work; we replicate the key pieces here
// to avoid a client→server dependency. Server-side is only used for:
//   - generating random bytes (crypto.getRandomValues)
//   - AES-GCM operations via subtle
//   - SHA-256 for synthetic CIDs

async function serverGenerateDEK() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function serverEncryptBlob(plaintext, dek) {
  const plaintextBytes = typeof plaintext === 'string'
    ? new TextEncoder().encode(plaintext)
    : plaintext;

  const cleartext = new Uint8Array(4 + plaintextBytes.length);
  const ctView    = new DataView(cleartext.buffer);
  ctView.setUint32(0, plaintextBytes.length, false);
  cleartext.set(plaintextBytes, 4);

  const iv        = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, cleartext);
  const aesOut    = new Uint8Array(encrypted);

  const unpadded  = new Uint8Array(4 + 12 + aesOut.length);
  const blobView  = new DataView(unpadded.buffer);
  blobView.setUint32(0, aesOut.length, false);
  unpadded.set(iv, 4);
  unpadded.set(aesOut, 4 + 12);

  return { ciphertextRaw: unpadded, iv };
}

const SIZE_BUCKETS_SERVER = [
  { max: 3   * 1024, padded: 4   * 1024 },
  { max: 15  * 1024, padded: 16  * 1024 },
  { max: 63  * 1024, padded: 64  * 1024 },
  { max: 255 * 1024, padded: 256 * 1024 },
];

function padToSizeBucketServer(bytes) {
  const bucket = SIZE_BUCKETS_SERVER.find(b => b.max >= bytes.length);
  if (!bucket) throw new Error(`MemoryStore: blob too large for any bucket: ${bytes.length} bytes`);
  if (bytes.length === bucket.padded) return bytes;
  const padded = new Uint8Array(bucket.padded);
  padded.set(bytes);
  return padded;
}

async function serverDecryptBlob(ciphertext, dek) {
  const blobView         = new DataView(ciphertext.buffer, ciphertext.byteOffset, ciphertext.byteLength);
  const actualEncLen     = blobView.getUint32(0, false);
  const iv               = ciphertext.slice(4, 16);
  const aesGcmData       = ciphertext.slice(16, 16 + actualEncLen);

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dek, aesGcmData);
  const decArr    = new Uint8Array(decrypted);

  // Strip 4-byte length prefix
  const view        = new DataView(decArr.buffer, decArr.byteOffset, decArr.byteLength);
  const realLength  = view.getUint32(0, false);
  return decArr.slice(4, 4 + realLength);
}

async function serverWrapDEK(dek, kek) {
  const wrapped = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-KW' });
  const bytes   = new Uint8Array(wrapped);
  // base64url encode
  const b64     = Buffer.from(bytes).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function serverUnwrapDEK(wrapped_b64u, kek) {
  const b64     = wrapped_b64u.replace(/-/g, '+').replace(/_/g, '/');
  const padded  = b64 + '='.repeat((4 - b64.length % 4) % 4);
  const wrapped = new Uint8Array(Buffer.from(padded, 'base64'));
  try {
    return await crypto.subtle.unwrapKey(
      'raw', wrapped, kek,
      { name: 'AES-KW' },
      { name: 'AES-GCM', length: 256 },
      true, ['encrypt', 'decrypt']
    );
  } catch (err) {
    // Stale key_version → KEY_ROTATION_REQUIRED (SPEC-134 §6.4)
    const e = new Error('KEY_ROTATION_REQUIRED: DEK unwrap failed — KEK is stale or key_version mismatch');
    e.code  = 'KEY_ROTATION_REQUIRED';
    throw e;
  }
}

// ── MemoryStore public API ────────────────────────────────────────────────────

const MemoryStore = {
  // write(plaintext, metadata, kek) → { cid, wrapped_dek, blob_size }
  //
  // metadata shape: { user_id, entity, surface, topic?, visibility, supersedes?,
  //                   captured_from, key_version }
  // kek: CryptoKey (AES-KW) — the user's current KEK
  //
  // Returns the fields needed to insert a UserMemories document.
  // The caller (application code) performs the Mongo insert with full §4.1 schema.
  async write(plaintext, metadata, kek) {
    if (!plaintext || !metadata || !kek) {
      throw new Error('MemoryStore.write: plaintext, metadata, and kek are required');
    }

    // Generate per-blob DEK (SPEC-134 §5 — one DEK per blob)
    const dek = await serverGenerateDEK();

    // Encrypt plaintext → padded ciphertext
    const { ciphertextRaw } = await serverEncryptBlob(plaintext, dek);
    const paddedCiphertext  = padToSizeBucketServer(ciphertextRaw);

    // Write to IPFS (mock in Phase 2) → synthetic CID
    const cid = await globalThis.KoadMemoryStoreIPFS.write(paddedCiphertext);

    // Wrap DEK with user's KEK
    const wrapped_dek = await serverWrapDEK(dek, kek);

    return {
      cid,
      wrapped_dek,
      blob_size: paddedCiphertext.length,
    };
  },

  // read(cid, wrapped_dek, kek) → Uint8Array (plaintext bytes)
  //
  // Throws with code='KEY_ROTATION_REQUIRED' if kek cannot unwrap the DEK.
  // Caller should surface this as "key rotation required" (SPEC-134 §6.4).
  async read(cid, wrapped_dek, kek) {
    if (!cid || !wrapped_dek || !kek) {
      throw new Error('MemoryStore.read: cid, wrapped_dek, and kek are required');
    }

    // Unwrap DEK — KEY_ROTATION_REQUIRED if stale
    let dek;
    try {
      dek = await serverUnwrapDEK(wrapped_dek, kek);
    } catch (err) {
      if (err.code === 'KEY_ROTATION_REQUIRED') throw err;
      const rotErr = new Error('KEY_ROTATION_REQUIRED: DEK unwrap failed');
      rotErr.code  = 'KEY_ROTATION_REQUIRED';
      throw rotErr;
    }

    // Fetch from IPFS
    const paddedCiphertext = await globalThis.KoadMemoryStoreIPFS.read(cid);

    // Decrypt → plaintext
    return serverDecryptBlob(paddedCiphertext, dek);
  },

  // unpin(cid) → void
  //
  // Unpins a CID from the IPFS backend.
  // Phase 5 (MockIPFS): removes the blob from MockIPFSBlobs collection.
  // Phase 6: calls the real kingdom cluster API unpin endpoint.
  async unpin(cid) {
    if (!cid) throw new Error('MemoryStore.unpin: cid is required');
    // Remove from MockIPFS (Phase 5 path)
    try {
      await MockIPFSBlobs.removeAsync({ _id: cid });
    } catch (err) {
      // Swallow — blob may already be gone or may not exist in mock store
    }
    // Phase 6: call globalThis.KoadMemoryStoreIPFS.unpin(cid)
    if (globalThis.KoadMemoryStoreIPFS && typeof globalThis.KoadMemoryStoreIPFS.unpin === 'function') {
      try {
        await globalThis.KoadMemoryStoreIPFS.unpin(cid);
      } catch (err) {
        // Log but don't throw — unpin failure is non-fatal per §9.2
        console.warn(`MemoryStore.unpin: IPFS unpin failed for ${cid}: ${err.message}`);
      }
    }
  },

  // readAll(user_id, entity, kek) → Array<{ _id, plaintext, doc }>
  //
  // Fetches all active UserMemories for (user_id, entity) where
  // superseded_at and forgotten_at are both null.
  // Returns plaintext for each, or marks key_rotation_required if KEK is stale.
  async readAll(user_id, entity, kek) {
    const docs = await globalThis.UserMemoriesCollection.find({
      user_id,
      entity,
      superseded_at: null,
      forgotten_at:  null,
    }).fetchAsync();

    const results = [];
    for (const doc of docs) {
      try {
        const plaintextBytes = await this.read(doc.cid, doc.wrapped_dek, kek);
        results.push({
          _id:       doc._id,
          plaintext: new TextDecoder().decode(plaintextBytes),
          doc,
        });
      } catch (err) {
        if (err.code === 'KEY_ROTATION_REQUIRED') {
          results.push({
            _id:                  doc._id,
            key_rotation_required: true,
            doc,
          });
        } else {
          throw err;
        }
      }
    }
    return results;
  },
};

// Expose globally for server-side callers
globalThis.KoadMemoryStore = MemoryStore;

export { MemoryStore };
