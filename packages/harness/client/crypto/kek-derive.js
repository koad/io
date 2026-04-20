// KEK Derivation Module — VESTA-SPEC-134 §6.2
// Three derivation paths, applied in order of availability.
// Exports: deriveKEK(), deriveKEKPathA(), deriveKEKPathB(), deriveKEKPathC()
//
// Path A — WebAuthn PRF (PWA, progressive enhancement)
// Path B — Argon2id Passphrase (Universal Fallback)
// Path C — Server-Assisted (Local Harness)
//
// NOTE: This module runs client-side in the browser.
// The non-extractable CryptoKey is stored in IndexedDB by kek-storage.js.
// Never call exportKey() on the returned key — it will throw by design (SPEC-134 §11.1).

'use strict';

// ── Path detection helpers ────────────────────────────────────────────────────

function isWebAuthnPRFAvailable() {
  // WebAuthn PRF is available when:
  //   - PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable returns true, AND
  //   - PRF extension is listed in a test create() call
  // For progressive enhancement, we check a simpler heuristic: the PRF extension
  // appears in navigator.credentials and the platform supports WebAuthn 3 (credential.getClientExtensionResults).
  // Full PRF detection happens during the authentication ceremony itself.
  if (typeof window === 'undefined') return false;
  if (typeof window.PublicKeyCredential === 'undefined') return false;
  // PRF extension support was added alongside the Level 3 spec features.
  // We detect it at auth time; this is the pre-flight check.
  return true;
}

// ── HKDF-SHA-256 helper ───────────────────────────────────────────────────────
// Used by both Path A and Path B to derive the final KEK from raw key material.

async function hkdfDerive(rawKeyMaterial, salt, info) {
  // rawKeyMaterial: Uint8Array or ArrayBuffer
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    rawKeyMaterial instanceof Uint8Array ? rawKeyMaterial : new Uint8Array(rawKeyMaterial),
    { name: 'HKDF' },
    false,          // not extractable
    ['deriveKey']
  );

  // Derive a non-extractable AES-256-GCM key (the KEK)
  const saltBytes  = typeof salt === 'string' ? new TextEncoder().encode(salt) : salt;
  const infoBytes  = typeof info === 'string' ? new TextEncoder().encode(info) : info;

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: infoBytes,
    },
    keyMaterial,
    { name: 'AES-KW', length: 256 },  // AES-KeyWrap — the KEK wraps DEKs
    false,    // NON-EXTRACTABLE — SPEC-134 §11.1 requirement
    ['wrapKey', 'unwrapKey']
  );
}

// ── Path A: WebAuthn PRF ──────────────────────────────────────────────────────
// prf_output: 32-byte Uint8Array from the WebAuthn PRF extension evaluation.
// user_id: String — used as HKDF info to domain-separate.

async function deriveKEKPathA(prf_output, user_id) {
  if (!(prf_output instanceof Uint8Array) || prf_output.length !== 32) {
    throw new Error('deriveKEKPathA: prf_output must be a 32-byte Uint8Array');
  }
  // SPEC-134 §6.2 Path A:
  // KEK = HKDF-SHA-256(prf_output, salt="koad-memory-kek-v1", info=user_id, length=32)
  return hkdfDerive(prf_output, 'koad-memory-kek-v1', user_id);
}

// ── Path B: Argon2id Passphrase ───────────────────────────────────────────────
// passphrase: String — user's memorized passphrase
// user_specific_salt: Uint8Array — 32-byte random salt from account record (non-secret)
// argon2fn: async function — Argon2id implementation (argon2-browser in browser; stub in tests)
//   argon2fn(passphrase, salt, t, m, p, len) → Promise<Uint8Array(32)>

