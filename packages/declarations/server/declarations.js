// Declarations indexer — VESTA-SPEC-147 v3.3 sovereign declarations
//
// Watches ~/.<entity>/trust/declarations/ for clearsigned declaration files.
// Indexes into DeclarationsIndex collection and exposes via 'declarations' publication.
// Re-verification cycle: every 48h (SPEC-147 §6.2).
//
// Schema per SPEC-147 §9.1 v3.3:
//   _id:                17-char kingdom CID (koad.generate.cid.fromBytes, not IPLD CIDv1)
//   handle:             entity handle (e.g. 'koad')
//   kingdom:            kingdom name from declaration body
//   claims[]:           [{url, verified, lastVerifiedAt, error}]  — v3.2 URL-typed
//   issued_at:          ISO 8601 UTC timestamp
//   expires_at:         ISO 8601 UTC timestamp | null
//   status:             'verified' | 'pending' | 'unverified'
//   last_checked:       ISO 8601 UTC timestamp | null
//   issuer_fingerprint: PGP key fingerprint (40 hex chars, spaces permitted) per SPEC-147 v3.3
//   raw_cid:            same as _id (alias)
//   revoked:            boolean
//   clearsignText:      raw canonical clearsigned text
//
// v3.3: RFC 4880 GPG clearsign is the canonical and only envelope format.
// The kingdom-native Ed25519 envelope (BEGIN KINGDOM SIGNED MESSAGE) is removed.
// Files with the old kingdom-native envelope are skipped with a warning.

const fs   = Npm.require('fs');
const path = Npm.require('path');
const os   = Npm.require('os');

// ── Collection ────────────────────────────────────────────────────────────────

const DeclarationsIndex = new Mongo.Collection('DeclarationsIndex', { connection: null });
globalThis.DeclarationsIndex = DeclarationsIndex;

// ── Publications ─────────────────────────────────────────────────────────────

Meteor.publish('declarations', async function () {
  await koad.ready.await('declarations');
  return DeclarationsIndex.find();
});

Meteor.publish('declarations.byHandle', async function (handle) {
  check(handle, String);
  await koad.ready.await('declarations');
  return DeclarationsIndex.find({ handle: handle });
});

Meteor.publish('declarations.byCid', async function (cid) {
  check(cid, String);
  await koad.ready.await('declarations');
  var doc = DeclarationsIndex.findOne({ _id: cid });
  return doc
    ? DeclarationsIndex.find({ _id: cid })
    : DeclarationsIndex.find({ _id: '__no_match__' });
});

// ── Canonical form (SPEC-147 §3.1) ────────────────────────────────────────

function normalizeCanonical(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.split('\n').map(l => l.replace(/[ \t]+$/, '')).join('\n');
  if (!text.endsWith('\n')) text += '\n';
  return text;
}

// ── CID computation (SPEC-147 §3.2) ──────────────────────────────────────
// Kingdom-native 17-char CID via koad.generate.cid.fromBytes().
// Per VESTA-SPEC-147 v3.2: kingdom CID replaces IPLD CIDv1 (bafkrei...).

function computeKingdomCid(bytes) {
  // koad.generate.cid.fromBytes defined in koad:io-core/both/global-helpers.js
  return koad.generate.cid.fromBytes(bytes);
}

// ── Strip-line CID (SPEC-147 §3.2) ───────────────────────────────────────
// Compute the CID over bodyText-minus-self_cid-line.
// Used for both validating self_cid during indexing and double-compare in verifier.

function stripSelfCidLine(text) {
  return text.replace(/^self_cid:[ \t]*[^\n]*\n/m, '');
}

function computeStripLineCid(bodyText) {
  const stripped  = stripSelfCidLine(bodyText);
  const canonical = normalizeCanonical(stripped);
  return computeKingdomCid(Buffer.from(canonical, 'utf8'));
}

// ── YAML body parser (minimal) ────────────────────────────────────────────

