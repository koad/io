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
//   Composite key (VESTA-SPEC-141 §10.6) — list form:
//     - name: permission-decrees
//       source: data/permission-decrees.jsonl
//       collection: PermissionDecrees
//       format: jsonl
//       mode: current-per-key
//       key:
//         - handle
//         - feature
//       key_resolution: last-timestamp   # optional; 'composite' also accepted
//
//   For glob sources (VESTA-SPEC-141 v1.2 §3.5):
//     - name: channel-turns
//       source_glob: "*.jsonl"            # glob pattern; mutually exclusive with source
//       collection: ChannelTurns
//       format: jsonl
//       mode: append-only                 # MUST be append-only for source_glob
//       slug_field: slug                  # required; field projector injects per record
//       exclude_glob: "index.jsonl"       # optional; files matching this are excluded
//
// Modes:
//   current-per-key — last entry per key is the doc (e.g. announcement surface)
//   append-only     — every entry is a new doc (e.g. archive, tips)

const fs     = Npm.require('fs');
const path   = Npm.require('path');
const os     = Npm.require('os');
const crypto = Npm.require('crypto');

const HOME = os.homedir();

// ---------------------------------------------------------------------------
// Minimal YAML parser — handles the simple .koad-io-index.yaml format only.
// Not a general YAML parser. Handles:
//   - top-level "entity:" field (injected into each indexer as entity)
//   - top-level "indexers:" list
//   - list items starting with "  - name:"
//   - string values (quoted or unquoted)
//   - list-valued fields (VESTA-SPEC-141 §10.6): key field as YAML list
//     e.g.  key:
//             - handle
//             - feature
//     → stored as a JS array; projector joins with ":" at query time
// ---------------------------------------------------------------------------

