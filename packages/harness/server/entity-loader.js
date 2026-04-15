const path = require('path');

const cache = new Map();

function normalizeOutfit(raw) {
  if (!raw || typeof raw !== 'object') return { h: 0, s: 0 };
  const outfit = {};
  outfit.h = raw.h !== undefined ? raw.h : (raw.hue !== undefined ? raw.hue : 0);
  outfit.s = raw.s !== undefined ? raw.s : (raw.saturation !== undefined ? raw.saturation : 0);
  if (raw.typography) outfit.typography = raw.typography;
  if (raw.greeting) outfit.greeting = raw.greeting;
  if (raw.personality) outfit.personality = raw.personality;
  if (raw.motion) outfit.motion = raw.motion;
  // VESTA-SPEC-099: LOD-3 visual (2D assets) and LOD-4 spatial (3D mesh + pipeline)
  if (raw.visual) outfit.visual = raw.visual;
  if (raw.spatial) outfit.spatial = raw.spatial;
  // Legacy Level-4 `model` placeholder (pre SPEC-099). Preserved for back-compat
  // reads; new entities should use `spatial` per SPEC-099 §3.
  if (raw.model) outfit.model = raw.model;
  return outfit;
}

function filterOutfitByLevel(outfit, level) {
  if (level === undefined || level === null) return outfit;
  const filtered = { h: outfit.h, s: outfit.s };
  if (level >= 1) {
    if (outfit.typography) filtered.typography = outfit.typography;
    if (outfit.greeting) filtered.greeting = outfit.greeting;
  }
  if (level >= 2) {
    if (outfit.personality) filtered.personality = outfit.personality;
  }
  if (level >= 3) {
    // SPEC-063 Level 3 (motion) and SPEC-099 Level 3 (visual) coexist in the
    // same LOD tier — independent keys, either may be present.
    if (outfit.motion) filtered.motion = outfit.motion;
    if (outfit.visual) filtered.visual = outfit.visual;
  }
  if (level >= 4) {
    // VESTA-SPEC-099 §3: LOD-4 is `spatial` (3D mesh + pipeline metadata).
    // SPEC-063's former `model` placeholder is retired; we still read it
    // through for any unmigrated entity so the consumer sees it at level 4.
    if (outfit.spatial) filtered.spatial = outfit.spatial;
    if (outfit.model) filtered.model = outfit.model;
  }
  return filtered;
}

async function loadEntity(handle, baseDir) {
  const cached = cache.get(handle);
  if (cached && Date.now() - cached.loadedAt < cached.ttl) {
    return cached.data;
  }

  const dir = path.join(baseDir, `.${handle}`);

  // VESTA-SPEC-067: Context load order — kingdom → entity → implement → location → memory
  const koadIoDir = path.join(baseDir, '.koad-io');

  const [koadIoMd, entityMd, envContent, claudeMd, primerMd, landingMd, passengerRaw, fallbacksRaw, memoriesDir] = await Promise.all([
    KoadHarnessUtils.readFile(path.join(koadIoDir, 'KOAD_IO.md')),   // Layer 1: Kingdom
    KoadHarnessUtils.readFile(path.join(dir, 'ENTITY.md')),           // Layer 2: Entity
    KoadHarnessUtils.readFile(path.join(dir, '.env')),
    KoadHarnessUtils.readFile(path.join(dir, 'CLAUDE.md')),           // Layer 3: Implement
    KoadHarnessUtils.readFile(path.join(dir, 'PRIMER.md')),           // Layer 4: Location
    KoadHarnessUtils.readFile(path.join(dir, 'landing.md')),
    KoadHarnessUtils.readFile(path.join(dir, 'passenger.json')),
    KoadHarnessUtils.readFile(path.join(dir, 'fallbacks.json')),
    KoadHarnessUtils.readDir(path.join(dir, 'memories')),             // Layer 5: Memory
  ]);

  const env = KoadHarnessUtils.parseEnv(envContent);
  const passenger = passengerRaw ? JSON.parse(passengerRaw) : {};
  const fallbacks = fallbacksRaw ? JSON.parse(fallbacksRaw) : {};

  const memoryFiles = memoriesDir
    .filter(f => f.endsWith('.md'))
    .sort();
  const memories = await Promise.all(
    memoryFiles.map(f => KoadHarnessUtils.readFile(path.join(dir, 'memories', f)))
  );

  const avatarPath = path.join(dir, 'avatar.png');
  const avatarExists = await KoadHarnessUtils.readBinary(avatarPath) !== null;

  const data = {
    handle,
    name: passenger.name || env.ENTITY || handle,
    role: passenger.role || env.ROLE || '',
    purpose: env.PURPOSE || '',
    outfit: normalizeOutfit(passenger.outfit),
    buttons: passenger.buttons || [],
    koadIoMd: koadIoMd || '',    // Layer 1: Kingdom (VESTA-SPEC-067)
    entityMd: entityMd || '',    // Layer 2: Entity identity
    claudeMd: claudeMd || '',    // Layer 3: Implement config
    primerMd,                    // Layer 4: Location context
    landingMd,
    memories: memories.filter(Boolean),  // Layer 5: Experience
    fallbacks,
    avatarPath: avatarExists ? avatarPath : null,
    dir,
  };

  return data;
}

function getClientInfo(entity, level, prefix) {
  // prefix is the harness mount prefix (e.g. "/harness/jesus"). It must be
  // supplied by the caller so the avatar URL resolves under whatever namespace
  // the harness is deployed at. Falls back to "/harness" only for callers that
  // predate the prefix argument — new callers should always pass it.
  const mount = (prefix || '/harness').replace(/\/+$/, '');
  return {
    handle: entity.handle,
    name: entity.name,
    role: entity.role,
    outfit: filterOutfitByLevel(entity.outfit, level),
    buttons: entity.buttons || [],
    landing: entity.landingMd || null,
    avatarUrl: entity.avatarPath ? `${mount}/entities/${entity.handle}/avatar` : null,
  };
}

function cacheEntity(handle, data, ttl) {
  cache.set(handle, { data, loadedAt: Date.now(), ttl });
}

function clearCache() {
  cache.clear();
}

async function loadAll(handles, baseDir, ttl) {
  const entities = {};
  for (const handle of handles) {
    try {
      const data = await loadEntity(handle, baseDir);
      cacheEntity(handle, data, ttl);
      entities[handle] = data;
    } catch (err) {
      console.error(`[harness] Failed to load entity "${handle}":`, err.message);
    }
  }
  return entities;
}

async function getEntity(handle, baseDir, ttl) {
  const cached = cache.get(handle);
  if (cached && Date.now() - cached.loadedAt < cached.ttl) {
    return cached.data;
  }
  const data = await loadEntity(handle, baseDir);
  cacheEntity(handle, data, ttl);
  return data;
}

KoadHarnessEntityLoader = { loadAll, getEntity, getClientInfo, filterOutfitByLevel, normalizeOutfit, clearCache };