function parseDeclarationBody(bodyText) {
  const lines  = bodyText.split('\n');
  const result = { claims: [] };
  let   inClaims = false;

  for (const line of lines) {
    const versionM   = line.match(/^version:\s*(.+)$/);
    const kingdomM   = line.match(/^kingdom:\s*(.+)$/);
    const fingerM    = line.match(/^issuer_fingerprint:\s*(.+)$/);
    const issuedM    = line.match(/^issued_at:\s*(.+)$/);
    const selfCidM   = line.match(/^self_cid:\s*(.+)$/);
    const expiresM   = line.match(/^expires_at:\s*(.+)$/);
    const revokeCidM = line.match(/^revocation_cid:\s*(.+)$/);
    const claimsM    = line.match(/^claims:/);
    // v3.2: URL-based claims — "  - url: https://..."
    const urlClaimM  = line.match(/^  - url:\s*(.+)$/);

    if (versionM)    result.version = versionM[1].trim();
    else if (kingdomM)   result.kingdom = kingdomM[1].trim();
    else if (fingerM)    result.issuer_fingerprint = fingerM[1].trim();
    else if (issuedM)    result.issued_at = issuedM[1].trim();
    else if (selfCidM)   result.self_cid = selfCidM[1].trim();
    else if (expiresM)   result.expires_at = expiresM[1].trim();
    else if (revokeCidM) result.revocation_cid = revokeCidM[1].trim();
    else if (claimsM)    { inClaims = true; }
    else if (inClaims && urlClaimM) {
      result.claims.push({ url: urlClaimM[1].trim() });
    }
  }
  return result;
}

// ── Envelope parser — GPG clearsign only (SPEC-147 v3.3) ─────────────────
// v3.3: RFC 4880 GPG clearsign is the canonical and only format.
// Kingdom-native Ed25519 envelope (BEGIN KINGDOM SIGNED MESSAGE) is no longer accepted.
// Files with the old envelope are detected and skipped with a diagnostic warning.

function parseEnvelope(text) {
  // Detect and reject the old kingdom-native envelope
  if (text.indexOf('-----BEGIN KINGDOM SIGNED MESSAGE-----') !== -1) {
    return { _rejected: true, format: 'kingdom-ed25519-obsolete' };
  }

  // GPG clearsign — canonical format per SPEC-147 v3.3
  // Body runs from after the blank line following Hash: header to the signature separator.
  const gpgRe = /-----BEGIN PGP SIGNED MESSAGE-----\n(?:[^\n]+\n)*\n([\s\S]+?)\n\n-----BEGIN PGP SIGNATURE-----\n([\s\S]+?)-----END PGP SIGNATURE-----/;
  const m = text.match(gpgRe);
  if (m) {
    return { bodyText: m[1], sigBlock: m[2], format: 'gpg' };
  }

  return null;
}

// ── File scanner ─────────────────────────────────────────────────────────