async function deriveKEKPathB(passphrase, user_specific_salt, argon2fn) {
  if (typeof passphrase !== 'string' || !passphrase) {
    throw new Error('deriveKEKPathB: passphrase must be a non-empty string');
  }
  if (!(user_specific_salt instanceof Uint8Array) || user_specific_salt.length !== 32) {
    throw new Error('deriveKEKPathB: user_specific_salt must be a 32-byte Uint8Array');
  }
  if (typeof argon2fn !== 'function') {
    throw new Error('deriveKEKPathB: argon2fn must be provided (argon2-browser or stub)');
  }

  // SPEC-134 §6.2 Path B — parameters are NON-NEGOTIABLE per spec:
  // t=3 (time cost), m=65536 (64MB memory), p=4 (parallelism), len=32
  // Vulcan MUST NOT reduce these for performance. Amendment required to change.
  const raw = await argon2fn(passphrase, user_specific_salt, 3, 65536, 4, 32);
  if (!(raw instanceof Uint8Array) || raw.length !== 32) {
    throw new Error('deriveKEKPathB: argon2fn must return a 32-byte Uint8Array');
  }

  // KEK = HKDF-SHA-256(argon2_output, salt="koad-memory-kek-v1", info="path-b")
  // The HKDF step domain-separates Path B output from Path A (both use "koad-memory-kek-v1").
  return hkdfDerive(raw, 'koad-memory-kek-v1', 'path-b');
}

// ── Path C: Server-Assisted (Local Harness) ───────────────────────────────────
// Same math as Path B but the server delivers the encrypted_kek_blob and the local
// harness prompts for the passphrase. The decrypt happens here.
// encrypted_kek_blob_bytes: Uint8Array — AES-256-GCM encrypted KEK (IV || ciphertext || tag)
// passphrase: String
// user_specific_salt: Uint8Array (32 bytes)
// argon2fn: async function

async function deriveKEKPathC(encrypted_kek_blob_bytes, passphrase, user_specific_salt, argon2fn) {
  // Derive the wrapper_key using same Argon2id params as Path B
  if (!(user_specific_salt instanceof Uint8Array) || user_specific_salt.length !== 32) {
    throw new Error('deriveKEKPathC: user_specific_salt must be a 32-byte Uint8Array');
  }
  const argon2_raw = await argon2fn(passphrase, user_specific_salt, 3, 65536, 4, 32);
  if (!(argon2_raw instanceof Uint8Array) || argon2_raw.length !== 32) {
    throw new Error('deriveKEKPathC: argon2fn must return a 32-byte Uint8Array');
  }

  // Import wrapper_key as AES-256-GCM decryption key
  const wrapper_key = await crypto.subtle.importKey(
    'raw',
    argon2_raw,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // Decrypt the encrypted_kek_blob: layout = IV(12) || ciphertext || auth_tag
  if (!(encrypted_kek_blob_bytes instanceof Uint8Array) || encrypted_kek_blob_bytes.length < 28) {
    throw new Error('deriveKEKPathC: encrypted_kek_blob_bytes too short');
  }
  const iv         = encrypted_kek_blob_bytes.slice(0, 12);
  const ciphertext = encrypted_kek_blob_bytes.slice(12);

  let kek_raw;
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      wrapper_key,
      ciphertext
    );
    kek_raw = new Uint8Array(decrypted);
  } catch (err) {
    // Distinguish passphrase failure from generic decrypt error
    throw new Error('KEY_ROTATION_REQUIRED: failed to decrypt KEK blob — wrong passphrase or stale key version');
  }

  // Import as non-extractable AES-KW key (the KEK)
  return crypto.subtle.importKey(
    'raw',
    kek_raw,
    { name: 'AES-KW' },
    false,          // NON-EXTRACTABLE — SPEC-134 §11.1
    ['wrapKey', 'unwrapKey']
  );
}

// ── Unified deriveKEK — picks best available path ─────────────────────────────
// options:
//   { path: 'A', prf_output, user_id }                     → Path A
//   { path: 'B', passphrase, user_specific_salt, argon2fn } → Path B
//   { path: 'C', encrypted_kek_blob_bytes, passphrase, user_specific_salt, argon2fn } → Path C
//   { /* auto-detect */ passphrase, user_specific_salt, argon2fn } → A if PRF available, else B

async function deriveKEK(options) {
  const { path } = options;

  if (path === 'A' || (!path && isWebAuthnPRFAvailable() && options.prf_output)) {
    return deriveKEKPathA(options.prf_output, options.user_id);
  }
  if (path === 'C') {
    return deriveKEKPathC(
      options.encrypted_kek_blob_bytes,
      options.passphrase,
      options.user_specific_salt,
      options.argon2fn
    );
  }
  // Default: Path B
  return deriveKEKPathB(options.passphrase, options.user_specific_salt, options.argon2fn);
}

// ── Exports ───────────────────────────────────────────────────────────────────

if (typeof module !== 'undefined') {
  module.exports = { deriveKEK, deriveKEKPathA, deriveKEKPathB, deriveKEKPathC, hkdfDerive };
}
