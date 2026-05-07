// session-sidecar-projector.js — always on
// Bridges opencode sidecar telemetry from emission.meta.sidecar into HarnessSessions.
//
// The opencode sidecar (~/.forge/commands/harness/opencode/sidecar.py) emits
// lifecycle updates every ~3s carrying meta.sidecar.{cost, tokensIn, tokensOut,
// model, provider, activeSessionId}. This indexer observes those emissions and
// projects the telemetry into the canonical HarnessSessions record for the entity.
//
// Write path: Emissions.find({ 'meta.sidecar': { $exists: true } }).observeChanges
//   → for each added/changed emission: resolve entity+host+pid → upsertSession()
//
// pid resolution: reads ~/.<entity>/.local/state/harness/harness.pid (same path
// as session-scanner). Skips the event if pid is missing or dead — the pid-scanner
// will have already tombstoned the session. No polling, no re-scans.
//
// Source tag: 'sidecar' (via $addToSet in upsertSession).

const fs = Npm.require('fs');
const path = Npm.require('path');
const os = Npm.require('os');

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

function readHarnessPid(entityPath) {
  const pidFile = path.join(entityPath, '.local', 'state', 'harness', 'harness.pid');
  try {
    const raw = fs.readFileSync(pidFile, 'utf8').trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch (e) {
    return null;
  }
}

function projectSidecar(emission) {
  const entity = emission.entity;
  if (!entity) return;

  const sidecar = emission.meta && emission.meta.sidecar;
  if (!sidecar) return;

  const entityPath = path.join(process.env.HOME, '.' + entity);
  const pid = readHarnessPid(entityPath);
  if (!pid) {
    // No harness pid — sidecar may be orphaned or harness hasn't registered yet
    return;
  }
  if (!pidAlive(pid)) {
    // Stale sidecar data — pid-scanner handles tombstoning, skip
    return;
  }

  const host = os.hostname();

  const enrichment = {
    source: 'sidecar',
    harness: 'opencode',
  };

  if (sidecar.cost !== undefined)      enrichment.cost      = Number(sidecar.cost);
  if (sidecar.tokensIn !== undefined)  enrichment.tokensIn  = Number(sidecar.tokensIn);
  if (sidecar.tokensOut !== undefined) enrichment.tokensOut = Number(sidecar.tokensOut);
  if (sidecar.model !== undefined) {
    enrichment.model   = sidecar.model;
    enrichment.modelId = sidecar.model;
  }
  if (sidecar.provider !== undefined)  enrichment.provider  = sidecar.provider;
  if (sidecar.contextPct !== undefined)   enrichment.contextPct   = Number(sidecar.contextPct);
  if (sidecar.contextLimit !== undefined) enrichment.contextLimit = Number(sidecar.contextLimit);

  // cwd — read from emission.meta.cwd (set by opencode launcher at session open)
  if (emission.meta && emission.meta.cwd && !enrichment.cwd) {
    enrichment.cwd = emission.meta.cwd;
  }

  // Only set sessionId if the canonical record doesn't already have one —
  // avoids stomping Claude Code sessionId with opencode's activeSessionId.
  const Sessions = globalThis.SessionsCollection;
  if (Sessions && sidecar.activeSessionId) {
    const existing = Sessions.findOne({ entity, host, pid });
    if (!existing || !existing.sessionId) {
      enrichment.sessionId = sidecar.activeSessionId;
    }
  }

  // upsertSession is exported from session-scanner.js via globalThis.
  // (Control-tower uses Meteor modules/ecmascript, so functions are not
  // automatically global — globalThis is the cross-file bridge.)
  if (typeof globalThis.upsertSession !== 'function') {
    console.error('[SESSION-SIDECAR-PROJECTOR] globalThis.upsertSession not available — session-scanner may not have loaded yet');
    return;
  }
  globalThis.upsertSession(entity, host, pid, enrichment);
}

Meteor.startup(() => {
  koad.ready.register('sidecarProjector');
  // Slight delay to ensure session-scanner has registered upsertSession and
  // populated EntityScanner before we start observing.
  Meteor.setTimeout(() => {
    const Emissions = globalThis.EmissionsCollection;
    if (!Emissions) {
      console.error('[SESSION-SIDECAR-PROJECTOR] EmissionsCollection not available — projector inactive');
      koad.ready.signal('sidecarProjector');
      return;
    }

    console.log('[SESSION-SIDECAR-PROJECTOR] observing emission.meta.sidecar updates');

    Emissions.find({ 'meta.sidecar': { $exists: true } }).observeChanges({
      added(_id, fields) {
        try {
          projectSidecar(fields);
        } catch (e) {
          console.error('[SESSION-SIDECAR-PROJECTOR] error on added:', e.message);
        }
      },
      changed(_id, fields) {
        if (!fields.meta || !fields.meta.sidecar) return;
        // fields on 'changed' only contain the diff — we need the full doc for entity
        const Emissions = globalThis.EmissionsCollection;
        if (!Emissions) return;
        try {
          const full = Emissions.findOne(_id);
          if (full) projectSidecar(full);
        } catch (e) {
          console.error('[SESSION-SIDECAR-PROJECTOR] error on changed:', e.message);
        }
      },
    });

    if (!globalThis.indexerReady) globalThis.indexerReady = {};
    globalThis.indexerReady.sidecarProjector = new Date().toISOString();
    koad.ready.signal('sidecarProjector');
  }, 3000); // 3s after startup — session-scanner fires at 2s, we need it ready first
});
