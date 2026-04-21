// indexer-registry.js — pluggable daemon indexer discovery
//
// Loads indexer configs from two sources and merges them:
//   1. Meteor.settings.indexers  (object: name → config, operator override)
//   2. Scan $HOME/.* and $HOME/.forge/* for .koad-io-index.yaml files
//
// Settings.json wins on name collision.
//
// Config shape (yaml or settings.json equivalent):
//
//   indexers:
//     - name: announcement-surface
//       source: data/announcement.jsonl   # relative to yaml file, or absolute
//       collection: AnnouncementSurface
//       format: jsonl
//       mode: current-per-key
//       key: _id
//
// Modes:
//   current-per-key — last entry per key is the doc (e.g. announcement surface)
//   append-only     — every entry is a new doc (e.g. archive, tips)

const fs   = Npm.require('fs');
const path = Npm.require('path');
const os   = Npm.require('os');

const HOME = os.homedir();

// ---------------------------------------------------------------------------
// Minimal YAML parser — handles the simple .koad-io-index.yaml format only.
// Not a general YAML parser. Handles:
//   - top-level "indexers:" list
//   - list items starting with "  - name:"
//   - string values (quoted or unquoted)
// ---------------------------------------------------------------------------

function parseIndexYaml(text, filePath) {
  const lines = text.split('\n');
  const indexers = [];
  let current = null;
  let inIndexers = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Skip blank lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Top-level "indexers:" key
    if (/^indexers\s*:/.test(line)) {
      inIndexers = true;
      continue;
    }

    if (!inIndexers) continue;

    // New list item
    if (/^\s{2}-\s+name\s*:/.test(line) || /^-\s+name\s*:/.test(line)) {
      if (current) indexers.push(current);
      const nameVal = line.replace(/^[\s-]+name\s*:\s*/, '').replace(/['"]/g, '').trim();
      current = { name: nameVal, _yamlFile: filePath };
      continue;
    }

    // Continuation key under current item (indented, no leading dash)
    if (current && /^\s+[a-zA-Z_]+\s*:/.test(line)) {
      const match = line.match(/^\s+([a-zA-Z_]+)\s*:\s*(.*)/);
      if (match) {
        const key = match[1].trim();
        const val = match[2].replace(/['"]/g, '').trim();
        current[key] = val;
      }
      continue;
    }
  }

  if (current) indexers.push(current);
  return indexers;
}

// ---------------------------------------------------------------------------
// Resolve source path relative to the yaml file's directory (or absolute).
// ---------------------------------------------------------------------------

function resolveSource(config) {
  if (!config.source) return null;
  if (path.isAbsolute(config.source)) return config.source;
  if (config._yamlFile) {
    return path.resolve(path.dirname(config._yamlFile), config.source);
  }
  return config.source;
}

// ---------------------------------------------------------------------------
// Scan directories for .koad-io-index.yaml files.
// Scans: $HOME/.*/  and  $HOME/.forge/*/
// ---------------------------------------------------------------------------

function scanForYamlFiles() {
  const yamlFiles = [];

  function tryDir(dir) {
    const candidate = path.join(dir, '.koad-io-index.yaml');
    try {
      fs.accessSync(candidate, fs.constants.R_OK);
      yamlFiles.push(candidate);
    } catch (_) { /* not present */ }
  }

  // $HOME/.*/ directories
  try {
    const homeEntries = fs.readdirSync(HOME, { withFileTypes: true });
    for (const entry of homeEntries) {
      if (entry.isDirectory() && entry.name.startsWith('.')) {
        tryDir(path.join(HOME, entry.name));
      }
    }
  } catch (_) { /* HOME unreadable */ }

  // $HOME/.forge/*/
  const forgeDir = path.join(HOME, '.forge');
  try {
    const forgeEntries = fs.readdirSync(forgeDir, { withFileTypes: true });
    for (const entry of forgeEntries) {
      if (entry.isDirectory()) {
        tryDir(path.join(forgeDir, entry.name));
      }
    }
  } catch (_) { /* .forge absent */ }

  return yamlFiles;
}

// ---------------------------------------------------------------------------
// Load all indexer configs. Returns array of normalized config objects.
// ---------------------------------------------------------------------------

function load() {
  const byName = {}; // name → config (settings.json wins)

  // 1. Meteor.settings.indexers (optional, operator override)
  const settingsIndexers = (Meteor.settings && Meteor.settings.indexers) ? Meteor.settings.indexers : [];
  const settingsList = Array.isArray(settingsIndexers)
    ? settingsIndexers
    : Object.entries(settingsIndexers).map(([name, cfg]) => Object.assign({ name }, cfg));

  for (const cfg of settingsList) {
    if (!cfg.name) continue;
    byName[cfg.name] = Object.assign({}, cfg, { _source: 'settings' });
  }

  // 2. File-based discovery (.koad-io-index.yaml)
  const yamlFiles = scanForYamlFiles();
  console.log(`[indexer-registry] scanning: found ${yamlFiles.length} .koad-io-index.yaml file(s)`);

  for (const yamlFile of yamlFiles) {
    try {
      const text = fs.readFileSync(yamlFile, 'utf8');
      const fileIndexers = parseIndexYaml(text, yamlFile);
      for (const cfg of fileIndexers) {
        if (!cfg.name) continue;
        if (byName[cfg.name]) {
          // Settings.json already has this name — skip (settings wins)
          console.log(`[indexer-registry] ${cfg.name}: settings.json overrides ${yamlFile}`);
          continue;
        }
        byName[cfg.name] = Object.assign({}, cfg, {
          _source: yamlFile,
          sourcePath: resolveSource(cfg),
        });
      }
      console.log(`[indexer-registry] loaded ${fileIndexers.length} indexer(s) from ${yamlFile}`);
    } catch (err) {
      console.warn(`[indexer-registry] failed to parse ${yamlFile}:`, err.message);
    }
  }

  // Normalize all configs: resolve source paths for settings-sourced configs
  const configs = Object.values(byName).map(cfg => {
    if (!cfg.sourcePath && cfg.source) {
      cfg = Object.assign({}, cfg, { sourcePath: resolveSource(cfg) });
    }
    return cfg;
  });

  console.log(`[indexer-registry] total indexers registered: ${configs.length}`);
  for (const cfg of configs) {
    console.log(`[indexer-registry]   ${cfg.name} → ${cfg.collection} (${cfg.mode || 'append-only'}) from ${cfg.sourcePath || cfg.source || '?'}`);
  }

  return configs;
}

// Export
globalThis.IndexerRegistry = { load };
