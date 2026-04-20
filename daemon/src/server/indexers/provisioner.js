// provisioner.js — Kingdom Primitives Provisioner (VESTA-SPEC-136 Phase 2)
//
// Scans ~/.koad-io/primitives/{triggers,workers}/*/manifest.json for the
// library. For each (entity × primitive) pair where the entity's role matches
// manifest.roles, applies the §5.2 decision matrix:
//
//   - No install record, no opt-out → install (copy script, write .patched/<name>.json)
//   - .optout sentinel exists       → skip silently
//   - Installed, hash matches       → no-op
//   - Installed, hash mismatch      → skip (entity customized, no noise)
//   - Installed, pristine, version behind library → emit upgrade-available notice
//   - Installed version > library   → emit anomaly warning
//
// Emissions are attributed to the target entity, not the daemon (SPEC-136 §4).
// Runs as a registered koad.workers worker ("eats its own dog food").

const fs = Npm.require('fs');
const path = Npm.require('path');
const crypto = Npm.require('crypto');

const HOME = process.env.HOME;
const PRIMITIVES_ROOT = path.join(HOME, '.koad-io', 'primitives');

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function sha256File(filePath) {
  try {
    const contents = fs.readFileSync(filePath);
    return 'sha256:' + crypto.createHash('sha256').update(contents).digest('hex');
  } catch (e) {
    return null;
  }
}

function semverCompare(a, b) {
  // Returns -1, 0, or 1
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

function isMajorBump(from, to) {
  return parseInt(to.split('.')[0], 10) > parseInt(from.split('.')[0], 10);
}

// ---------------------------------------------------------------------------
// Library scanning
// ---------------------------------------------------------------------------

function loadPrimitiveLibrary() {
  const primitives = [];
  for (const kind of ['triggers', 'workers']) {
    const kindDir = path.join(PRIMITIVES_ROOT, kind);
    let names;
    try {
      names = fs.readdirSync(kindDir).filter(n => {
        try {
          return fs.statSync(path.join(kindDir, n)).isDirectory();
        } catch (e) { return false; }
      });
    } catch (e) {
      continue; // kind dir may not exist yet
    }

    for (const name of names) {
      const manifestPath = path.join(kindDir, name, 'manifest.json');
      const scriptFile = kind === 'triggers' ? 'trigger.sh' : 'worker.sh';
      const scriptPath = path.join(kindDir, name, scriptFile);
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        // Verify the script exists
        fs.accessSync(scriptPath, fs.constants.R_OK);
        primitives.push({
          kind: kind === 'triggers' ? 'trigger' : 'worker',
          name: manifest.name || name,
          version: manifest.version || '1.0.0',
          description: manifest.description || '',
          roles: manifest.roles || ['*'],
          requires: manifest.requires || [],
          tags: manifest.tags || [],
          scriptPath,
        });
      } catch (e) {
        console.warn(`[PROVISIONER] skipping ${kind}/${name}: ${e.message}`);
      }
    }
  }
  return primitives;
}

// ---------------------------------------------------------------------------
// Entity helpers
// ---------------------------------------------------------------------------

function entityMatchesPrimitive(entityRole, primitiveRoles) {
  if (primitiveRoles.includes('*')) return true;
  if (!entityRole) return false;
  return primitiveRoles.includes(entityRole);
}

function patchedDir(entityPath) {
  return path.join(entityPath, '.patched');
}

function patchedJsonPath(entityPath, primitiveName) {
  return path.join(patchedDir(entityPath), primitiveName + '.json');
}

function patchedOptoutPath(entityPath, primitiveName) {
  return path.join(patchedDir(entityPath), primitiveName + '.optout');
}

function readPatchedRecord(entityPath, primitiveName) {
  try {
    return JSON.parse(fs.readFileSync(patchedJsonPath(entityPath, primitiveName), 'utf8'));
  } catch (e) {
    return null;
  }
}

function hasOptout(entityPath, primitiveName) {
  try {
    fs.accessSync(patchedOptoutPath(entityPath, primitiveName));
    return true;
  } catch (e) {
    return false;
  }
}

function ensureDir(dirPath) {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
}

// ---------------------------------------------------------------------------
// Emission helper — always attributed to the target entity (SPEC-136 §4)
// ---------------------------------------------------------------------------