function scanFile(filepath, handle) {
  try {
    const rawText = fs.readFileSync(filepath, 'utf8');
    const norm    = normalizeCanonical(rawText);

    const envelope = parseEnvelope(norm);
    if (!envelope) {
      console.warn('[declarations-indexer] not a valid GPG clearsign envelope, skipping:', filepath);
      return;
    }
    if (envelope._rejected) {
      console.warn('[declarations-indexer] kingdom-native Ed25519 envelope is obsolete per SPEC-147 v3.3, skipping:', filepath,
        '— re-issue declaration with gpg --clearsign and a PGP key');
      return;
    }

    const body = parseDeclarationBody(envelope.bodyText);

    // Compute the authoritative CID using strip-line rule (SPEC-147 §3.2 + §5 step 8a).
    // The _id (and self_cid) is the CID of body-minus-self_cid-line, not the full clearsign text.
    const cid = computeStripLineCid(envelope.bodyText);

    // Validate self_cid field matches — double-compare per §5 step 8a
    if (body.self_cid && body.self_cid !== cid) {
      console.warn('[declarations-indexer] self_cid mismatch in', filepath,
        '— strip-line expected', cid, 'body claims', body.self_cid);
      // Still index (strip-line CID is authoritative) but warn — likely old two-pass artifact
    }

    // Check for revocation notice at declarations/revoke-<cid>.md.asc (SPEC §7)
    const declDir      = path.dirname(filepath);
    const revokePath   = path.join(declDir, 'revoke-' + cid + '.md.asc');
    const isRevoked    = fs.existsSync(revokePath) || !!body.revocation_cid;

    // v3.2 claim shape: {url, verified, lastVerifiedAt, error}
    const indexedClaims = (body.claims || []).map(c => ({
      url:            c.url || '',
      verified:       false,
      lastVerifiedAt: null,
      error:          null,
    }));

    // The indexer parses and indexes only — it does not verify GPG signatures (no kbpgp dep).
    // If the declaration has a fingerprint but the issuer's pubkey is not accessible here,
    // mark it as 'pending_key_registration' so the forge can re-verify on first user interaction.
    // The forge's me.signature.create flow registers the pubkey into PgpPublicKeys on first submit;
    // once registered, signature.verify can confirm the GPG envelope.
    const hasFp = !!(body.issuer_fingerprint && body.issuer_fingerprint.trim());
    const initialStatus = isRevoked ? 'unverified' : (hasFp ? 'pending_key_registration' : 'unverified');

    if (hasFp) {
      console.warn('[declarations-indexer] declaration', cid, 'for', handle,
        '— GPG signature not verified at index time (no kbpgp in indexer). ' +
        'Status set to pending_key_registration. Forge will re-verify on user interaction.');
    }

    const doc = {
      _id:                cid,
      handle:             handle.toLowerCase(),
      kingdom:            body.kingdom || 'koad:io',
      claims:             indexedClaims,
      issued_at:          body.issued_at || null,
      expires_at:         body.expires_at || null,
      status:             initialStatus,
      last_checked:       null,
      issuer_fingerprint: body.issuer_fingerprint || '',
      raw_cid:            cid,
      revoked:            isRevoked,
      clearsignText:      norm,
      sigFormat:          envelope.format,
    };

    // Upsert — only update clearsignText + metadata, preserve status/last_checked if present
    const existing = DeclarationsIndex.findOne({ _id: cid });
    if (existing) {
      DeclarationsIndex.update({ _id: cid }, {
        $set: {
          handle:             doc.handle,
          kingdom:            doc.kingdom,
          claims:             existing.claims, // preserve existing verification state
          issued_at:          doc.issued_at,
          expires_at:         doc.expires_at,
          issuer_fingerprint: doc.issuer_fingerprint,
          raw_cid:            doc.raw_cid,
          revoked:            doc.revoked,
          clearsignText:      doc.clearsignText,
          sigFormat:          doc.sigFormat,
        }
      });
    } else {
      DeclarationsIndex.insert(doc);
      console.log('[declarations-indexer] indexed new declaration:', cid, 'for', handle);
    }

  } catch (err) {
    console.error('[declarations-indexer] error scanning', filepath, ':', err.message);
  }
}

// ── Walk entity dirs ──────────────────────────────────────────────────────

function walkEntityDeclarations() {
  const homeDir = os.homedir();

  // Find all entity dirs: ~/.* that have trust/declarations/
  let entries;
  try {
    entries = fs.readdirSync(homeDir);
  } catch (e) {
    console.warn('[declarations-indexer] cannot read homedir:', e.message);
    return;
  }

  for (const entry of entries) {
    if (!entry.startsWith('.') || entry.startsWith('..')) continue;
    const handle  = entry.slice(1); // strip leading dot
    if (!handle || handle.includes('/')) continue;

    const declDir = path.join(homeDir, entry, 'trust', 'declarations');
    if (!fs.existsSync(declDir)) continue;

    let files;
    try {
      files = fs.readdirSync(declDir);
    } catch (e) {
      continue;
    }

    for (const fname of files) {
      if (!fname.endsWith('.md.asc')) continue;
      if (fname.startsWith('revoke-')) continue; // revocation notices, not declarations
      scanFile(path.join(declDir, fname), handle);
    }
  }

  console.log('[declarations-indexer] walk complete, indexed', DeclarationsIndex.find().count(), 'declarations');
}

// ── File watcher ──────────────────────────────────────────────────────────
// Watch each entity's declarations dir. Debounce to avoid double-fires.

const _watchers = new Map();
const _debounceTimers = new Map();

