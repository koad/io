// workspace-entity-selector.js
//
// Per-workspace entity selection for the koad:io desktop.
//
// Polls the current X11 workspace via `xdotool get_desktop`, looks up the
// entity assignment in config/workspace-entities.json (per-device), and
// maintains an "active entity" in the main-process globalThis.Application
// state. Emits IPC events so renderer windows can reflect the change.
//
// Framework infrastructure — uses KOAD_IO_* env vars only, no entity vars.

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('../library/logger.js');

// ── Config ───────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(
  process.env.HOME || os.homedir(),
  '.koad-io', 'desktop', 'config', 'workspace-entities.json'
);

// How often (ms) to poll for workspace changes. 500 ms is fast enough to
// feel responsive without hammering xdotool.
const POLL_INTERVAL_MS = 500;

// ── Internal state ───────────────────────────────────────────────────────────

let _pollingTimer = null;
let _lastWorkspace = null;
let _changeListeners = []; // callbacks registered by other modules

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the workspace→entity mapping from disk. Re-reads each call so the
 * operator can hot-edit the file without restarting the app.
 *
 * Returns { "0": "juno", "1": "vulcan", "default": "juno" } shape.
 */
function loadMapping() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(`workspace-entity-selector: cannot read ${CONFIG_PATH}: ${err.message}`);
    return { default: 'juno' };
  }
}

/**
 * Scan ~/.<entity>/ENTITY.md to discover which entities the operator has on
 * disk. Returns an array of lower-case entity names.
 */
function discoverEntities() {
  const home = process.env.HOME || os.homedir();
  const found = [];
  try {
    const entries = fs.readdirSync(home, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      // Entity dirs are dotfiles: .juno, .vulcan, .muse, etc.
      if (!name.startsWith('.') || name.length < 2) continue;
      const entityName = name.slice(1); // strip leading dot
      const markerPath = path.join(home, name, 'ENTITY.md');
      if (fs.existsSync(markerPath)) {
        found.push(entityName);
      }
    }
  } catch (err) {
    logger.warn(`workspace-entity-selector: entity discovery failed: ${err.message}`);
  }
  return found;
}

/**
 * Get the current X11 workspace number as a string.
 * Returns null if xdotool is not available or the call fails.
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

/**
 * Resolve the entity name for a given workspace number string.
 * Falls back to `default`, then to `'juno'`.
 */
function resolveEntity(workspaceStr, mapping) {
  const entityName = mapping[workspaceStr] || mapping['default'] || 'juno';
  return entityName;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Return the currently active entity name (string).
 * Guaranteed to always return something — worst case `'juno'`.
 */
function getActiveEntity() {
  return (globalThis.Application && globalThis.Application.activeEntity) || 'juno';
}

/**
 * Return the list of discovered entities.
 */
function getAvailableEntities() {
  return (globalThis.Application && globalThis.Application.availableEntities) || [];
}

/**
 * Register a callback that fires whenever the active entity changes.
 * Callback receives (entityName, workspaceNumber) both as strings.
 */
function onEntityChange(callback) {
  _changeListeners.push(callback);
}

/**
 * Apply an entity change: update Application state, fire listeners.
 * Idempotent — skips the update if entity is already the same.
 */
function applyEntityChange(entityName, workspaceStr) {
  const previous = getActiveEntity();
  if (previous === entityName) return; // no change

  globalThis.Application.activeEntity = entityName;
  globalThis.Application.activeWorkspace = workspaceStr;

  logger.info(`workspace-entity-selector: workspace ${workspaceStr} → entity "${entityName}" (was "${previous}")`);

  for (const cb of _changeListeners) {
    try { cb(entityName, workspaceStr); } catch (e) {
      logger.warn(`workspace-entity-selector: listener error: ${e.message}`);
    }
  }
}

/**
 * Single poll tick. Reads current workspace, resolves entity, applies change
 * if needed.
 */
function tick() {
  const workspaceStr = getCurrentWorkspace();

  // If xdotool is unavailable (non-X11 env), bail silently after first warning.
  if (workspaceStr === null) {
    if (_lastWorkspace !== 'unavailable') {
      logger.warn('workspace-entity-selector: xdotool get_desktop unavailable — workspace tracking disabled');
      _lastWorkspace = 'unavailable';
    }
    return;
  }

  if (workspaceStr === _lastWorkspace) return; // workspace unchanged
  _lastWorkspace = workspaceStr;

  const mapping = loadMapping();
  const entityName = resolveEntity(workspaceStr, mapping);
  applyEntityChange(entityName, workspaceStr);
}

/**
 * Start polling. Wires into globalThis.Application, discovers entities,
 * runs an immediate tick, then starts the interval.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 */
function startWorkspaceEntitySelector() {
  if (_pollingTimer !== null) return; // already running

  logger.info('workspace-entity-selector: starting');

  // Seed Application state
  if (!globalThis.Application) globalThis.Application = {};
  if (!globalThis.Application.activeEntity) globalThis.Application.activeEntity = 'juno';
  if (!globalThis.Application.activeWorkspace) globalThis.Application.activeWorkspace = '0';

  // Discover entities on disk once at startup
  const available = discoverEntities();
  globalThis.Application.availableEntities = available;
  logger.info(`workspace-entity-selector: discovered entities: [${available.join(', ')}]`);

  // Immediate first tick
  tick();

  // Then poll
  _pollingTimer = setInterval(tick, POLL_INTERVAL_MS);

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
  getActiveEntity,
  getAvailableEntities,
  onEntityChange,
  // exposed for testing
  discoverEntities,
  resolveEntity,
  loadMapping,
  getCurrentWorkspace,
};
