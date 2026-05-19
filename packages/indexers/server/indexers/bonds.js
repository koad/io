// Bonds indexer — worker (periodic re-scan)
// Scans ~/.<entity>/trust/bonds/, indexes bond filenames and types
// Cross-kingdom bonds (per VESTA-SPEC-115 §7.2) are routed to CrossKingdomBonds collection

const fs = Npm.require('fs');
const path = Npm.require('path');

const BondsIndex = new Mongo.Collection('BondsIndex', { connection: null });

// Local ref to CrossKingdomBonds (also declared in packages/core/server/collections.js
// with { connection: null } — Meteor dedupes by name). Declared here too for
// robustness against load order, since this file's worker task can fire before
// core's collections.js evaluates in dev mode.
const CrossKingdomBonds = new Mongo.Collection('CrossKingdomBonds', { connection: null });

// Parse minimal YAML frontmatter from a bond file
// Returns an object with any frontmatter fields found, or {} on failure
// Only reads up to the closing '---' to stay lightweight
function parseFrontmatter(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.startsWith('---')) return {};
    const end = content.indexOf('\n---', 3);
    if (end === -1) return {};
    const block = content.slice(3, end).trim();
    const result = {};
    for (const line of block.split('\n')) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const key = line.slice(0, colon).trim();
      const val = line.slice(colon + 1).trim();
      // Parse booleans and bare strings
      if (val === 'true') result[key] = true;
      else if (val === 'false') result[key] = false;
      else result[key] = val;
    }
    return result;
  } catch (e) {
    return {};
  }
}

// Normalize a raw status prose string to a structured enum value.
// "ACTIVE — signed by..." → "active"
// "REVOKED" → "revoked"
// "EXPIRED" → "expired"
// Unknown → "unsigned" (issuer hasn't set active yet)
function normalizeStatus(rawStatus) {
  if (!rawStatus || typeof rawStatus !== 'string') return 'unsigned';
  const upper = rawStatus.toUpperCase();
  if (upper.startsWith('ACTIVE')) return 'active';
  if (upper.startsWith('REVOK')) return 'revoked';
  if (upper.startsWith('EXPIR')) return 'expired';
  return 'unsigned';
}

