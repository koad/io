/**
 * koad:io-event-logger — Signale middleware
 *
 * Tier 2: intercepts logger.error / .warning / .alert / .fatal / .danger / .denied
 * and writes captured events to the local malfunctions (ClientErrors) collection.
 *
 * Tier 3: when koad:io-telemetry-agent is also loaded and Kadira has connected,
 * additionally forwards the event to Kadira's error model for APM visibility.
 *
 * This file runs after koad:io-core has initialised the `logger` global.
 * It installs thin wrappers around the relevant Signale methods — same pattern
 * koad used in core/server/logger.js for .error / .denied / .alert, but moved
 * here so Tier 1 apps (core only) stay zero-persistence.
 *
 * We do NOT call Meteor.call('logEvent') internally — that routes over DDP
 * and is problematic for server-side callers in Meteor 3.  Instead we write
 * directly to ClientErrors and call Kadira.trackError() from this file only.
 */

import os from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal event record suitable for ClientErrors.insertAsync().
 * Mirrors the shape the logEvent Meteor.method produces.
 */
function buildRecord (level, args) {
  const message = args
    .map(a => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');

  return {
    message,
    type: level.toUpperCase(),
    method: 'SERVER::LOGGER',
    class: level === 'error' || level === 'fatal' || level === 'danger' ? 'danger' : 'warning',
    icon: 'fa fa-warning',
    route: 'server://',
    connection: 'server://',
    user: 'localhost',
    date: new Date(),
    nodeVer: process.version,
    host: os.hostname(),
    instance: process.env.KOAD_IO_INSTANCE || 'unknown',
    service: process.env.KOAD_IO_TYPE || 'unknown',
    dump: false
  };
}

/**
 * Forward a captured event to Kadira's error model (Tier 3).
 * Guards: agent package must be present AND Kadira.connected must be true.
 * If Kadira.trackError doesn't exist yet (agent loaded but not connected),
 * we silently skip — the local record in Tier 2 is still written.
 */
function forwardToKadira (level, message, stack) {
  if (!Package['koad:io-telemetry-agent']) return;
  if (typeof Kadira === 'undefined' || !Kadira.connected) return;
  if (typeof Kadira.trackError !== 'function') return;

  try {
    const ex = { message, stack: stack || new Error().stack };
    Kadira.trackError(ex, { type: 'server-logger', subType: level });
  } catch (_) {
    // never let APM forwarding break the app
  }
}

// ---------------------------------------------------------------------------
// Wrap logger methods
// ---------------------------------------------------------------------------

/**
 * Wrap a single Signale method on the `logger` global.
 * The original call happens first (Tier 1), then local persist (Tier 2),
 * then optional APM forward (Tier 3).
 */
function wrapLevel (level) {
  const original = logger[level];
  if (typeof original !== 'function') return;

  logger[level] = function (...args) {
    // Tier 1 — original Signale terminal output (core may have wrapped this too).
    // Wrapped in try/catch: core's .error/.denied/.alert wrappers call koad.error()
    // which may be undefined (see logger.js TODO) — don't let that block Tier 2/3.
    try { original.apply(logger, args); } catch (_) {}

    // Tier 2 — local persistence to ClientErrors (malfunctions collection)
    // Fire-and-forget; we intentionally do not await here to avoid blocking
    // synchronous caller code.  Errors in the insert are swallowed so a
    // DB problem never silences the terminal logger.
    const record = buildRecord(level, args);
    ClientErrors.insertAsync(record).catch(err => {
      // Use process.stderr so we don't recurse into logger
      process.stderr.write(`[koad:io-event-logger] insert failed: ${err.message}\n`);
    });

    // Tier 3 — APM forward (no-op if agent absent or not connected)
    const message = record.message;
    const stack = args.find(a => a && typeof a === 'object' && a.stack)?.stack
      || new Error().stack;
    forwardToKadira(level, message, stack);
  };
}

// Levels that represent "handled but should be alerted" signal.
// Matches the logger.js custom types marked logLevel:'error' or logLevel:'warn'.
const ALERTABLE_LEVELS = ['error', 'warning', 'alert', 'fatal', 'danger', 'denied'];

/**
 * Meteor.startup defers wiring until after all packages have loaded,
 * which is when `logger` is guaranteed to be the fully-configured Signale
 * instance from koad:io-core.  Wrapping at module evaluation time would
 * run before core's own overrides (the .error / .denied / .alert wrappers)
 * and could lose those.  Startup fires after all addFiles, so we compose
 * on top of whatever core already installed.
 */
Meteor.startup(() => {
  // Fill the koad.error() hook that core/server/logger.js calls but that was
  // never implemented (the TODO in that file).  Now that the event-logger is
  // present, we fulfil it: route koad.error() calls into ClientErrors and APM.
  // Signature from logger.js call sites:
  //   koad.error(code, message, stack)     — numeric code variant
  //   koad.error({ code, message, stack }) — object variant
  koad.error = function (codeOrObj, message, stack) {
    let record;
    if (codeOrObj && typeof codeOrObj === 'object') {
      record = buildRecord('error', [codeOrObj.message || JSON.stringify(codeOrObj)]);
      record.code = codeOrObj.code;
      if (codeOrObj.stack) record.stack = codeOrObj.stack;
    } else {
      record = buildRecord('error', [message || String(codeOrObj)]);
      record.code = codeOrObj;
      if (stack) record.stack = stack;
    }

    ClientErrors.insertAsync(record).catch(err => {
      process.stderr.write(`[koad:io-event-logger] koad.error insert failed: ${err.message}\n`);
    });

    forwardToKadira('error', record.message, record.stack);
  };

  ALERTABLE_LEVELS.forEach(wrapLevel);
  logger.success('[koad:io-event-logger] Signale middleware installed (Tier 2' +
    (Package['koad:io-telemetry-agent'] ? '+3' : '') + ')');
});
