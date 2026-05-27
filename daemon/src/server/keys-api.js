// keys-api.js — REST API for BIP44 key/address derivation
//
// HTTP endpoints exposing @ecoincore/node/keys for any kingdom service.
// Wraps the chainpack-aware HD wallet primitives so the storefront, drive-
// chain workers, learner tooling, and curl-using humans can derive keys
// without needing Node access to @ecoincore/node directly.
//
// Endpoints:
//   GET  /api/keys/chains                       — list chainpacks the daemon knows + their derivation capabilities
//   POST /api/keys/derive-xpub                  — body: { mnemonic, passphrase?, ticker | chainpack, account? }
//   POST /api/keys/derive-address               — body: { mnemonic, passphrase?, ticker | chainpack, account?, chain?, index?, type? }
//   POST /api/keys/derive-address-from-xpub     — body: { xpub, ticker | chainpack, chain?, index?, type? } (NO mnemonic needed)
//
// All endpoints return JSON. Chainpacks resolved either inline (caller passes
// `chainpack` field) or via a lazy long-lived cachebox DDP connection. Set
// ECOINCORE_CACHEBOX_URL to override the default endpoint.
//
// Security: mnemonics in POST bodies travel as plaintext. This endpoint is
// intended for local kingdom services on a trusted network (daemon binds to
// 10.10.10.10:28282 by default). DO NOT expose this endpoint to the public
// internet without TLS + auth.

const { WebApp } = require('meteor/webapp');

const app = WebApp.connectHandlers;

const CACHEBOX_URL = process.env.ECOINCORE_CACHEBOX_URL || 'wss://explorer.canadaecoin.ca/websocket';

// ---------------------------------------------------------------------------
// Lazy module + cachebox loading (@ecoincore/node is ESM; daemon is CJS)
// ---------------------------------------------------------------------------

let _keysMod = null;
let _cacheboxMod = null;
let _box = null;
let _boxPromise = null;

async function loadKeys() {
  if (!_keysMod) _keysMod = await import('@ecoincore/node/keys');
  return _keysMod;
}

async function loadCachebox() {
  if (!_cacheboxMod) _cacheboxMod = await import('@ecoincore/node/cachebox');
  return _cacheboxMod;
}

async function getCacheBox() {
  if (_box) return _box;
  if (_boxPromise) return _boxPromise;
  const { connectCacheBox } = await loadCachebox();
  _boxPromise = connectCacheBox(CACHEBOX_URL, {
    subscribeChainpacks: true,
    subscribeExchangeRates: false,
  }).then(b => {
    _box = b;
    _boxPromise = null;
    console.log('[daemon] keys-api: connected to cachebox', CACHEBOX_URL, '— chainpacks:', b.chainpacks.size);
    return b;
  }).catch(err => {
    _boxPromise = null;
    console.error('[daemon] keys-api: cachebox connect failed:', err.message);
    throw err;
  });
  return _boxPromise;
}

async function resolveChainpack({ chainpack, ticker }) {
  if (chainpack && typeof chainpack === 'object') return chainpack;
  if (!ticker) throw new Error('either chainpack or ticker is required');
  const box = await getCacheBox();
  const cp = box.getChainpack(String(ticker).toUpperCase());
  if (!cp) throw new Error(`chainpack not found on cachebox: ${ticker}`);
  return cp;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonOk(res, payload) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end(JSON.stringify(payload));
}

function jsonErr(res, code, message) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(code);
  res.end(JSON.stringify({ status: 'error', message }));
}

// ---------------------------------------------------------------------------
// OPTIONS preflight
// ---------------------------------------------------------------------------

app.use('/api/keys', (req, res, next) => {
  if (req.method !== 'OPTIONS') return next();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.writeHead(204);
  res.end();
});

// ============================================================================
// GET /api/keys/chains — list known chainpacks + their derivation capabilities
// ============================================================================

