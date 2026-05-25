// Kingdom signing keys — VESTA-SPEC-115 §14.2 + SPEC-173
//
// Loads (or generates on first run) the kingdom Ed25519 keypair used to sign
// merkle tree roots and downstream anchor records.
//
// Canonical location: ~/.koad/kingdoms/<slug>/keys/anchoring-key.json
// (operator-owned: kingdoms are per-sovereign, not framework-tier; lives
// under the operator's entity home, same shape as ~/.koad/sigchain/, etc.)
// Slug resolution: KOAD_IO_KINGDOM_SLUG env > 'kingofalldata' default
// (SPEC-115 §14.3 — three-tier resolution; we use the env-or-default form here.)
//
// File shape (koad:io/anchoring-key/v1):
//   {
//     "schema":     "koad:io/anchoring-key/v1",
//     "kingdom":    "<slug>",
//     "publicKey":  "<64 hex chars>",   // 32-byte Ed25519 pubkey
//     "privateKey": "<64 hex chars>",   // 32-byte Ed25519 privkey
//     "created":    "<ISO 8601 UTC Z>"
//   }
//
// File mode: 0600 (private key on disk; the kingdoms/ dir is operator-local).
//
// This is the operational kingdom signing key. SPEC-115 §5.2 says the kingdom
// signing key is "the sovereign's Ed25519 key." Until VESTA-SPEC-113 (key
// derivation bridge) is implemented to derive this from koad's BIP39 mnemonic,
// we generate a fresh standalone keypair on first boot. When SPEC-113 lands,
// this key will be migrated to a deterministically-derived one via a kingdom
// sigchain key-rotation entry.
//
// Exports (set on globalThis as KingdomKeys for cross-file access):
//   KingdomKeys.publicKey       — Buffer (32 bytes)
//   KingdomKeys.privateKey      — Buffer (32 bytes)
//   KingdomKeys.publicKeyHex    — string (64 hex chars)
//   KingdomKeys.kingdom         — string (resolved slug)
//   KingdomKeys.path            — string (absolute path to anchoring-key.json)
//   KingdomKeys.created         — string (ISO 8601 UTC)
//   KingdomKeys.isAvailable()   — true once loaded

const fs = Npm.require('fs');
const path = Npm.require('path');
const os = Npm.require('os');

function resolveKingdomSlug() {
  if (process.env.KOAD_IO_KINGDOM_SLUG) return process.env.KOAD_IO_KINGDOM_SLUG;
  return 'kingofalldata';
}

function getKingdomDir(slug) {
  const home = process.env.HOME || os.homedir();
  return path.join(home, '.koad', 'kingdoms', slug);
}

function loadEd25519() {
  // koad:io-core publishes ed via globalThis.koad.deps.ed (SPEC-149 §3).
  if (globalThis.koad && globalThis.koad.deps && globalThis.koad.deps.ed) {
    return globalThis.koad.deps.ed;
  }
  // Fallback to direct require (may fail if not installed at app level).
  try { return require('@noble/ed25519'); } catch (_) { /* ignore */ }
  return null;
}

async function generateKeypair() {
  const ed = loadEd25519();
  if (!ed) {
    throw new Error('[KINGDOM-KEYS] @noble/ed25519 not available — cannot generate kingdom signing key. Ensure koad:io-core is loaded or @noble/ed25519 is in app Npm.depends.');
  }
  const privateKey = ed.utils.randomSecretKey
    ? ed.utils.randomSecretKey()
    : ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return { privateKey, publicKey };
}

function readExisting(keyPath) {
  try {
    const raw = fs.readFileSync(keyPath, 'utf8');
    const data = JSON.parse(raw);
    if (data.schema !== 'koad:io/anchoring-key/v1') {
      console.warn(`[KINGDOM-KEYS] schema mismatch in ${keyPath}: ${data.schema}`);
      return null;
    }
    if (!/^[0-9a-f]{64}$/.test(data.privateKey || '')) {
      console.warn(`[KINGDOM-KEYS] privateKey field invalid in ${keyPath}`);
      return null;
    }
    if (!/^[0-9a-f]{64}$/.test(data.publicKey || '')) {
      console.warn(`[KINGDOM-KEYS] publicKey field invalid in ${keyPath}`);
      return null;
    }
    return data;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      console.warn(`[KINGDOM-KEYS] could not read ${keyPath}: ${e.message}`);
    }
    return null;
  }
}

function writeKeypair(keyPath, kingdom, publicKey, privateKey) {
  const dir = path.dirname(keyPath);
  fs.mkdirSync(dir, { recursive: true });

  const data = {
    schema:     'koad:io/anchoring-key/v1',
    kingdom,
    publicKey:  Buffer.from(publicKey).toString('hex'),
    privateKey: Buffer.from(privateKey).toString('hex'),
    created:    new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };

  // Write atomically: write to .tmp, fsync, rename.
  const tmpPath = keyPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmpPath, keyPath);
  // Be explicit about the mode on the final file, in case umask intervened.
  try { fs.chmodSync(keyPath, 0o600); } catch (_) {}

  return data;
}

// ── Loader ────────────────────────────────────────────────────────────────────

let _state = null;

async function loadOrGenerate() {
  const kingdom = resolveKingdomSlug();
  const kingdomDir = getKingdomDir(kingdom);
  const keyPath = path.join(kingdomDir, 'keys', 'anchoring-key.json');

  let data = readExisting(keyPath);

  if (!data) {
    console.log(`[KINGDOM-KEYS] No existing key at ${keyPath} — generating fresh Ed25519 keypair for kingdom '${kingdom}'`);
    const { privateKey, publicKey } = await generateKeypair();
    data = writeKeypair(keyPath, kingdom, publicKey, privateKey);
    console.log(`[KINGDOM-KEYS] Wrote new anchoring key: pubkey=${data.publicKey.slice(0, 16)}...`);
  } else {
    console.log(`[KINGDOM-KEYS] Loaded existing kingdom signing key: pubkey=${data.publicKey.slice(0, 16)}... (created ${data.created})`);
  }

  _state = {
    kingdom:      data.kingdom,
    publicKey:    Buffer.from(data.publicKey, 'hex'),
    privateKey:   Buffer.from(data.privateKey, 'hex'),
    publicKeyHex: data.publicKey,
    path:         keyPath,
    created:      data.created,
  };
}

// Public surface (mounted on globalThis for cross-file access)
KingdomKeys = {
  get kingdom()      { return _state ? _state.kingdom      : null; },
  get publicKey()    { return _state ? _state.publicKey    : null; },
  get privateKey()   { return _state ? _state.privateKey   : null; },
  get publicKeyHex() { return _state ? _state.publicKeyHex : null; },
  get path()         { return _state ? _state.path         : null; },
  get created()      { return _state ? _state.created      : null; },
  isAvailable()      { return !!_state && !!_state.privateKey; },
};

Meteor.startup(async () => {
  try {
    await loadOrGenerate();
    console.log(`[KINGDOM-KEYS] Ready. Kingdom '${KingdomKeys.kingdom}' signing key loaded.`);
  } catch (err) {
    console.error('[KINGDOM-KEYS] Failed to load or generate kingdom signing key:', err.message);
    // Daemon continues; merkle.js will fall back to unsigned root.
  }
});