function parseIndexYaml(text, filePath) {
  const lines = text.split('\n');
  const indexers = [];
  let current = null;
  let inIndexers = false;
  let topLevelEntity = null;
  // Track whether we're inside a list-valued field (e.g. key:) and which field
  let listFieldName = null;  // field name whose value is being collected as a list
  let listFieldIndent = 0;   // indent of the list items' "- " prefix

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    // Skip blank lines and comments
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Top-level "entity:" key (before indexers: block)
    if (!inIndexers && /^entity\s*:/.test(line)) {
      topLevelEntity = line.replace(/^entity\s*:\s*/, '').replace(/['"]/g, '').trim();
      continue;
    }

    // Top-level "indexers:" key
    if (/^indexers\s*:/.test(line)) {
      inIndexers = true;
      continue;
    }

    if (!inIndexers) continue;

    // Detect new indexer list item (  - name: or - name:)
    if (/^\s{0,2}-\s+name\s*:/.test(line)) {
      // Close out any in-progress list-field collection
      listFieldName = null;
      if (current) indexers.push(current);
      const nameVal = line.replace(/^[\s-]+name\s*:\s*/, '').replace(/['"]/g, '').trim();
      current = { name: nameVal, _yamlFile: filePath };
      continue;
    }

    if (!current) continue;

    // If we're collecting items for a list-valued field, check for continued list items
    if (listFieldName !== null) {
      // A list item at the expected indent level continues the list
      const listItemMatch = line.match(/^(\s+)-\s+(.*)/);
      if (listItemMatch) {
        const itemIndent = listItemMatch[1].length;
        // Accept items indented deeper than the field key (any deeper indent is valid YAML)
        if (itemIndent >= listFieldIndent) {
          const itemVal = listItemMatch[2].replace(/['"]/g, '').trim();
          if (itemVal) current[listFieldName].push(itemVal);
          continue;
        }
      }
      // Anything else ends the list
      listFieldName = null;
    }

    // Continuation key under current item (indented, no leading dash)
    if (/^\s+[a-zA-Z_]+\s*:/.test(line)) {
      const match = line.match(/^(\s+)([a-zA-Z_]+)\s*:\s*(.*)/);
      if (match) {
        const fieldIndent = match[1].length;
        const key = match[2].trim();
        const val = match[3].replace(/['"]/g, '').trim();

        if (val === '') {
          // No inline value — this field's value will be a list on following lines
          current[key] = [];
          listFieldName = key;
          listFieldIndent = fieldIndent + 1; // list items must be more indented than the key
        } else {
          current[key] = val;
        }
      }
      continue;
    }
  }

  if (current) indexers.push(current);

  // Normalize: if a field that should be a list ended up as an empty array, treat as absent
  for (const cfg of indexers) {
    if (Array.isArray(cfg.key) && cfg.key.length === 0) {
      delete cfg.key;
    }
    // key_resolution is always a scalar — coerce array to first element if somehow collected
    if (Array.isArray(cfg.key_resolution)) {
      cfg.key_resolution = cfg.key_resolution[0] || undefined;
    }
  }

  // Inject top-level entity into each indexer (indexer-level entity overrides if present)
  if (topLevelEntity) {
    for (const cfg of indexers) {
      if (!cfg.entity) cfg.entity = topLevelEntity;
    }
  }

  return indexers;
}

// ---------------------------------------------------------------------------
// Config hash — stable identity for an indexer's declarative config.
// Used by reload to detect any changed config without forcing a rename.
// Runtime/derived fields are excluded; custom declaration fields remain included.
// ---------------------------------------------------------------------------

const CONFIG_HASH_EXCLUDED_FIELDS = new Set([
  '_configHash', '_source', '_yamlFile',
  'sourcePath', 'sourceGlob', 'excludeGlob',
]);

function canonicalizeConfig(value) {
  if (Array.isArray(value)) return value.map(canonicalizeConfig);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (CONFIG_HASH_EXCLUDED_FIELDS.has(key)) continue;
      out[key] = canonicalizeConfig(value[key]);
    }
    return out;
  }
  return value;
}

function configHash(cfg) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalizeConfig(cfg || {})))
    .digest('hex');
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
// Resolve glob pattern for source_glob / exclude_glob to an absolute base dir
// and a pattern string. Returns { baseDir, pattern } or null if not set.
// The pattern is kept relative to baseDir (used by glob matching in projector).
// ---------------------------------------------------------------------------

function resolveGlob(rawGlob, yamlFile) {
  if (!rawGlob) return null;
  // If the pattern is absolute, split into dir + pattern components.
  // For simple patterns like "*.jsonl", base dir comes from the yaml file dir.
  if (path.isAbsolute(rawGlob)) {
    return { baseDir: path.dirname(rawGlob), pattern: path.basename(rawGlob) };
  }
  const baseDir = yamlFile ? path.dirname(yamlFile) : process.cwd();
  return { baseDir, pattern: rawGlob };
}

// ---------------------------------------------------------------------------
// Scan directories for .koad-io-index.yaml files.
// Scans: $HOME/.*/  and  $HOME/.forge/*/  and  $HOME/.forge/packages/*/
//        and  $HOME/.koad-io/*/ (recursive one level for nested index files)
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

  function scanOneLevel(parentDir) {
    try {
      const entries = fs.readdirSync(parentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          tryDir(path.join(parentDir, entry.name));
        }
      }
    } catch (_) { /* dir absent or unreadable */ }
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
  scanOneLevel(path.join(HOME, '.forge'));

  // $HOME/.forge/packages/*/ — package-level indexers
  scanOneLevel(path.join(HOME, '.forge', 'packages'));

  // $HOME/.koad-io/*/ — framework sub-dirs (e.g. me/trust/)
  const koadIoDir = path.join(HOME, '.koad-io');
  scanOneLevel(koadIoDir);
  // Also scan two levels deep for nested dirs like .koad-io/me/trust/
  try {
    const koadIoEntries = fs.readdirSync(koadIoDir, { withFileTypes: true });
    for (const entry of koadIoEntries) {
      if (entry.isDirectory()) {
        scanOneLevel(path.join(koadIoDir, entry.name));
      }
    }
  } catch (_) { /* absent */ }

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

  // Normalize all configs: resolve source paths and glob patterns
  const configs = [];
  for (let cfg of Object.values(byName)) {
    // Resolve single-file source path
    if (!cfg.sourcePath && cfg.source) {
      cfg = Object.assign({}, cfg, { sourcePath: resolveSource(cfg) });
    }

    // Resolve source_glob and exclude_glob
    if (cfg.source_glob) {
      // Validate: source_glob requires mode: append-only (SPEC-141 §3.5)
      if (cfg.mode && cfg.mode !== 'append-only') {
        console.error(`[indexer-registry] ${cfg.name}: source_glob requires mode: append-only (got ${cfg.mode}) — skipping`);
        continue;
      }
      // Validate: source_glob requires slug_field
      if (!cfg.slug_field) {
        console.error(`[indexer-registry] ${cfg.name}: source_glob requires slug_field — skipping`);
        continue;
      }
      // Resolve glob patterns relative to yaml file dir
      const yamlFile = cfg._yamlFile || null;
      const sourceGlobResolved = resolveGlob(cfg.source_glob, yamlFile);
      const excludeGlobResolved = cfg.exclude_glob ? resolveGlob(cfg.exclude_glob, yamlFile) : null;
      cfg = Object.assign({}, cfg, {
        mode: 'append-only',
        sourceGlob: sourceGlobResolved,
        excludeGlob: excludeGlobResolved,
      });
    }

    configs.push(cfg);
  }

  // Attach config hash to each entry — used by reload to detect changed configs
  for (const cfg of configs) {
    cfg._configHash = configHash(cfg);
  }

  console.log(`[indexer-registry] total indexers registered: ${configs.length}`);
  for (const cfg of configs) {
    const src = cfg.sourceGlob
      ? `glob:${cfg.sourceGlob.baseDir}/${cfg.sourceGlob.pattern}`
      : (cfg.sourcePath || cfg.source || '?');
    console.log(`[indexer-registry]   ${cfg.name} → ${cfg.collection} (${cfg.mode || 'append-only'}) from ${src}`);
  }

  return configs;
}

// Export
globalThis.IndexerRegistry = { load, configHash };
