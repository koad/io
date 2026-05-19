// Workspace → Entity mapping — daemon-side state owner
//
// The desktop Electron app polls xdotool get_desktop and calls
// `workspace.setState` via DDP. This method resolves the entity handle from
// the per-device config and marks it as selected in the Passengers collection.
//
// The widget client subscribes to the 'current' publication (already wired in
// application-logic.js) and reactively reflects the active entity.
//
// Config: ~/.koad-io/daemon/config/workspace-entities.json
//   { "0": "juno", "1": "vulcan", "default": "juno" }

const fs = Npm.require('fs');
const path = Npm.require('path');
const os = Npm.require('os');

// Local collection reference — same Mongo collection as declared in indexers/passengers.js.
// Meteor deduplicates by collection name so both refs hit the same underlying store.
const _Passengers = new Mongo.Collection('Passengers', { connection: null });

const CONFIG_PATH = path.join(
  process.env.HOME || os.homedir(),
  '.koad-io', 'daemon', 'config', 'workspace-entities.json'
);

/**
 * Read the workspace→entity mapping from disk.
 * Hot-editable without daemon restart.
 */
function loadWorkspaceMapping() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[WORKSPACE-ENTITY] Cannot read ${CONFIG_PATH}: ${err.message}`);
    return { default: 'juno' };
  }
}

/**
 * Resolve the entity handle for a given workspace number string.
 * Falls back to `default`, then to `'juno'`.
 */
function resolveHandle(workspaceStr, mapping) {
  return mapping[workspaceStr] || mapping['default'] || 'juno';
}

Meteor.methods({
  /**
   * Called by the desktop Electron main process when the X11 workspace changes.
   * Selects the mapped entity in the Passengers collection so all DDP clients
   * (widget, overview, any connected browser) reactively update.
   *
   * Returns { handle, workspace } on success.
   */
  'workspace.setState'(workspaceNumber) {
    check(workspaceNumber, Match.OneOf(String, Number));

    const workspaceStr = String(workspaceNumber);
    const mapping = loadWorkspaceMapping();
    const handle = resolveHandle(workspaceStr, mapping);

    // Select the matching passenger — same pattern as passenger.check.in
    const passenger = _Passengers.findOne({ handle });
    if (!passenger) {
      console.warn(`[WORKSPACE-ENTITY] ws${workspaceStr}: no passenger found for handle "${handle}" — check workspace-entities.json`);
      return { handle, workspace: workspaceStr, found: false };
    }

    _Passengers.update({}, { $unset: { selected: '' } }, { multi: true });
    _Passengers.update(passenger._id, { $set: { selected: new Date() } });

    console.log(`[WORKSPACE-ENTITY] ws${workspaceStr} → ${handle}`);
    return { handle, workspace: workspaceStr, found: true };
  },

  /**
   * Query the current active entity without changing it.
   * Desktop tray can call this on startup to seed its tooltip.
   */
  'workspace.getActive'() {
    const passenger = _Passengers.findOne({ selected: { $exists: true } });
    return passenger ? { handle: passenger.handle, name: passenger.name } : { handle: 'juno', name: 'juno' };
  },
});

console.log('[WORKSPACE-ENTITY] Daemon workspace→entity methods registered');