function watchEntityDeclarations() {
  const homeDir = os.homedir();

  let entries;
  try {
    entries = fs.readdirSync(homeDir);
  } catch (e) {
    return;
  }

  for (const entry of entries) {
    if (!entry.startsWith('.') || entry.startsWith('..')) continue;
    const handle  = entry.slice(1);
    if (!handle || handle.includes('/')) continue;

    const declDir = path.join(homeDir, entry, 'trust', 'declarations');
    if (!fs.existsSync(declDir) || _watchers.has(declDir)) continue;

    try {
      const watcher = fs.watch(declDir, { recursive: false }, (event, filename) => {
        if (!filename || !filename.endsWith('.md.asc')) return;
        if (filename.startsWith('revoke-')) return;

        // Debounce 300ms
        const key = declDir + '/' + filename;
        if (_debounceTimers.has(key)) Meteor.clearTimeout(_debounceTimers.get(key));
        _debounceTimers.set(key, Meteor.setTimeout(() => {
          _debounceTimers.delete(key);
          const fullPath = path.join(declDir, filename);
          if (fs.existsSync(fullPath)) {
            console.log('[declarations-indexer] file change detected:', fullPath);
            scanFile(fullPath, handle);
          }
        }, 300));
      });

      _watchers.set(declDir, watcher);
      watcher.on('error', err => {
        console.warn('[declarations-indexer] watcher error on', declDir, ':', err.message);
        _watchers.delete(declDir);
      });

      console.log('[declarations-indexer] watching', declDir);
    } catch (e) {
      // Dir may not be watchable (no inotify, etc.) — ok
    }
  }
}

// Platform URL helpers removed — v3.2 claims are URL-typed; no platform enumeration.

// ── SSRF guard ────────────────────────────────────────────────────────────

function isPrivateHost(hostname) {
  if (/^(::1|fe80:|fc00:|fd|::ffff:)/i.test(hostname)) return true;
  const m = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [, a, b] = m.map(Number);
  if (a === 127) return true;
  if (a === 10)  return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isSafeUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:') return false;
    if (isPrivateHost(u.hostname)) return false;
    return true;
  } catch (e) {
    return false;
  }
}

// ── Verifier (SPEC-147 §5) ────────────────────────────────────────────────

async function verifyDeclaration(doc) {
  const claims = doc.claims || [];
  const cid    = doc._id;

  // v3.2: claims are URL-typed — fetch the URL directly, no platform lookup
  const claimResults = await Promise.all(claims.map(async claim => {
    const claimUrl = claim.url || '';
    if (!claimUrl) {
      return { url: claimUrl, verified: false, lastVerifiedAt: null, error: 'missing-url' };
    }

    if (!isSafeUrl(claimUrl)) {
      return { url: claimUrl, verified: false, lastVerifiedAt: null, error: 'unsafe-url' };
    }

    try {
      const resp = await fetch(claimUrl, {
        headers: { 'User-Agent': 'koad-io-verifier/1.0' },
        redirect: 'follow',
        signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
      });

      if (resp.status === 429) {
        await new Promise(res => Meteor.setTimeout(res, 30000));
        const resp2 = await fetch(claimUrl, { headers: { 'User-Agent': 'koad-io-verifier/1.0' } });
        if (!resp2.ok) return { url: claimUrl, verified: false, lastVerifiedAt: null, error: 'scrape-blocked' };
      }

      if (resp.status === 403) {
        return { url: claimUrl, verified: false, lastVerifiedAt: null, error: 'scrape-blocked' };
      }

      if (!resp.ok) {
        return { url: claimUrl, verified: false, lastVerifiedAt: null, error: 'fetch-failed-' + resp.status };
      }

      const responseText = normalizeCanonical(await resp.text());

      // Scan for 17-char kingdom CID (SPEC §5 step 3, v3.2 regex)
      const cidPattern = /[2-9A-HJ-NP-Za-km-z]{17}/g;
      const found = responseText.match(cidPattern) || [];
      if (found.includes(cid)) {
        return { url: claimUrl, verified: true, lastVerifiedAt: new Date().toISOString(), error: null };
      }

      // Kingdom resolver URL embedding the 17-char CID
      const urlRe = /kingofalldata\.com\/[^/]+\/signature\/([2-9A-HJ-NP-Za-km-z]{17})/g;
      let urlMatch;
      while ((urlMatch = urlRe.exec(responseText)) !== null) {
        if (urlMatch[1] === cid) {
          return { url: claimUrl, verified: true, lastVerifiedAt: new Date().toISOString(), error: null };
        }
      }

      return { url: claimUrl, verified: false, lastVerifiedAt: null, error: 'proof-not-found' };

    } catch (err) {
      return { url: claimUrl, verified: false, lastVerifiedAt: null, error: 'fetch-error' };
    }
  }));

  // Conjunctive validity (SPEC §5 step 9)
  const allVerified = claimResults.every(r => r.verified);

  // Handle grace period (SPEC-147 §6.3): if was verified and now fails, go pending first
  let newStatus;
  if (allVerified) {
    newStatus = 'verified';
  } else if (doc.status === 'verified') {
    // Check if already in grace period
    newStatus = 'pending'; // 72h grace
  } else if (doc.status === 'pending') {
    // Check if 72h grace elapsed
    const lastChecked = doc.last_checked ? new Date(doc.last_checked) : null;
    const gracePeriodMs = 72 * 60 * 60 * 1000;
    if (lastChecked && (Date.now() - lastChecked.getTime()) > gracePeriodMs) {
      newStatus = 'unverified';
    } else {
      newStatus = 'pending';
    }
  } else {
    newStatus = 'unverified';
  }

  return { status: newStatus, claims: claimResults };
}

