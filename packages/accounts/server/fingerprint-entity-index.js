const fs = Npm.require('fs');
const path = Npm.require('path');
const kbpgp = Npm.require('kbpgp');

const HOME_DIR = process.env.HOME || '';
const FINGERPRINT_RE = /^[0-9A-F]{40}$/;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function normalizeFingerprint(raw) {
  if (typeof raw !== 'string') return null;
  const norm = raw.replace(/\s/g, '').toUpperCase();
  return FINGERPRINT_RE.test(norm) ? norm : null;
}

function importPublicKey(armored) {
  return new Promise(function (resolve, reject) {
    kbpgp.KeyManager.import_from_armored_pgp({ armored }, function (err, km) {
      if (err) return reject(err);
      resolve(km);
    });
  });
}

function kmFingerprint(km) {
  const buf = km && km.get_pgp_fingerprint ? km.get_pgp_fingerprint() : null;
  return buf ? buf.toString('hex').toUpperCase() : null;
}

function readFileIfPresent(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return null;
  }
}

async function fingerprintFromArmored(armored) {
  if (typeof armored !== 'string' || !armored.includes('BEGIN PGP PUBLIC KEY BLOCK')) return null;
  try {
    const km = await importPublicKey(armored);
    return kmFingerprint(km);
  } catch (_) {
    return null;
  }
}

function buildBaseRecord(handle, basedir, kind, canonicalFingerprint, canonicalPublicKeyPath) {
  return {
    handle,
    basedir,
    kind,
    canonicalFingerprint: canonicalFingerprint || null,
    canonicalPublicKeyPath: canonicalPublicKeyPath || null,
  };
}

function candidateIdentityRoots() {
  if (!HOME_DIR || !fs.existsSync(HOME_DIR)) return [];

  return fs.readdirSync(HOME_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('.'))
    .map((entry) => path.join(HOME_DIR, entry.name))
    .filter((dirPath) => fs.existsSync(path.join(dirPath, 'id')));
}

async function scanAll() {
  const fingerprintMap = new Map();
  const handleMap = new Map();

  for (const basedir of candidateIdentityRoots()) {
    const handle = path.basename(basedir).replace(/^\./, '');
    const idDir = path.join(basedir, 'id');

    const entityFingerprintPath = path.join(idDir, 'entity.fingerprint');
    const sovereignFingerprintPath = path.join(idDir, 'master.fingerprint');

    const kind = fs.existsSync(entityFingerprintPath)
      ? 'entity'
      : (fs.existsSync(sovereignFingerprintPath) ? 'sovereign' : null);

    if (!kind) continue;

    const canonicalFingerprint = normalizeFingerprint(
      readFileIfPresent(kind === 'entity' ? entityFingerprintPath : sovereignFingerprintPath)
    );

    const canonicalPublicKeyPath = kind === 'entity'
      ? path.join(idDir, 'entity.public.asc')
      : (fs.existsSync(path.join(idDir, 'gpg.public.asc'))
          ? path.join(idDir, 'gpg.public.asc')
          : path.join(idDir, 'entity.public.asc'));

    const baseRecord = buildBaseRecord(handle, basedir, kind, canonicalFingerprint, canonicalPublicKeyPath);
    handleMap.set(handle, baseRecord);

    if (canonicalFingerprint) {
      fingerprintMap.set(canonicalFingerprint, {
        ...baseRecord,
        signerFingerprint: canonicalFingerprint,
        signerType: kind === 'entity' ? 'entity' : 'sovereign',
        publicKeyPath: fs.existsSync(canonicalPublicKeyPath) ? canonicalPublicKeyPath : null,
      });
    }

    const devicesDir = path.join(idDir, 'devices');
    if (!fs.existsSync(devicesDir)) continue;

    const deviceHosts = fs.readdirSync(devicesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    for (const deviceHost of deviceHosts) {
      const publicKeyPath = path.join(devicesDir, deviceHost, 'leaf.public.asc');
      const armored = readFileIfPresent(publicKeyPath);
      const signerFingerprint = await fingerprintFromArmored(armored);
      if (!signerFingerprint) continue;

      fingerprintMap.set(signerFingerprint, {
        ...baseRecord,
        signerFingerprint,
        signerType: 'device',
        deviceHost,
        publicKeyPath,
      });
    }
  }

  return { fingerprintMap, handleMap };
}

const FingerprintEntityIndex = {
  _fingerprints: new Map(),
  _handles: new Map(),
  _lastRefreshedAt: null,

  async refresh() {
    const { fingerprintMap, handleMap } = await scanAll();
    this._fingerprints = fingerprintMap;
    this._handles = handleMap;
    this._lastRefreshedAt = new Date();

    log.success(`[FingerprintEntityIndex] refreshed ${handleMap.size} handles / ${fingerprintMap.size} fingerprints`);
    return {
      handles: handleMap.size,
      fingerprints: fingerprintMap.size,
      refreshedAt: this._lastRefreshedAt,
    };
  },

  lookup(fingerprint) {
    const fp = normalizeFingerprint(fingerprint);
    if (!fp) return null;
    return this._fingerprints.get(fp) || null;
  },

  lookupHandle(handle) {
    if (typeof handle !== 'string' || !handle.trim()) return null;
    return this._handles.get(handle.trim().toLowerCase()) || null;
  },

  snapshot() {
    return {
      refreshedAt: this._lastRefreshedAt,
      handles: this._handles.size,
      fingerprints: this._fingerprints.size,
    };
  },
};

globalThis.FingerprintEntityIndex = FingerprintEntityIndex;

Meteor.startup(() => {
  FingerprintEntityIndex.refresh().catch((err) => {
    log.error('[FingerprintEntityIndex] initial refresh failed', err.message);
  });

  Meteor.setInterval(() => {
    FingerprintEntityIndex.refresh().catch((err) => {
      log.error('[FingerprintEntityIndex] periodic refresh failed', err.message);
    });
  }, REFRESH_INTERVAL_MS);
});
