// workspace-entity-selector.js
//
// Thin X11 workspace reporter for the koad:io desktop.
//
// Polls the current X11 workspace via `xdotool get_desktop` and reports the
// workspace number to the daemon via DDP (workspace.setState). The daemon owns
// all state: the workspace→entity mapping, entity discovery, and the reactive
// "which entity is active right now" — published via the 'current' DDP publication.
//
// This module holds NO local state beyond the polling timer and the last-seen
// workspace number (used only to skip redundant DDP calls).
//
// Framework infrastructure — uses KOAD_IO_* env vars only, no entity vars.

'use strict';

const { spawnSync } = require('child_process');
const { logger } = require('../library/logger.js');

// How often (ms) to poll for workspace changes.
const POLL_INTERVAL_MS = 500;

// ── Internal state ───────────────────────────────────────────────────────────

let _pollingTimer = null;
let _lastWorkspace = null;
let _onChangeCbs = []; // optional local listeners (e.g. tray tooltip update)

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the current X11 workspace number as a string.
 * Returns null if xdotool is unavailable or the call fails.
 */
function getCurrentWorkspace() {
  try {
    const result = spawnSync('xdotool', ['get_desktop'], { timeout: 500 });
    if (result.status !== 0 || result.error) return null;
    return result.stdout.toString().trim();
  } catch (_) {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a callback that fires whenever the workspace changes.
 * Callback receives (workspaceNumber) as a string.
 * Useful for tray tooltip updates — the entity name must be fetched from the
 * daemon, not resolved locally.
 */
function onWorkspaceChange(callback) {
  _onChangeCbs.push(callback);
}

/**
 * Single poll tick. Reads current workspace; if changed, calls
 * `workspace.setState` on the daemon via the daemonCall helper.
 */
function tick(daemonCall) {
  const workspaceStr = getCurrentWorkspace();

  if (workspaceStr === null) {
    if (_lastWorkspace !== 'unavailable') {
      logger.warn('workspace-entity-selector: xdotool unavailable — workspace reporting disabled');
      _lastWorkspace = 'unavailable';
    }
    return;
  }

  if (workspaceStr === _lastWorkspace) return; // no change
  _lastWorkspace = workspaceStr;

  logger.info(`workspace-entity-selector: workspace changed → ${workspaceStr}`);

  // Report to daemon. Daemon owns the mapping and updates the Passengers collection.
  daemonCall('workspace.setState', workspaceStr)
    .then((result) => {
      if (result && result.handle) {
        logger.info(`workspace-entity-selector: daemon confirmed ws${workspaceStr} → ${result.handle}`);
        for (const cb of _onChangeCbs) {
          try { cb(workspaceStr, result.handle); } catch (e) {
            logger.warn(`workspace-entity-selector: listener error: ${e.message}`);
          }
        }
      }
    })
    .catch((err) => {
      logger.warn(`workspace-entity-selector: workspace.setState failed: ${err && err.message || err}`);
    });
}

/**
 * Start polling. Requires a `daemonCall` function from tray.js (the live DDP
 * connection proxy). Safe to call multiple times — subsequent calls are no-ops.
 */
function startWorkspaceEntitySelector(daemonCall) {
  if (_pollingTimer !== null) return;

  logger.info('workspace-entity-selector: starting (thin reporter — state lives in daemon)');

  // Immediate first tick
  tick(daemonCall);

  // Then poll
  _pollingTimer = setInterval(() => tick(daemonCall), POLL_INTERVAL_MS);

  logger.info('workspace-entity-selector: polling active');
}

/**
 * Stop polling. For clean shutdown in `will-quit`.
 */
function stopWorkspaceEntitySelector() {
  if (_pollingTimer !== null) {
    clearInterval(_pollingTimer);
    _pollingTimer = null;
    logger.info('workspace-entity-selector: stopped');
  }
}

module.exports = {
  startWorkspaceEntitySelector,
  stopWorkspaceEntitySelector,
  onWorkspaceChange,
  // exposed for testing
  getCurrentWorkspace,
};