function emitForEntity(entityHandle, type, body, meta) {
  try {
    Meteor.callAsync('entity.emit', {
      entity: entityHandle,
      type,
      body,
      meta: Object.assign({ source: 'provisioner' }, meta || {}),
    }).catch(e => {
      console.error(`[PROVISIONER] emit failed for ${entityHandle}: ${e.message}`);
    });
  } catch (e) {
    console.error(`[PROVISIONER] emit error for ${entityHandle}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Install a primitive into an entity dir (SPEC-136 §5.3)
// ---------------------------------------------------------------------------

function installPrimitive(entity, primitive) {
  const { handle, path: entityPath } = entity;
  const { kind, name, version, scriptPath } = primitive;

  let installPath;
  if (kind === 'trigger') {
    installPath = path.join(entityPath, 'triggers', name + '.sh');
    ensureDir(path.join(entityPath, 'triggers'));
  } else {
    installPath = path.join(entityPath, 'workers', name, 'worker.sh');
    ensureDir(path.join(entityPath, 'workers', name));
  }

  let partialWritten = false;
  try {
    // Copy script
    const scriptContent = fs.readFileSync(scriptPath);
    fs.writeFileSync(installPath, scriptContent, { mode: 0o755 });
    partialWritten = true;

    // Compute hash of installed file
    const sourceHash = sha256File(installPath);

    // Write .patched record
    ensureDir(patchedDir(entityPath));
    const record = {
      primitive: name,
      kind,
      version,
      patched_at: new Date().toISOString(),
      source_hash: sourceHash,
      install_path: installPath,
    };
    fs.writeFileSync(patchedJsonPath(entityPath, name), JSON.stringify(record, null, 2));

    const shortPath = installPath.replace(HOME, '~');
    const body = `primitives: patched ${name} v${version} (${kind}) into ${shortPath}`;
    console.log(`[PROVISIONER] ${handle}: ${body}`);

    emitForEntity(handle, 'notice', body, {
      primitive: name,
      kind,
      version,
      install_path: shortPath,
      event: 'primitives.installed',
    });

    return { action: 'installed' };
  } catch (e) {
    // Clean up partial state
    if (partialWritten) {
      try { fs.unlinkSync(installPath); } catch (_) {}
    }
    const errBody = `primitives: failed to patch ${name} v${version} into ${entityPath.replace(HOME, '~')} — ${e.message}`;
    console.error(`[PROVISIONER] ${handle}: ${errBody}`);
    emitForEntity(handle, 'error', errBody, {
      primitive: name,
      kind,
      version,
      error: e.message,
      event: 'primitives.install_failed',
    });
    return { action: 'error', error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Detect deletion-as-opt-out (SPEC-136 §6)
// .patched/<name>.json exists but install_path file is gone → write .optout
// ---------------------------------------------------------------------------

function checkForOptout(entity, record, primitiveName) {
  const { handle, path: entityPath } = entity;
  const installPath = record.install_path;
  if (!installPath) return false;

  try {
    fs.accessSync(installPath, fs.constants.F_OK);
    return false; // file exists, no opt-out
  } catch (e) {
    // File gone — entity deleted it → opt-out
    ensureDir(patchedDir(entityPath));
    const optout = {
      entity: handle,
      primitive: primitiveName,
      opted_out_at: new Date().toISOString(),
    };
    fs.writeFileSync(patchedOptoutPath(entityPath, primitiveName), JSON.stringify(optout, null, 2));
    // Remove .json install record
    try { fs.unlinkSync(patchedJsonPath(entityPath, primitiveName)); } catch (_) {}

    const body = `primitives: opted out of ${primitiveName} — will not re-patch`;
    console.log(`[PROVISIONER] ${handle}: ${body}`);
    emitForEntity(handle, 'notice', body, {
      primitive: primitiveName,
      kind: record.kind,
      event: 'primitives.opted_out',
    });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Per (entity × primitive) decision matrix (SPEC-136 §5.2)
// ---------------------------------------------------------------------------

function processEntityPrimitive(entity, primitive) {
  const { handle, path: entityPath } = entity;
  const { name, version: libVersion, kind } = primitive;

  // Opt-out takes absolute precedence
  if (hasOptout(entityPath, name)) {
    return { action: 'skipped_optout' };
  }

  const record = readPatchedRecord(entityPath, name);

  // No install record → fresh install
  if (!record) {
    return installPrimitive(entity, primitive);
  }

  // Check for deletion-as-opt-out
  const deletionOptout = checkForOptout(entity, record, name);
  if (deletionOptout) {
    return { action: 'opted_out' };
  }

  const installedVersion = record.version;
  const cmp = semverCompare(installedVersion, libVersion);

  // Installed version > library version → anomaly
  if (cmp > 0) {
    const body = `primitives: installed version of ${name} (v${installedVersion}) exceeds library version (v${libVersion}) — possible library downgrade or hand-edited metadata. No action taken.`;
    console.warn(`[PROVISIONER] ${handle}: ${body}`);
    emitForEntity(handle, 'warning', body, {
      primitive: name,
      installed_version: installedVersion,
      library_version: libVersion,
      event: 'primitives.version_anomaly',
    });
    return { action: 'anomaly_warning' };
  }

  // Same version — check hash
  if (cmp === 0) {
    const currentHash = sha256File(record.install_path);
    if (!currentHash || currentHash !== record.source_hash) {
      // Hash mismatch — entity customized → silent skip
      return { action: 'skipped_customized' };
    }
    // Hash matches — pristine, up to date → no-op
    return { action: 'no_op' };
  }

  // Installed version < library version (cmp < 0)
  const currentHash = sha256File(record.install_path);
  const isCustomized = !currentHash || currentHash !== record.source_hash;

  if (isCustomized) {
    // Customized + upgrade available → silent skip (SPEC-136 §5.4)
    return { action: 'skipped_customized' };
  }

  // Pinned check
  if (record.pinned) {
    return { action: 'no_op' };
  }

  // Pristine + upgrade available → emit notice, do NOT auto-upgrade
  const major = isMajorBump(installedVersion, libVersion);
  const body = major
    ? `primitives: upgrade available — ${name} v${installedVersion} → v${libVersion} (${kind}). INCOMPATIBLE CHANGE — review the manifest before accepting. Run \`${handle} primitives upgrade ${name}\` to accept.`
    : `primitives: upgrade available — ${name} v${installedVersion} → v${libVersion} (${kind}). Run \`${handle} primitives upgrade ${name}\` to accept.`;
  console.log(`[PROVISIONER] ${handle}: ${body}`);
  emitForEntity(handle, 'notice', body, {
    primitive: name,
    kind,
    installed_version: installedVersion,
    available_version: libVersion,
    is_major_bump: major,
    event: 'primitives.upgrade_available',
  });
  return { action: 'upgrade_notice_emitted' };
}

// ---------------------------------------------------------------------------
// Main provision sweep
// ---------------------------------------------------------------------------

async function provisionOnce() {
  const library = loadPrimitiveLibrary();
  if (library.length === 0) {
    console.log('[PROVISIONER] no primitives in library, skipping sweep');
    return;
  }

  const entities = EntityScanner.Entities.find().fetch();
  if (entities.length === 0) {
    console.log('[PROVISIONER] no entities detected, skipping sweep');
    return;
  }

  let installed = 0, noOp = 0, skipped = 0, errors = 0;

  for (const entity of entities) {
    if (!entity.path) continue;
    for (const primitive of library) {
      if (!entityMatchesPrimitive(entity.role, primitive.roles)) continue;
      const result = processEntityPrimitive(entity, primitive);
      if (result.action === 'installed') installed++;
      else if (result.action === 'no_op') noOp++;
      else if (result.action === 'error') errors++;
      else skipped++;
    }
  }

  console.log(`[PROVISIONER] sweep complete — installed: ${installed}, no-op: ${noOp}, skipped: ${skipped}, errors: ${errors}`);
}

// ---------------------------------------------------------------------------
// Startup — register as a worker (dogfooding, SPEC-136 Phase 3)
// ---------------------------------------------------------------------------

Meteor.startup(async () => {
  // Delay until EntityScanner is ready (it runs first alphabetically,
  // but give it a tick to complete the initial scan)
  Meteor.setTimeout(async () => {
    try {
      await koad.workers.start({
        service: 'primitives-provision',
        type: 'indexer',
        interval: 15,
        runImmediately: true,
        task: provisionOnce,
      });
      console.log('[PROVISIONER] worker registered (15-minute interval, ran immediately)');
    } catch (e) {
      console.error('[PROVISIONER] failed to register worker:', e.message);
    }

    if (!globalThis.indexerReady) globalThis.indexerReady = {};
    globalThis.indexerReady.provisioner = new Date().toISOString();
  }, 5000);
});

// Export for API use
globalThis.PrimitivesLibrary = { loadPrimitiveLibrary };
