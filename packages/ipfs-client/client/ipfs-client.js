/**
 * koad:io-ipfs-client — client/ipfs-client.js
 *
 * In-browser IPFS node wrapping Helia HTTP.
 *
 * Architecture:
 *   - Runtime:  @helia/http (no DHT — HTTP delegated routing only)
 *   - Storage:  blockstore-opfs (OPFS, persistent, binary-native)
 *   - Fallback: blockstore-idb (IndexedDB, Firefox service worker compat)
 *   - Routing:  delegated-ipfs.dev (no DHT peer discovery)
 *   - Verify:   @helia/verified-fetch (CIDs are self-certifying, checked locally)
 *
 * Reference impl: inbrowser.link v3.1.7 (ipfs/service-worker-gateway, April 2026)
 * Research: ~/.sibyl/research/2026-04-16-helia-browser-ipfs-pwa.md
 *
 * Singleton pattern — one Helia node per browser tab.
 * Lazy-initializes on first use. Does not block app startup.
 *
 * API surface:
 *   IPFSClient.put(data)             → Promise<string>   CIDv1 dag-json sha2-256
 *   IPFSClient.get(cid)             → Promise<object>   decoded dag-json object
 *   IPFSClient.resolve(cid)          → Promise<Uint8Array>
 *   IPFSClient.pin(cid)              → Promise<void>
 *   IPFSClient.unpin(cid)            → Promise<void>
 *   IPFSClient.has(cid)              → Promise<boolean>
 *   IPFSClient.status()              → Object
 *   IPFSClient.ready()               → Promise<void>  (resolves when node is init'd)
 */

// Helia and blockstore are loaded as async dynamic imports to avoid
// blocking Meteor's initial bundle. The init() call handles feature
// detection and chooses OPFS vs IDB automatically.

const DELEGATED_ROUTING_URL = 'https://delegated-ipfs.dev';
const OPFS_STORE_NAME = 'koad-io-ipfs-blockstore';

let _heliaNode = null;
let _verifiedFetch = null;
let _initPromise = null;
let _initError = null;

/**
 * _detectStorage — returns the appropriate blockstore constructor.
 *
 * OPFS is preferred: persistent, fast, binary-native.
 * Falls back to IDB if OPFS is not available (Firefox service worker, older browsers).
 */
async function _detectStorage() {
  try {
    if (typeof navigator !== 'undefined'
        && navigator.storage
        && typeof navigator.storage.getDirectory === 'function') {
      // Quick OPFS probe — throws in contexts where it's unavailable
      await navigator.storage.getDirectory();
      const { OPFSBlockstore } = await import('blockstore-opfs');
      const store = new OPFSBlockstore(OPFS_STORE_NAME);
      await store.open();
      return { store, backend: 'opfs' };
    }
  } catch (e) {
    // OPFS unavailable — fall through to IDB
  }

  const { IDBBlockstore } = await import('blockstore-idb');
  const store = new IDBBlockstore(OPFS_STORE_NAME);
  await store.open();
  return { store, backend: 'idb' };
}

/**
 * _init — create the Helia HTTP node. Called once; subsequent calls return
 * the cached promise. Thread-safe via the _initPromise singleton.
 */
async function _init() {
  if (_heliaNode) return _heliaNode;

  const { store, backend } = await _detectStorage();

  const { createHeliaHTTP } = await import('@helia/http');
  const { createVerifiedFetch } = await import('@helia/verified-fetch');

  _heliaNode = await createHeliaHTTP({
    blockstore: store,
    routers: [
      {
        // Delegated HTTP routing — no DHT required in browser
        protocol: 'http',
        endpoint: new URL(DELEGATED_ROUTING_URL)
      }
    ]
  });

  _verifiedFetch = await createVerifiedFetch(_heliaNode);

  // Attach to koad global for debugging / inter-package access
  if (typeof koad !== 'undefined') {
    koad.ipfs = koad.ipfs || {};
    koad.ipfs._node = _heliaNode;
    koad.ipfs._backend = backend;
    koad.ipfs._ready = true;
  }

  return _heliaNode;
}

/**
 * _ensureReady — internal guard. Returns the initialized node,
 * throwing if init failed.
 */
async function _ensureReady() {
  if (_initError) throw _initError;
  const node = await _initPromise;
  if (!node) throw new Error('koad:io-ipfs-client: node failed to initialize');
  return node;
}


// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const IPFSClient = {

  /**
   * ready() — resolves when the Helia node is fully initialized.
   * Call this on app startup if you want to warm the node proactively.
   * Otherwise, the first resolve/pin/has call triggers lazy init.
   *
   * @returns {Promise<void>}
   */
  ready() {
    if (!_initPromise) {
      _initPromise = _init().catch(err => {
        _initError = err;
        console.error('[koad:io-ipfs-client] init failed:', err);
        throw err;
      });
    }
    return _initPromise.then(() => undefined);
  },

  /**
   * resolve(cid) — fetch and verify a CID. Returns raw bytes.
   *
   * Checks local OPFS cache first (via Helia blockstore). If not cached,
   * fetches from IPFS network via trustless gateway, verifies hash locally,
   * stores in blockstore for future calls.
   *
   * @param {string} cid — CID string (e.g. "QmFoo..." or "bafy...")
   * @returns {Promise<Uint8Array>}
   */
  async resolve(cid) {
    await this.ready();

    const response = await _verifiedFetch(`ipfs://${cid}`);
    if (!response.ok) {
      throw new Error(`[koad:io-ipfs-client] resolve failed for CID ${cid}: ${response.status} ${response.statusText}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes;
  },

  /**
   * pin(cid) — ensure a CID is persisted in the local blockstore.
   *
   * Resolves the CID if not already cached, then pins it so it is not
   * garbage-collected from the local store. For browser nodes this is
   * local-only persistence — it does not pin to the IPFS network.
   *
   * @param {string} cid
   * @returns {Promise<void>}
   */
  async pin(cid) {
    await this.ready();
    const { CID } = koad.deps;
    const parsedCID = CID.parse(cid);
    await _heliaNode.pins.add(parsedCID);
  },

  /**
   * unpin(cid) — remove a CID from local pinset.
   * The blocks may still be cached until GC runs; they will no longer
   * be protected from eviction.
   *
   * @param {string} cid
   * @returns {Promise<void>}
   */
  async unpin(cid) {
    await this.ready();
    const { CID } = koad.deps;
    const parsedCID = CID.parse(cid);
    await _heliaNode.pins.rm(parsedCID);
  },

  /**
   * put(data) — encode a JS object as dag-json, store in local blockstore,
   * return the CIDv1 string (dag-json codec 0x0129, sha2-256).
   *
   * Per SPEC-111 §3.1: codec dag-json (0x0129), hash sha2-256.
   * This is how sigchain entries get written to IPFS — the returned CID is
   * the content-address used as `previous` in subsequent entries.
   *
   * @param {object|Uint8Array} data — JS object (will be dag-json encoded) or
   *   pre-encoded Uint8Array of dag-json bytes
   * @returns {Promise<string>} — base32upper CIDv1 string e.g. "bagu..."
   */
  async put(data) {
    await this.ready();
    const { CID, sha256, dagJsonEncode } = koad.deps;

    const bytes = (data instanceof Uint8Array) ? data : dagJsonEncode(data);

    const hash = await sha256.digest(bytes);
    const cid = CID.createV1(0x0129, hash);

    await _heliaNode.blockstore.put(cid, bytes);

    return cid.toString();
  },

  /**
   * get(cid) — fetch dag-json bytes from IPFS (local cache first, then network),
   * decode to a JS object, and return it.
   *
   * This is the structured read side — resolve() returns raw bytes,
   * get() returns the decoded object.
   *
   * @param {string} cid — CIDv1 string
   * @returns {Promise<object>} — decoded JS object
   */
  async get(cid) {
    const bytes = await this.resolve(cid);
    const { dagJsonDecode } = koad.deps;
    return dagJsonDecode(bytes);
  },

  /**
   * has(cid) — returns true if the CID is available in the local blockstore
   * (i.e. its root block is cached locally without a network request).
   *
   * @param {string} cid
   * @returns {Promise<boolean>}
   */
  async has(cid) {
    await this.ready();
    const { CID } = koad.deps;
    const parsedCID = CID.parse(cid);
    return await _heliaNode.blockstore.has(parsedCID.multihash);
  },

  /**
   * status() — synchronous snapshot of the client state.
   * Does not trigger initialization.
   *
   * @returns {{ initialized: boolean, backend: string|null, error: Error|null }}
   */
  status() {
    return {
      initialized: !!_heliaNode,
      backend: (typeof koad !== 'undefined' && koad.ipfs) ? koad.ipfs._backend : null,
      error: _initError
    };
  }

};

// Make available as a global (Meteor export + koad namespace)
if (typeof koad !== 'undefined') {
  koad.ipfs = koad.ipfs || {};
  koad.ipfs.client = IPFSClient;
}
