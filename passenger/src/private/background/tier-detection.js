// tier-detection.js
//
// SPEC-196 §3 — three-tier connectivity probe.
//
//   Tier 1: ZeroTier local daemon (10.10.10.10:28282 by default)
//   Tier 2: Public lighthouse (operator-configured)
//   Tier 3: Offline fallback (localStorage sovereign profile)
//
// Detection is sequential, not parallel. Tier 1 is probed first; on failure,
// Tier 2; on failure, fallback to Tier 3. Heartbeat re-probes every 90s.
//
// Probe is a short-timeout HTTP GET on a health endpoint. Service worker
// imports `currentTier()` and `onTierChange()` to react.

const HEARTBEAT_MS = 90 * 1000;
const PROBE_TIMEOUT_MS = 3000;
const HEALTH_PATH = '/health';

const DEFAULT_TIER_1 = { host: '10.10.10.10', port: 28282, proto: 'http' };

let _tier = null;          // 1 | 2 | 3 | null (pre-probe)
let _lastProbedAt = 0;
let _heartbeatTimer = null;
const _listeners = new Set();

function emitChange() {
  for (const fn of _listeners) {
    try { fn(_tier); } catch (e) { console.warn('tier listener threw', e); }
  }
}

async function probeUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal, cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function probeTier1() {
  const stored = await chrome.storage.local.get('tier1');
  const t1 = Object.assign({}, DEFAULT_TIER_1, stored.tier1);
  return probeUrl(`${t1.proto}://${t1.host}:${t1.port}${HEALTH_PATH}`);
}

async function probeTier2() {
  const stored = await chrome.storage.local.get('tier2');
  const t2 = stored.tier2;
  // Tier 2 only probed if operator has configured a lighthouse URL.
  if (!t2 || !t2.host) return false;
  const proto = t2.proto || 'https';
  const port = t2.port ? `:${t2.port}` : '';
  return probeUrl(`${proto}://${t2.host}${port}${HEALTH_PATH}`);
}

async function detect() {
  _lastProbedAt = Date.now();
  if (await probeTier1()) return setTier(1);
  if (await probeTier2()) return setTier(2);
  return setTier(3);
}

function setTier(t) {
  if (_tier === t) return _tier;
  const prev = _tier;
  _tier = t;
  console.log('tier-detection: tier', prev, '→', t);
  emitChange();
  return _tier;
}

function start() {
  if (_heartbeatTimer !== null) return;
  detect().catch((e) => console.warn('initial probe failed', e));
  _heartbeatTimer = setInterval(() => {
    detect().catch((e) => console.warn('heartbeat probe failed', e));
  }, HEARTBEAT_MS);
}

function stop() {
  if (_heartbeatTimer !== null) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
}

function currentTier() {
  return _tier;
}

function onTierChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// Probe on demand — e.g. when a request fails and we suspect the tier changed.
async function probeNow() {
  return detect();
}

// Resolve the URL the panel iframe should load (Tier 1 or 2). For Tier 3
// the panel renders the fallback view; no URL is returned.
async function resolveWorkspaceUrl() {
  const stored = await chrome.storage.local.get(['workspaceUrl', 'tier1', 'tier2']);
  if (stored.workspaceUrl) return stored.workspaceUrl;
  if (_tier === 1) {
    const t1 = Object.assign({}, DEFAULT_TIER_1, stored.tier1);
    return `${t1.proto}://${t1.host}:${t1.port}/`;
  }
  if (_tier === 2 && stored.tier2 && stored.tier2.host) {
    const proto = stored.tier2.proto || 'https';
    const port = stored.tier2.port ? `:${stored.tier2.port}` : '';
    return `${proto}://${stored.tier2.host}${port}/`;
  }
  return null;
}

start();

export { currentTier, onTierChange, probeNow, resolveWorkspaceUrl };