// Parse a date string into a Date object, or null on failure.
function parseDate(str) {
  if (!str || typeof str !== 'string') return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

// Parse renewal field: "Annual (2027-03-31)" → Date(2027-03-31), or null.
function parseRenewal(str) {
  if (!str || typeof str !== 'string') return null;
  const m = str.match(/\((\d{4}-\d{2}-\d{2})\)/);
  if (!m) return parseDate(str); // try raw date parse as fallback
  return parseDate(m[1]);
}

// Scan bond file body for recipient-acknowledgment checkbox state.
// Returns true if "[ x] Recipient acknowledges" is checked, false otherwise.
// Looks for lines matching /^\[x\]/i after a ## Signing section.
function parseAcknowledged(filePath, toHandle) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // Look for the signing section
    const signingIdx = content.indexOf('## Signing');
    const block = signingIdx !== -1 ? content.slice(signingIdx) : content;
    // Match checked checkbox lines: "[x]" at start of line (case-insensitive)
    const lines = block.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Match: [x] <anything containing "acknowledges">
      if (/^\[x\]/i.test(trimmed) && trimmed.toLowerCase().includes('acknowledges')) {
        return true;
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

// Parse fromHandle/toHandle from a bond filename (e.g. "juno-to-vulcan.md" → {from:"juno",to:"vulcan"})
function parseHandlesFromFilename(filename) {
  const base = filename.replace(/\.(md|asc|json)$/, '');
  const m = base.match(/^(.+?)-to-(.+)$/);
  if (!m) return { fromHandle: null, toHandle: null };
  return { fromHandle: m[1], toHandle: m[2] };
}

// Extract the first sentence of the Bond Statement blockquote (> lines after ## Bond Statement)
// Returns a string truncated to 200 chars, or null if not found
function parseBondSummary(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const sectionIdx = content.indexOf('## Bond Statement');
    if (sectionIdx === -1) return null;
    const after = content.slice(sectionIdx + '## Bond Statement'.length);
    // Find first line starting with '>'
    for (const line of after.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('>')) {
        const text = trimmed.slice(1).trim();
        if (!text) continue;
        return text.length > 200 ? text.slice(0, 197) + '...' : text;
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

// Enrich a bond entry (.md file) with frontmatter fields, handle pair, summary,
// and tier-1 enhanced fields: normalized status enum, parsed dates, sigStatus,
// acknowledged boolean.
// ascPresent: boolean — whether a companion .asc file exists in the bonds dir.
function enrichBondEntry(entry, bondFilePath, ascPresent) {
  const fm = parseFrontmatter(bondFilePath);
  const { fromHandle, toHandle } = parseHandlesFromFilename(entry.filename);
  const summary = parseBondSummary(bondFilePath);
  const acknowledged = parseAcknowledged(bondFilePath, toHandle);
  const enriched = Object.assign({}, entry);

  // Handle pair
  if (fromHandle) enriched.fromHandle = fromHandle;
  if (toHandle)   enriched.toHandle   = toHandle;

  // Frontmatter fields
  if (fm.type)       enriched.bondType   = fm.type;
  if (fm.from)       enriched.from       = fm.from;
  if (fm.to)         enriched.to         = fm.to;
  if (fm.visibility) enriched.visibility = fm.visibility;

  // status — normalized enum (replaces raw prose string)
  enriched.status = normalizeStatus(fm.status || '');

  // Apply pending override: active + no acknowledgment = pending
  if (enriched.status === 'active' && !acknowledged) {
    enriched.status = 'pending';
  }

  // createdAt — parsed Date; also keep 'created' as backward-compat string alias
  // (storefront sigchain reads b.created as a string — preserving it avoids a consumer update)
  enriched.created   = fm.created || null;  // raw string from frontmatter (compat)
  enriched.createdAt = parseDate(fm.created || null); // parsed Date (new canonical field)

  // renewalAt — parsed Date (new field, previously dropped)
  const renewalDate = parseRenewal(fm.renewal || null);
  if (renewalDate) {
    enriched.renewalAt = renewalDate;
    // Override status to expired if past renewalAt
    if (enriched.status !== 'revoked' && renewalDate < new Date()) {
      enriched.status = 'expired';
    }
  }

  // sigStatus — derived from .asc companion presence
  enriched.sigStatus = ascPresent ? 'signed' : 'unsigned';

  // acknowledged — boolean from checkbox scan
  enriched.acknowledged = acknowledged;

  if (summary) enriched.summary = summary;
  return enriched;
}

// Determine if a bond crosses kingdom boundaries
// Returns { crossKingdom, fromKingdomId, toKingdomId } or null if no kingdoms configured
function detectCrossKingdom(issuerHandle, bondFilename, bondFilePath) {
  // Kingdoms must be indexed; lazy reference (kingdoms.js may load after bonds.js)
  if (typeof Kingdoms === 'undefined') return null;

  // Check explicit frontmatter flag first (only for .md files)
  let frontmatter = {};
  const ext = path.extname(bondFilename);
  if (ext === '.md' || ext === '.asc') {
    frontmatter = parseFrontmatter(bondFilePath);
  }

  // Derive issuer's kingdom from Entities collection
  const issuerEntity = EntityScanner.Entities.findOne({ handle: issuerHandle });
  const fromKingdomId = (issuerEntity && issuerEntity.kingdomId) || null;

  // Explicit cross_kingdom flag in frontmatter → always route to CrossKingdomBonds
  if (frontmatter.cross_kingdom === true) {
    // Try to read recipient handle from frontmatter (field: 'to' or 'recipient')
    const recipientHandle = frontmatter.to || frontmatter.recipient || null;
    const recipientEntity = recipientHandle
      ? EntityScanner.Entities.findOne({ handle: recipientHandle })
      : null;
    const toKingdomId = (recipientEntity && recipientEntity.kingdomId) || null;

    return {
      crossKingdom: true,
      fromKingdomId,
      toKingdomId,
      recipientHandle,
      bondType: frontmatter.type || frontmatter.bond_type || null,
      sigStatus: ext === '.asc' ? 'signed' : 'unsigned',
    };
  }

  // No explicit flag — try membership-based detection
  // Need both issuer kingdom and a readable 'to' field to make the call
  if (!fromKingdomId) return null; // Issuer has no kingdom — can't determine cross-kingdom

  const recipientHandle = frontmatter.to || frontmatter.recipient || null;
  if (!recipientHandle) return null; // No recipient in frontmatter — can't determine

  const recipientEntity = EntityScanner.Entities.findOne({ handle: recipientHandle });
  const toKingdomId = (recipientEntity && recipientEntity.kingdomId) || null;

  if (!toKingdomId || toKingdomId === fromKingdomId) return null; // Same kingdom or unresolvable

  return {
    crossKingdom: true,
    fromKingdomId,
    toKingdomId,
    recipientHandle,
    bondType: frontmatter.type || frontmatter.bond_type || null,
    sigStatus: ext === '.asc' ? 'signed' : 'unsigned',
  };
}

// Upsert a cross-kingdom bond record
function upsertCrossKingdomBond(issuerHandle, filename, bondFilePath, detection) {
  // Stable ID: issuerHandle + filename (bonds are per-file)
  const id = `${issuerHandle}::${filename}`;
  const doc = {
    fromEntity: issuerHandle,
    toEntity: detection.recipientHandle || null,
    fromKingdomId: detection.fromKingdomId,
    toKingdomId: detection.toKingdomId,
    bondType: detection.bondType,
    bondFile: filename,
    sigStatus: detection.sigStatus,
    scannedAt: new Date(),
  };

  const existing = CrossKingdomBonds.findOne({ _id: id });
  if (existing) {
    CrossKingdomBonds.update(id, { $set: doc });
  } else {
    CrossKingdomBonds.insert(Object.assign({ _id: id }, doc));
    console.log(`[BONDS] cross-kingdom: ${issuerHandle} (${detection.fromKingdomId}) → ${detection.toKingdomId} [${filename}]`);
  }
}

// Scan a single entity's trust/bonds/ directory
function indexEntity(handle, entityPath) {
  const bondsDir = path.join(entityPath, 'trust', 'bonds');
  try {
    const files = fs.readdirSync(bondsDir);

    // Build a set of .md filenames that have a companion .asc signature.
    // "juno-to-vulcan.md.asc" → .asc companion for "juno-to-vulcan.md"
    const ascPresenceSet = new Set();
    for (const filename of files) {
      if (filename.endsWith('.md.asc')) {
        // Strip the trailing ".asc" to get the .md filename
        ascPresenceSet.add(filename.slice(0, -4)); // e.g. "juno-to-vulcan.md"
      }
    }

    const intraBonds = [];
    const crossBondFilenames = new Set();

    for (const filename of files) {
      if (filename.startsWith('.')) continue;

      // Skip .asc files — their presence is captured via ascPresenceSet above
      // and merged into the parent .md entry as sigStatus. They no longer appear
      // as standalone bonds[] entries (tier-1 cleanup).
      if (filename.endsWith('.asc')) continue;

      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      const bondFilePath = path.join(bondsDir, filename);

      const detection = detectCrossKingdom(handle, filename, bondFilePath);
      if (detection && detection.crossKingdom) {
        upsertCrossKingdomBond(handle, filename, bondFilePath, detection);
        crossBondFilenames.add(filename);
      } else {
        const rawEntry = {
          filename,
          type: ext === '.md' ? 'bond' : 'other',
          base,
        };
        // Enrich .md bond files with frontmatter, summary, and tier-1 enhanced fields
        const ascPresent = ascPresenceSet.has(filename);
        const finalEntry = (ext === '.md')
          ? enrichBondEntry(rawEntry, bondFilePath, ascPresent)
          : rawEntry;
        intraBonds.push(finalEntry);
      }
    }

    // Remove stale cross-kingdom bond records for this entity that are no longer on disk
    CrossKingdomBonds.find({ fromEntity: handle }).fetch().forEach(rec => {
      if (!crossBondFilenames.has(rec.bondFile)) {
        CrossKingdomBonds.remove(rec._id);
      }
    });

    // Update BondsIndex with intra-kingdom bonds (count now reflects .md files only)
    const existing = BondsIndex.findOne({ handle });
    const doc = { handle, bonds: intraBonds, count: intraBonds.length, scannedAt: new Date() };

    if (existing) {
      BondsIndex.update(existing._id, { $set: doc });
    } else {
      BondsIndex.insert(doc);
    }
  } catch (e) {
    // No bonds directory — remove stale entries
    BondsIndex.remove({ handle });
    CrossKingdomBonds.remove({ fromEntity: handle });
  }
}

// Full scan
function scanAll() {
  const entities = EntityScanner.Entities.find().fetch();
  for (const entity of entities) {
    indexEntity(entity.handle, entity.path);
  }
}

// Startup (gated on KOAD_IO_INDEX_BONDS)
Meteor.startup(async () => {
  koad.ready.register('bonds');
  const mode = process.env.KOAD_IO_INDEX_BONDS;
  if (!mode) {
    koad.ready.signal('bonds');
    return;
  }

  if (mode === 'true') {
    if (typeof koad !== 'undefined' && koad.workers && typeof koad.workers.start === 'function') {
      await koad.workers.start({
        service: 'index-bonds',
        type: 'indexer',
        interval: 2,
        runImmediately: true,
        task: async () => {
          scanAll();
          console.log(`[BONDS] Scan complete: ${BondsIndex.find().count()} entities with bonds, ${CrossKingdomBonds.find().count()} cross-kingdom`);
          if (!globalThis.indexerReady) globalThis.indexerReady = {};
          if (!globalThis.indexerReady.bonds) globalThis.indexerReady.bonds = new Date().toISOString();
          koad.ready.signal('bonds'); // idempotent; no-op after first scan
        }
      });
    } else {
      console.warn('[BONDS] koad.workers unavailable (koad:io-worker-processes not resolved) — falling back to one-shot scan');
      scanAll();
      console.log(`[BONDS] Initial scan complete: ${BondsIndex.find().count()} entities with bonds, ${CrossKingdomBonds.find().count()} cross-kingdom`);
      if (!globalThis.indexerReady) globalThis.indexerReady = {};
      globalThis.indexerReady.bonds = new Date().toISOString();
      koad.ready.signal('bonds');
    }
  } else {
    // One-shot scan only
    scanAll();
    console.log(`[BONDS] Initial scan complete: ${BondsIndex.find().count()} entities with bonds, ${CrossKingdomBonds.find().count()} cross-kingdom`);
    if (!globalThis.indexerReady) globalThis.indexerReady = {};
    globalThis.indexerReady.bonds = new Date().toISOString();
    koad.ready.signal('bonds');
  }
});

// Publications
Meteor.publish('bonds', async function () {
  await koad.ready.await('bonds');
  return BondsIndex.find();
});

Meteor.publish('bonds.entity', async function (handle) {
  check(handle, String);
  await koad.ready.await('bonds');
  return BondsIndex.find({ handle });
});

Meteor.publish('crossKingdomBonds', async function () {
  await koad.ready.await('bonds');
  return CrossKingdomBonds.find();
});

Meteor.publish('crossKingdomBonds.involving', async function (handle) {
  check(handle, String);
  await koad.ready.await('bonds');
  return CrossKingdomBonds.find({ $or: [{ fromEntity: handle }, { toEntity: handle }] });
});