// ── 48h re-verification cycle (SPEC-147 §6.2) ────────────────────────────
// Spread checks across the window (not all at once). setInterval-based.

const RE_VERIFY_INTERVAL_MS = 48 * 60 * 60 * 1000; // 48h
const RE_VERIFY_SPREAD_MS   =  5 * 60 * 1000;       // 5 min per check spread

let _reVerifyTimeout = null;

async function runReVerificationCycle() {
  // Skip pending_key_registration docs — they need a pubkey registered via the forge first.
  // URL-verification without GPG confirmation is meaningless; they'll re-enter the cycle
  // once the forge sets their status to 'unverified' after signature.verify runs.
  const docs = DeclarationsIndex.find({
    revoked: { $ne: true },
    status:  { $ne: 'pending_key_registration' },
  }).fetch();
  if (docs.length === 0) return;

  console.log('[declarations-indexer] re-verification cycle started for', docs.length, 'declarations');

  // Spread checks to avoid burst scraping
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const delayMs = i * RE_VERIFY_SPREAD_MS;

    Meteor.setTimeout(async () => {
      try {
        const result = await verifyDeclaration(doc);
        const now    = new Date().toISOString();

        DeclarationsIndex.update(
          { _id: doc._id },
          { $set: {
            status:      result.status,
            last_checked: now,
            claims:      result.claims,
            revoked:     result.status === 'unverified' && !!doc.revocation_cid,
          }}
        );

        console.log('[declarations-indexer] re-verified', doc._id, '→', result.status);
      } catch (err) {
        console.error('[declarations-indexer] re-verify error for', doc._id, ':', err.message);
      }
    }, delayMs);
  }
}

// ── Startup ────────────────────────────────────────────────────────────────

Meteor.startup(function () {
  koad.ready.register('declarations');
  // Initial scan
  walkEntityDeclarations();

  // Start file watchers
  watchEntityDeclarations();

  // 48h re-verification cycle — offset initial run by 10 minutes to let startup settle
  Meteor.setTimeout(function () {
    runReVerificationCycle();
    Meteor.setInterval(runReVerificationCycle, RE_VERIFY_INTERVAL_MS);
  }, 10 * 60 * 1000);

  console.log('[declarations-indexer] live — watching trust/declarations/ across all entity dirs');
  koad.ready.signal('declarations');
});

// ── REST endpoint: POST /api/declarations (from forge me.signature.create) ─

// This hook is called when the forge method pushes a new declaration doc.
// The daemon exposes this via api.js; we export the handler here for wiring.
globalThis._declarationsUpsertHandler = async function (doc) {
  if (!doc || !doc._id) return { error: 'missing _id' };

  const existing = DeclarationsIndex.findOne({ _id: doc._id });
  if (existing) {
    DeclarationsIndex.update({ _id: doc._id }, { $set: doc });
  } else {
    DeclarationsIndex.insert(doc);
  }

  console.log('[declarations-indexer] upserted via REST:', doc._id);
  return { ok: true, cid: doc._id };
};