app.use('/api/keys/chains', async (req, res, next) => {
  if (req.url !== '/chains' && req.url !== '/chains/' && req.url !== '/' && req.url !== '') return next();
  if (req.method !== 'GET') return next();

  try {
    const box = await getCacheBox();
    const { validateChainpackForDerivation } = await loadKeys();

    const chains = [];
    for (const [, cp] of box.chainpacks) {
      const v = validateChainpackForDerivation(cp, { op: 'derive-xpub' });
      const n = v.normalized;
      chains.push({
        ticker: cp.ticker,
        name: cp.name || null,
        coin_type: n.coinType,
        canDeriveXpub: v.ok,
        canDeriveP2pkh: validateChainpackForDerivation(cp, { op: 'derive-address-p2pkh' }).ok,
        canDeriveP2wpkh: validateChainpackForDerivation(cp, { op: 'derive-address-p2wpkh' }).ok,
        bech32Hrp: n.bech32,
        bip32Source: n.sources.bip32Source,
        missing: v.missing,
      });
    }
    chains.sort((a, b) => (a.ticker || '').localeCompare(b.ticker || ''));

    jsonOk(res, {
      status: 'ok',
      count: chains.length,
      supports: chains.filter(c => c.canDeriveXpub).length,
      cachebox: CACHEBOX_URL,
      chains,
    });
  } catch (err) {
    console.error('[API/keys/chains] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ============================================================================
// POST /api/keys/derive-xpub
// ============================================================================

app.use('/api/keys/derive-xpub', async (req, res, next) => {
  if (req.method !== 'POST') return next();

  try {
    const body = req.body || {};
    const { mnemonic, passphrase = '', ticker, chainpack, account = 0, purpose = 44 } = body;
    if (!mnemonic) return jsonErr(res, 400, 'mnemonic is required');

    const cp = await resolveChainpack({ chainpack, ticker });
    const { deriveAccountXpub } = await loadKeys();
    const result = deriveAccountXpub({
      mnemonic, passphrase, chainpack: cp,
      account: parseInt(account, 10) || 0,
      purpose: parseInt(purpose, 10) || 44,
    });

    jsonOk(res, {
      status: 'ok',
      ticker: result.ticker,
      coin_type: result.coinType,
      purpose: result.purpose,
      account: result.account,
      defaultScript: result.defaultScript,
      path: result.path,
      xpub: result.xpub,
      fingerprint: result.fingerprint,
      bip32Source: result.bip32Source,
    });
  } catch (err) {
    console.error('[API/keys/derive-xpub] error:', err.message);
    jsonErr(res, 400, err.message);
  }
});

// ============================================================================
// POST /api/keys/derive-address — from mnemonic (full path m/44'/coin'/acct'/chain/index)
// ============================================================================

app.use('/api/keys/derive-address', async (req, res, next) => {
  if (req.method !== 'POST') return next();
  // Don't intercept /derive-address-from-xpub
  if (req.url.startsWith('/derive-address-from-xpub')) return next();

  try {
    const body = req.body || {};
    const {
      mnemonic, passphrase = '',
      ticker, chainpack,
      account = 0, chain = 0, index = 0,
      type, purpose,
    } = body;
    if (!mnemonic) return jsonErr(res, 400, 'mnemonic is required');

    const cp = await resolveChainpack({ chainpack, ticker });
    const { deriveAccountXpub, deriveAddress, purposeForScriptType, scriptTypeForPurpose } = await loadKeys();

    // Resolve purpose + type from whichever was provided
    let resolvedPurpose, resolvedType;
    if (purpose != null) {
      resolvedPurpose = parseInt(purpose, 10);
      resolvedType = type || scriptTypeForPurpose(resolvedPurpose);
    } else if (type) {
      resolvedType = type;
      resolvedPurpose = purposeForScriptType(type);
    } else {
      resolvedPurpose = 44;
      resolvedType = 'p2pkh';
    }

    const acct = deriveAccountXpub({
      mnemonic, passphrase, chainpack: cp,
      account: parseInt(account, 10) || 0,
      purpose: resolvedPurpose,
    });
    const addr = deriveAddress({
      xpub: acct.xpub, chainpack: cp,
      chain: parseInt(chain, 10) || 0,
      index: parseInt(index, 10) || 0,
      type: resolvedType,
    });

    jsonOk(res, {
      status: 'ok',
      ticker: acct.ticker,
      path: `${acct.path}/${chain}/${index}`,
      purpose: resolvedPurpose,
      account: parseInt(account, 10) || 0,
      chain: parseInt(chain, 10) || 0,
      index: parseInt(index, 10) || 0,
      type: addr.type,
      address: addr.address,
      publicKey: addr.publicKey,
      xpub: acct.xpub,
    });
  } catch (err) {
    console.error('[API/keys/derive-address] error:', err.message);
    jsonErr(res, 400, err.message);
  }
});

// ============================================================================
// POST /api/keys/derive-address-from-xpub — watch-only, no mnemonic needed
// ============================================================================

app.use('/api/keys/derive-address-from-xpub', async (req, res, next) => {
  if (req.method !== 'POST') return next();

  try {
    const body = req.body || {};
    const {
      xpub, ticker, chainpack,
      chain = 0, index = 0, type = 'p2pkh',
    } = body;
    if (!xpub) return jsonErr(res, 400, 'xpub is required');

    const cp = await resolveChainpack({ chainpack, ticker });
    const { deriveAddress } = await loadKeys();

    const addr = deriveAddress({
      xpub, chainpack: cp,
      chain: parseInt(chain, 10) || 0,
      index: parseInt(index, 10) || 0,
      type,
    });

    jsonOk(res, {
      status: 'ok',
      ticker: cp.ticker,
      chain: parseInt(chain, 10) || 0,
      index: parseInt(index, 10) || 0,
      type: addr.type,
      address: addr.address,
      publicKey: addr.publicKey,
    });
  } catch (err) {
    console.error('[API/keys/derive-address-from-xpub] error:', err.message);
    jsonErr(res, 400, err.message);
  }
});

// ============================================================================
// POST /api/keys/validate-address — verify an address against a chainpack
// ============================================================================

app.use('/api/keys/validate-address', async (req, res, next) => {
  if (req.method !== 'POST') return next();
  try {
    const body = req.body || {};
    const { address, ticker, chainpack } = body;
    if (!address) return jsonErr(res, 400, 'address is required');

    const cp = await resolveChainpack({ chainpack, ticker });
    const { validateAddress } = await loadKeys();
    const result = validateAddress(address, cp);

    jsonOk(res, { status: 'ok', ...result });
  } catch (err) {
    console.error('[API/keys/validate-address] error:', err.message);
    jsonErr(res, 400, err.message);
  }
});

// ============================================================================
// POST /api/keys/inspect-mnemonic — diagnostic BIP39 inspection (NO derivation)
// ============================================================================

app.use('/api/keys/inspect-mnemonic', async (req, res, next) => {
  if (req.method !== 'POST') return next();
  try {
    const body = req.body || {};
    const { mnemonic } = body;
    if (typeof mnemonic !== 'string') return jsonErr(res, 400, 'mnemonic field (string) required');

    const { inspectMnemonic } = await loadKeys();
    const result = inspectMnemonic(mnemonic);

    jsonOk(res, { status: 'ok', ...result });
  } catch (err) {
    console.error('[API/keys/inspect-mnemonic] error:', err.message);
    jsonErr(res, 400, err.message);
  }
});

console.log('[daemon] keys-api: mounted /api/keys/* endpoints (chainpack via', CACHEBOX_URL + ')');
