// KEK Storage — VESTA-SPEC-134 §11.1
// Stores the non-extractable KEK CryptoKey in IndexedDB for the session duration.
// 30-minute idle timeout. Clears on session end.
//
// SPEC REQUIREMENTS (non-negotiable):
// - KEK stored as non-extractable CryptoKey in IndexedDB (not localStorage/sessionStorage)
// - 30-minute idle timeout: re-derive on re-authentication
// - Clear on session end
//
// The KEK stored here is AES-KW (wraps/unwraps DEKs).
// After KEK derivation (kek-derive.js), call storeKEK().
// Before any DEK operation, call loadKEK().

'use strict';

const DB_NAME     = 'koad-io-memory';
const DB_VERSION  = 1;
const STORE_NAME  = 'kek';
const KEK_KEY     = 'current';
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

let _idleTimer   = null;
let _db          = null;

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function (e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess  = function (e) { _db = e.target.result; resolve(_db); };
    req.onerror    = function (e) { reject(e.target.error); };
  });
}

async function idbPut(key, value) {
  const db    = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function idbGet(key) {
  const db    = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.get(key);
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function idbDelete(key) {
  const db    = await openDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Idle timeout ──────────────────────────────────────────────────────────────

function resetIdleTimer() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(() => {
    clearKEK().catch(err => console.warn('[kek-storage] idle timeout clear failed:', err.message));
  }, IDLE_TIMEOUT_MS);
}

// ── Public API ────────────────────────────────────────────────────────────────

const KoadKEKStorage = {
  // Store a non-extractable KEK CryptoKey in IndexedDB.
  // The key object is stored directly — IndexedDB supports CryptoKey storage.
  // Resets the idle timer.
  async storeKEK(kek) {
    if (!kek || kek.type !== 'secret') {
      throw new Error('storeKEK: kek must be a CryptoKey');
    }
    if (kek.extractable) {
      throw new Error('storeKEK: kek must be non-extractable (SPEC-134 §11.1)');
    }
    await idbPut(KEK_KEY, { key: kek, stored_at: Date.now() });
    resetIdleTimer();
  },

  // Load the KEK from IndexedDB. Returns null if not present or expired.
  // Resets the idle timer on successful load.
  async loadKEK() {
    const record = await idbGet(KEK_KEY);
    if (!record) return null;
    // Verify idle timeout hasn't passed (belt-and-suspenders; timer handles most cases)
    if (Date.now() - record.stored_at > IDLE_TIMEOUT_MS) {
      await idbDelete(KEK_KEY);
      return null;
    }
    resetIdleTimer();
    return record.key;
  },

  // Clear the KEK from IndexedDB. Call on session end.
  async clearKEK() {
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
    await idbDelete(KEK_KEY);
  },

  // Test helper: check if a key is non-extractable.
  // This is how we verify SPEC-134 §11.1 compliance.
  async assertNonExtractable(kek) {
    try {
      await crypto.subtle.exportKey('raw', kek);
      throw new Error('assertNonExtractable: key IS extractable — SPEC-134 §11.1 violation');
    } catch (err) {
      if (err.message.includes('SPEC-134')) throw err;
      // exportKey threw (expected for non-extractable) — good
      return true;
    }
  },
};

// Make clearKEK available module-locally for the idle timer callback
function clearKEK() { return KoadKEKStorage.clearKEK(); }

// Clear KEK when page unloads (session end)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // synchronous clear isn't possible in beforeunload; queue the async clear
    KoadKEKStorage.clearKEK().catch(() => {});
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

if (typeof globalThis !== 'undefined') {
  globalThis.KoadKEKStorage = KoadKEKStorage;
}

if (typeof module !== 'undefined') {
  module.exports = KoadKEKStorage;
}
