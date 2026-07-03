// server/config.js — entities package mode detection
//
// Three modes, determined by env at startup:
//   scanner  — KOAD_IO_ENTITY_SCANNER=true or KOAD_IO_ENTITY_SCANNER_LIST=...
//              Scans ~/. dirs, generates origin.json on first boot,
//              stamps every entity with source. Populates koad.library.
//   remote   — KOAD_IO_ENTITY_REMOTE=http://upstreamA:28282[,upstreamB:28282,...]
//              DDP-subscribes each upstream, merges into koad.indexes.
//              source carries through — consumers know where each entity
//              lives. Vanity endpoints proxy to home upstream.
//   off      — neither set. Collections exist empty, no endpoints registered.
//
// One scanner per machine (owns the entities on that disk). Consumers
// (musium, control-tower, websites) run remote mode, pointing at one or
// more upstreams. Multiple machines = each scans its own disk, consumers
// merge the full set.

const SCANNER      = process.env.KOAD_IO_ENTITY_SCANNER === 'true';
const SCANNER_LIST = (process.env.KOAD_IO_ENTITY_SCANNER_LIST || '').trim();
const REMOTE_RAW   = (process.env.KOAD_IO_ENTITY_REMOTE || '').trim();
const REMOTE_LIST  = REMOTE_RAW ? REMOTE_RAW.split(',').map(s => s.trim()).filter(Boolean) : null;

EntityPackage = {
  mode: SCANNER || SCANNER_LIST ? 'scanner' : (REMOTE_LIST ? 'remote' : 'off'),
  scannerList: SCANNER_LIST ? SCANNER_LIST.split(',').map(s => s.trim()).filter(Boolean) : null,
  remoteList: REMOTE_LIST,
  isScanner: SCANNER || !!SCANNER_LIST,
  isRemote: !!REMOTE_LIST,
  isOff: !SCANNER && !SCANNER_LIST && !REMOTE_LIST,
};

// In curated mode, only serve vanity endpoints for listed entities.
// Greedy mode serves all. Remote mode proxies (upstream decides).
EntityPackage.serves = function (handle) {
  if (!this.isScanner) return false;   // remote/off — not our call
  if (!this.scannerList) return true;   // greedy — serve all
  return this.scannerList.includes(handle); // curated — check list
};

log.debug(`entities package: mode=${EntityPackage.mode}` +
  (EntityPackage.isScanner ? ` list=${EntityPackage.scannerList || 'greedy'}` : '') +
  (EntityPackage.isRemote  ? ` remotes=${REMOTE_LIST.length}` : ''));
