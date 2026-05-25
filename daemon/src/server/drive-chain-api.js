// drive-chain-api.js — REST API for drivechain operations
//
// VESTA-SPEC-212: HTTP endpoints for the drive-chain forge CLI. Wraps the
// koad-io-drive-chain package's SidechainManager, RustBridge, DepositWatcher,
// and WithdrawalManager for kingdom operators invoking from bash.
//
// Endpoints:
//   GET  /api/drive-chain/sidechains          — list all sidechains
//   GET  /api/drive-chain/sidechain/:id       — single sidechain detail
//   POST /api/drive-chain/allocate            — request sidechain allocation
//   POST /api/drive-chain/deposit             — initiate BIP 300 deposit
//   POST /api/drive-chain/withdraw            — initiate withdrawal
//   GET  /api/drive-chain/bridge/health       — bridge service health
//
// All endpoints return JSON. Stub markers (._stub) are included when the
// underlying Rust bridge is not connected.

const { WebApp } = require('meteor/webapp');

const app = WebApp.connectHandlers;

// ---------------------------------------------------------------------------
// Helpers
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

// Parse JSON body for POST requests
async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// OPTIONS preflight for all /api/drive-chain routes
// ---------------------------------------------------------------------------
app.use('/api/drive-chain', (req, res, next) => {
  if (req.method !== 'OPTIONS') return next();
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.writeHead(204);
  res.end();
});

