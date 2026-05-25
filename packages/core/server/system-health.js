const os = Npm.require('os');
const { monitorEventLoopDelay, PerformanceObserver } = Npm.require('perf_hooks');

koad.system = koad.system || {};

// ---------------------------------------------------------------------------
// Event-loop block detector — every koad:io Meteor app gets this for free.
//
// `monitorEventLoopDelay` samples the lag between when a setImmediate is
// scheduled and when it fires, every `resolution` ms. The histogram captures
// the distribution of that lag. When the event loop is blocked by sync I/O,
// CPU work, or a stuck await, the next scheduled tick fires late — so the
// lag spikes correspond directly to "how long was the loop stuck."
//
// Counters added on top:
//   blockCount    — # of histogram samples that exceeded BLOCK_THRESHOLD_MS
//                   since the last reset (default 100ms = a noticeable hitch)
//   maxSinceStart — running max in ms, never resets unless asked
//   lastBlock     — { duration_ms, at } of the most recent threshold-crossing
// ---------------------------------------------------------------------------
const _eventLoopHist = monitorEventLoopDelay({ resolution: 20 });
_eventLoopHist.enable();

const BLOCK_THRESHOLD_MS = 100;  // anything above this counts as a "real" hitch
let _blockCount         = 0;
let _maxSinceStart      = 0;
let _lastBlock          = null;
let _lastReadAt         = Date.now();

// Sampler runs separately from the histogram itself, on a 1s setInterval,
// so block-count math stays incremental rather than reading the whole
// distribution each time.
const _sampler = setInterval(() => {
  // _eventLoopHist.max is in nanoseconds, reset by .reset() only.
  // We track the local max via a sliding read: if this sample shows a max
  // higher than what we've previously observed, log it.
  const curMaxMs = _eventLoopHist.max / 1e6;
  if (curMaxMs > _maxSinceStart) {
    _maxSinceStart = curMaxMs;
  }
  // The histogram tracks the cumulative max since last reset. We can't
  // ask it directly for "did a new spike happen in the last second" without
  // an explicit window. So instead: if curMaxMs > BLOCK_THRESHOLD_MS and
  // it's >= our last-recorded lastBlock.duration_ms, we treat this tick
  // as having seen a block. Simpler than maintaining a windowed histogram.
  if (curMaxMs >= BLOCK_THRESHOLD_MS) {
    if (!_lastBlock || curMaxMs > _lastBlock.duration_ms) {
      _lastBlock = { duration_ms: +curMaxMs.toFixed(2), at: new Date().toISOString() };
      _blockCount++;
    }
  }
}, 1000);
_sampler.unref?.();

koad.system.eventLoop = function (opts) {
  opts = opts || {};
  const hist = _eventLoopHist;
  const result = {
    min_ms:  +(hist.min  / 1e6).toFixed(2),
    mean_ms: +(hist.mean / 1e6).toFixed(2),
    p50_ms:  +(hist.percentile(50) / 1e6).toFixed(2),
    p95_ms:  +(hist.percentile(95) / 1e6).toFixed(2),
    p99_ms:  +(hist.percentile(99) / 1e6).toFixed(2),
    p999_ms: +(hist.percentile(99.9) / 1e6).toFixed(2),
    max_ms:  +(hist.max  / 1e6).toFixed(2),
    stddev_ms: +(hist.stddev / 1e6).toFixed(2),
    exceeds: hist.exceeds,
    block_threshold_ms: BLOCK_THRESHOLD_MS,
    block_count: _blockCount,
    max_since_start_ms: +_maxSinceStart.toFixed(2),
    last_block: _lastBlock,
    window_since: new Date(_lastReadAt).toISOString(),
  };
  if (opts.reset) {
    hist.reset();
    _blockCount = 0;
    _lastBlock  = null;
    _lastReadAt = Date.now();
  }
  return result;
};

koad.system.eventLoop.reset = function () {
  _eventLoopHist.reset();
  _blockCount = 0;
  _lastBlock  = null;
  _lastReadAt = Date.now();
};

// Garbage-collection pause observer — separately accumulates GC-induced
// blocks since GC is one of the dominant block causes in Meteor apps.
let _gcStats = { count: 0, total_ms: 0, max_ms: 0, last: null };
try {
  const obs = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      _gcStats.count++;
      _gcStats.total_ms += entry.duration;
      if (entry.duration > _gcStats.max_ms) {
        _gcStats.max_ms = entry.duration;
        _gcStats.last = {
          duration_ms: +entry.duration.toFixed(2),
          kind: entry.detail?.kind,
          at: new Date().toISOString(),
        };
      }
    }
  });
  obs.observe({ entryTypes: ['gc'], buffered: false });
} catch (e) {
  // PerformanceObserver gc-type might not be available in all node versions
}

koad.system.gc = function () {
  return {
    count: _gcStats.count,
    total_ms: +_gcStats.total_ms.toFixed(2),
    max_ms: +_gcStats.max_ms.toFixed(2),
    last: _gcStats.last,
  };
};

koad.system.health = function () {
  const cpus = os.cpus();
  const totalmem = os.totalmem();
  const freemem = os.freemem();
  const loadavg = os.loadavg();

  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime(),
    cores: cpus.length,
    loadavg: {
      '1m': loadavg[0],
      '5m': loadavg[1],
      '15m': loadavg[2],
    },
    memory: {
      total: totalmem,
      free: freemem,
      used: totalmem - freemem,
      percent: Math.round(((totalmem - freemem) / totalmem) * 100),
    },
    eventLoop: koad.system.eventLoop(),
    gc:        koad.system.gc(),
  };
};

koad.system.loadavg = function () {
  const loadavg = os.loadavg();
  return {
    '1m': loadavg[0],
    '5m': loadavg[1],
    '15m': loadavg[2],
    cores: os.cpus().length,
  };
};

koad.system.memory = function () {
  const totalmem = os.totalmem();
  const freemem = os.freemem();
  return {
    total: totalmem,
    free: freemem,
    used: totalmem - freemem,
    percent: Math.round(((totalmem - freemem) / totalmem) * 100),
  };
};

log.success('loaded koad-io-core/system-health');