// ============================================================================
// GET /api/drive-chain/sidechains — list all sidechains
// ============================================================================
app.use('/api/drive-chain/sidechains', async (req, res, next) => {
  // Only match exact path, not /sidechain/:id
  if (req.url !== '/sidechains' && req.url !== '/sidechains/') return next();
  if (req.method !== 'GET') return next();

  try {
    const sidechains = Sidechains.find({}, {
      sort: { sidechain_id: 1 },
      fields: {
        sidechain_id: 1, kingdom_handle: 1, state: 1, health: 1,
        last_block: 1, last_block_hash: 1, consensus: 1,
        block_producer: 1, created_at: 1, updated_at: 1,
      }
    }).fetch();

    const result = sidechains.map(sc => ({
      sidechain_id: sc.sidechain_id,
      kingdom_handle: sc.kingdom_handle,
      state: sc.state,
      health: sc.health || 'healthy',
      last_block: sc.last_block || 0,
      consensus: sc.consensus,
      block_producer: (sc.block_producer || '').substring(0, 16) + '...',
      created_at: sc.created_at,
      updated_at: sc.updated_at,
      _stub: !RustBridge.isConnected(),
    }));

    jsonOk(res, { status: 'ok', sidechains: result, count: result.length });
  } catch (err) {
    console.error('[API/drive-chain/sidechains] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ============================================================================
// GET /api/drive-chain/sidechain/:id — single sidechain detail
// ============================================================================
app.use('/api/drive-chain/sidechain', async (req, res, next) => {
  const match = req.url.match(/^\/(\d+)\/?$/);
  if (!match) return next();
  if (req.method !== 'GET') return next();

  const sidechainId = parseInt(match[1], 10);

  try {
    const sc = Sidechains.findOne({ sidechain_id: sidechainId });
    if (!sc) {
      return jsonErr(res, 404, `Sidechain ID ${sidechainId} not found`);
    }

    const state = KingdomSidechainState.findOne({ sidechain_id: sidechainId });

    jsonOk(res, {
      status: 'ok',
      sidechain: {
        sidechain_id: sc.sidechain_id,
        kingdom_handle: sc.kingdom_handle,
        kingdom_genesis_cid: sc.kingdom_genesis_cid,
        state: sc.state,
        health: sc.health || 'healthy',
        last_block: sc.last_block || 0,
        last_block_hash: sc.last_block_hash || null,
        genesis_block: sc.genesis_block || 0,
        consensus: sc.consensus,
        block_producer: sc.block_producer || null,
        block_time_seconds: sc.block_time_seconds || 60,
        mainchain: sc.mainchain || 'CDN',
        allocated_by: sc.allocated_by,
        allocated_at: sc.allocated_at,
        created_at: sc.created_at,
        updated_at: sc.updated_at,
        bridge_connected: RustBridge.isConnected(),
        daemon_state: state ? {
          status: state.status,
          last_indexed_mainchain: state.last_indexed_mainchain,
          last_produced_sidechain: state.last_produced_sidechain,
          last_bmm_height: state.last_bmm_height,
          deposits_processed: state.deposits_processed,
          withdrawals_processed: state.withdrawals_processed,
          bmm_commitments: state.bmm_commitments,
          blocks_produced: state.blocks_produced,
          errors_encountered: state.errors_encountered,
        } : null,
        _stub: !RustBridge.isConnected(),
      }
    });
  } catch (err) {
    console.error('[API/drive-chain/sidechain/:id] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ============================================================================
// POST /api/drive-chain/allocate — request sidechain allocation
// ============================================================================
app.use('/api/drive-chain/allocate', async (req, res, next) => {
  if (req.method !== 'POST') return next();

  try {
    const body = await readBody(req);
    const { kingdomHandle, kingdomGenesisCid, blockProducer, config } = body;

    if (!kingdomHandle || !kingdomGenesisCid || !blockProducer) {
      return jsonErr(res, 400, 'kingdomHandle, kingdomGenesisCid, and blockProducer are required');
    }

    // Find next available sidechain ID
    const nextId = SidechainManager.getNextAvailableId();

    if (nextId === null) {
      return jsonErr(res, 409, 'No sidechain IDs available in kingdom range (0x0001-0x7FFF). Contact CCT for expansion.');
    }

    const result = await SidechainManager.allocateSidechainId({
      sidechainId: nextId,
      kingdomHandle,
      kingdomGenesisCid,
      blockProducer,
      config: config || {},
      allocatedBy: 'cli',
    });

    if (!result.success) {
      return jsonErr(res, 400, result.error || 'Allocation failed');
    }

    jsonOk(res, {
      status: 'ok',
      sidechainId: result.sidechainId,
      sidechainDocId: result.sidechainDocId,
      config: result.config,
      _stub: !RustBridge.isConnected(),
    });
  } catch (err) {
    console.error('[API/drive-chain/allocate] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ============================================================================
// POST /api/drive-chain/deposit — initiate BIP 300 deposit
// ============================================================================
app.use('/api/drive-chain/deposit', async (req, res, next) => {
  if (req.method !== 'POST') return next();

  try {
    const body = await readBody(req);
    const { sidechainId, amountSatoshi, depositorAddress } = body;

    if (sidechainId === undefined || !amountSatoshi) {
      return jsonErr(res, 400, 'sidechainId and amountSatoshi are required');
    }

    if (amountSatoshi < MINIMUM_DEPOSIT_SATOSHI) {
      return jsonErr(res, 400, `Amount below minimum deposit (${MINIMUM_DEPOSIT_SATOSHI} satoshi)`);
    }

    // Check sidechain exists and is active
    const sc = Sidechains.findOne({ sidechain_id: sidechainId });
    if (!sc) {
      return jsonErr(res, 404, `Sidechain ID ${sidechainId} not found`);
    }
    if (sc.state !== SIDECHAIN_STATE_ACTIVE && sc.state !== SIDECHAIN_STATE_PENDING) {
      return jsonErr(res, 400, `Sidechain ${sidechainId} is in state '${sc.state}'. Deposits require active or pending state.`);
    }

    // Generate a deposit address (stub — real implementation uses HKDF derivation)
    const depositAddress = `CDN-deposit-${sidechainId}-${Date.now()}`;

    // Record the deposit in the collection
    const now = new Date();
    const depositDocId = SidechainDeposits.insert({
      sidechain_id: sidechainId,
      mainchain_txid: `pending-${sidechainId}-${Date.now()}`,
      mainchain_block: 0,
      mainchain_confirmations: 0,
      deposit_address: depositAddress,
      deposit_amount_satoshi: amountSatoshi,
      depositor_address: depositorAddress || 'unknown',
      sidechain_address: null,
      sidechain_txid: null,
      sidechain_block: null,
      entity_pubkey_hex: null,
      entity_handle: null,
      status: 'pending',
      created_at: now,
      updated_at: now,
    });

    // Notify via emitter (onDepositDetected: sidechainId, mainchainTxid, amountSatoshi, sidechainAddress)
    DriveChainDaemonEmitter.onDepositDetected(sidechainId, `pending-${sidechainId}-${now.getTime()}`, `${amountSatoshi}`, depositAddress);

    console.log(`[API/drive-chain/deposit] sidechain=${sidechainId} amount=${amountSatoshi} address=${depositAddress}`);

    jsonOk(res, {
      status: 'ok',
      sidechainId,
      amountSatoshi,
      depositAddress,
      depositDocId,
      depositTxid: `pending-${sidechainId}-${now.getTime()}`,
      confirmations: 0,
      _stub: !RustBridge.isConnected(),
    });
  } catch (err) {
    console.error('[API/drive-chain/deposit] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ============================================================================
// POST /api/drive-chain/withdraw — initiate withdrawal
// ============================================================================
app.use('/api/drive-chain/withdraw', async (req, res, next) => {
  if (req.method !== 'POST') return next();

  try {
    const body = await readBody(req);
    const { sidechainId, amountSatoshi, mainchainAddress } = body;

    if (sidechainId === undefined || !amountSatoshi) {
      return jsonErr(res, 400, 'sidechainId and amountSatoshi are required');
    }

    if (amountSatoshi < MINIMUM_WITHDRAWAL_SATOSHI) {
      return jsonErr(res, 400, `Amount below minimum withdrawal (${MINIMUM_WITHDRAWAL_SATOSHI} satoshi)`);
    }

    // Check sidechain exists and is in a withdrawable state
    const sc = Sidechains.findOne({ sidechain_id: sidechainId });
    if (!sc) {
      return jsonErr(res, 404, `Sidechain ID ${sidechainId} not found`);
    }
    if (sc.state !== SIDECHAIN_STATE_ACTIVE && sc.state !== SIDECHAIN_STATE_TERMINATING) {
      return jsonErr(res, 400, `Sidechain ${sidechainId} is in state '${sc.state}'. Withdrawals require active or terminating state.`);
    }

    const now = new Date();

    // Record the withdrawal request
    const withdrawalDocId = SidechainWithdrawals.insert({
      sidechain_id: sidechainId,
      type: 'request',
      amount_satoshi: amountSatoshi,
      mainchain_target_address: mainchainAddress || null,
      entity_pubkey_hex: null,
      entity_handle: null,
      sidechain_address: null,
      sidechain_txid: null,
      sidechain_block: null,
      status: 'pending',
      bundle_id: null,
      created_at: now,
      updated_at: now,
    });

    // Initiate withdrawal bundle submission via SidechainManager
    // (stub — real flow goes through WithdrawalManager → RustBridge)
    let bundleResult = null;
    try {
      bundleResult = await WithdrawalManager.requestWithdrawal({
        sidechainId,
        amountSatoshi,
        mainchainAddress: mainchainAddress || 'pending-address',
      });
    } catch (e) {
      // Withdrawal manager may not have requestWithdrawal — graceful fallback
      console.warn(`[API/drive-chain/withdraw] WithdrawalManager.requestWithdrawal not available: ${e.message}`);
    }

    // Notify via emitter (onWithdrawalSubmitted: sidechainId, bundleId, mainchainTxid, totalAmountSatoshi)
    DriveChainDaemonEmitter.onWithdrawalSubmitted(sidechainId, `pending-bundle-${now.getTime()}`, 'pending', `${amountSatoshi}`);

    console.log(`[API/drive-chain/withdraw] sidechain=${sidechainId} amount=${amountSatoshi}`);

    jsonOk(res, {
      status: 'ok',
      sidechainId,
      amountSatoshi,
      withdrawalDocId,
      failPeriodBlocks: sc.withdrawal_period_blocks || MAINCHAIN_WITHDRAWAL_PERIOD_BLOCKS_DEFAULT,
      bundleTxid: bundleResult?.mainchainTxid || 'pending',
      _stub: !RustBridge.isConnected(),
    });
  } catch (err) {
    console.error('[API/drive-chain/withdraw] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

// ============================================================================
// GET /api/drive-chain/bridge/health — bridge service health
// ============================================================================
app.use('/api/drive-chain/bridge/health', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  try {
    let health = { connected: false, serviceUrl: 'unknown', version: '0.0.0', uptime: 0 };

    try {
      const bridgeHealth = await RustBridge.healthCheck();
      health = {
        connected: RustBridge.isConnected(),
        serviceUrl: RustBridge.getServiceUrl() || 'http://127.0.0.1:9282',
        version: bridgeHealth.version || '0.0.0-stub',
        uptime: bridgeHealth.uptime || 0,
        _stub: bridgeHealth._stub || !RustBridge.isConnected(),
      };
    } catch (e) {
      health = {
        connected: false,
        serviceUrl: RustBridge.getServiceUrl() || 'http://127.0.0.1:9282',
        version: 'unreachable',
        uptime: 0,
        error: e.message,
        _stub: true,
      };
    }

    jsonOk(res, { status: 'ok', health });
  } catch (err) {
    console.error('[API/drive-chain/bridge/health] error:', err.message);
    jsonErr(res, 500, err.message);
  }
});

console.log('[daemon] drive-chain-api: mounted /api/drive-chain/* endpoints');
