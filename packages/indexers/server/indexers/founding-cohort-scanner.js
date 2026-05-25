// Founding Cohort Badge Scanner — CACULA-SPEC-004 v1.0
//
// Scans koad's sigchain for koad.human-sponsor.bond-issued entries where
// founding: true, derives founding_index from signed_at order, and maintains
// a three-state badge state machine per CACULA-SPEC-004 §3:
//
//   PENDING  — bond on sigchain, founding_close_block not yet set (or conditions unmet)
//   CONFIRMED — bond on sigchain + founding_close_block declared + index ≤ 5
//   CLOSED-COHORT-FINAL — all 5/5 CONFIRMED
//
// founding_index is DERIVED (not stored in bond), per §4.1 algorithm:
//   1. Scan for all koad.human-sponsor.bond-issued entries where founding: true
//   2. Sort ascending by signed_at; tiebreaker: ascending grantee_handle
//   3. Assign founding_index as 1-based position
//   4. Entries at position > 5: confirmation_state = "invalid", flagged
//
// founding_close_block is read from:
//   ~/.cacula/config/founding-close-block.txt
// The file should contain a single integer (block height). If absent or unparseable,
// founding_close_block is null and all founding badges stay PENDING (correct behavior).
//
// Events fired (via daemon /emit REST endpoint, localhost only):
//   cacula.badge.founding-cohort.confirmed  — when a badge transitions PENDING → CONFIRMED
//   cacula.cohort.founding.closed           — when 5/5 CONFIRMED (CLOSED-COHORT-FINAL)
//   cacula.badge.founding-cohort.argus-flag — when a conformance error is detected
//
// Sigchain location: koad's sigchain is read from all entity dirs; the sovereign
// entity (handle = "koad") is the source of koad.human-sponsor.* entries.
// Fallback: also scan ~/.juno/sigchain/ (Juno may custody kingdom-side entries).
//
// Gate: KOAD_IO_INDEX_FOUNDING_COHORT env var (optional; scans at startup if absent
// since founding cohort is a core kingdom primitive).
//
// Test sigchain path: KOAD_IO_FOUNDING_COHORT_TEST_SIGCHAIN env var points to a
// directory containing synthetic bond-issued entries for testing. When set, the
// scanner appends test entries to the real scan results (union, not replace).
//
// Collections:
//   FoundingCohort   — per-badge records (one per founding grantee)
//   FoundingCohortLedger — the cohort summary (single doc, _id: "cohort")
//
// Publications:
//   founding.cohort        — full FoundingCohort collection
//   founding.cohort.ledger — the single ledger summary doc

const fs   = Npm.require('fs');
const path = Npm.require('path');
const http = Npm.require('http');

const HOME = process.env.HOME || '/home/koad';
const CACULA_CONFIG_PATH = path.join(HOME, '.cacula', 'config', 'founding-close-block.txt');
const EMIT_URL = 'http://localhost:28282/emit';

// Collections
const FoundingCohort = new Mongo.Collection('FoundingCohort', { connection: null });
const FoundingCohortLedger = new Mongo.Collection('FoundingCohortLedger', { connection: null });
globalThis.FoundingCohort = FoundingCohort;
globalThis.FoundingCohortLedger = FoundingCohortLedger;

// ---------------------------------------------------------------------------
// Founding position labels — per CACULA-SPEC-004 §2.1 (Iris owns final copy)
// ---------------------------------------------------------------------------
const POSITION_LABELS = ['First Bonded', 'Second Bonded', 'Third Bonded', 'Fourth Bonded', 'Fifth Bonded'];

// ---------------------------------------------------------------------------
// founding_close_block reader
// Static, versioned — not a database field (per spec + flight plan choice).
// Reads from ~/.cacula/config/founding-close-block.txt
// Until set, all founding badges stay PENDING — that is correct behavior.
// ---------------------------------------------------------------------------
function readFoundingCloseBlock() {
  try {
    const raw = fs.readFileSync(CACULA_CONFIG_PATH, 'utf8').trim();
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) return n;
    console.warn('[FOUNDING-COHORT] founding-close-block.txt exists but is not a valid uint:', raw);
    return null;
  } catch (e) {
    // File doesn't exist — correct state before koad declares the block height
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sigchain scanner — reads JSONL files from an entity's sigchain/
// Returns all entries as parsed objects. Lines that fail JSON.parse are skipped.
// ---------------------------------------------------------------------------
function readSigchainDir(sigchainDir) {
  const entries = [];
  let files;
  try {
    files = fs.readdirSync(sigchainDir).filter(f => f.endsWith('.jsonl'));
  } catch (e) {
    return entries;
  }

  for (const file of files) {
    const fullPath = path.join(sigchainDir, file);
    let raw;
    try {
      raw = fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
      continue;
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch (e) {
        // malformed line — skip
      }
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Find founding bond-issued entries
// Scans all candidate sigchain paths for koad.human-sponsor.bond-issued
// entries where founding: true
// ---------------------------------------------------------------------------
function scanFoundingBondEntries() {
  // Primary: koad's entity sigchain
  const sigchainPaths = [];

  // Check known sovereign sigchain locations
  const candidateDirs = [
    path.join(HOME, '.koad', 'sigchain'),  // explicit koad entity
    path.join(HOME, '.juno', 'sigchain'),  // juno may custody kingdom-side entries
  ];

  // Also check via EntityScanner for any entity that might hold koad.human-sponsor.* entries
  try {
    const entities = EntityScanner.Entities.find({ handle: 'koad' }).fetch();
    for (const e of entities) {
      const sc = path.join(e.path, 'sigchain');
      if (!candidateDirs.includes(sc)) candidateDirs.push(sc);
    }
  } catch (e) {
    // EntityScanner may not be available yet on first call; candidateDirs cover it
  }

  // Add test sigchain path if configured
  const testPath = process.env.KOAD_IO_FOUNDING_COHORT_TEST_SIGCHAIN;
  if (testPath) {
    candidateDirs.push(testPath);
    console.log('[FOUNDING-COHORT] test sigchain path active:', testPath);
  }

  const allEntries = [];
  for (const dir of candidateDirs) {
    const entries = readSigchainDir(dir);
    allEntries.push(...entries);
  }

  // Filter: only koad.human-sponsor.bond-issued where founding: true
  const foundingBonds = allEntries.filter(e =>
    e.type === 'koad.human-sponsor.bond-issued' && e.founding === true
  );

  return foundingBonds;
}

// ---------------------------------------------------------------------------
// Cohort-closed sigchain checker
// Scans sigchain for koad.human-sponsor.founding-cohort-update with cohort_closed: true
// ---------------------------------------------------------------------------
function isCohortClosedOnChain() {
  const closureEntries = [];

  const candidateDirs = [
    path.join(HOME, '.koad', 'sigchain'),
    path.join(HOME, '.juno', 'sigchain'),
  ];

  const testPath = process.env.KOAD_IO_FOUNDING_COHORT_TEST_SIGCHAIN;
  if (testPath) candidateDirs.push(testPath);

  for (const dir of candidateDirs) {
    const entries = readSigchainDir(dir);
    const closures = entries.filter(e =>
      e.type === 'koad.human-sponsor.founding-cohort-update' && e.cohort_closed === true
    );
    closureEntries.push(...closures);
  }

  return closureEntries.length > 0;
}

// ---------------------------------------------------------------------------
// founding_index derivation — §4.1 algorithm
// Sort ascending by signed_at; tiebreaker: ascending grantee_handle (alphabetical)
// Returns the sorted bonds array; index = position in array (1-based)
// ---------------------------------------------------------------------------
function deriveFundingIndex(foundingBonds) {
  const sorted = [...foundingBonds].sort((a, b) => {
    // Primary: signed_at ascending
    const tA = a.signed_at || '';
    const tB = b.signed_at || '';
    if (tA < tB) return -1;
    if (tA > tB) return 1;
    // Tiebreaker: grantee_handle ascending (alphabetical per §4.3)
    const hA = (a.grantee_handle || '').toLowerCase();
    const hB = (b.grantee_handle || '').toLowerCase();
    if (hA < hB) return -1;
    if (hA > hB) return 1;
    return 0;
  });
  return sorted;
}

// ---------------------------------------------------------------------------
// State machine — determine confirmation_state for a single badge
// Per CACULA-SPEC-004 §3
// ---------------------------------------------------------------------------
function deriveConfirmationState(bondEntry, foundingIndex, foundingCloseBlock, cohortSlotsFilled) {
  // Index > 5: invalid (per §5.3 — badge engine flags it)
  if (foundingIndex > 5) {
    return {
      confirmed: false,
      confirmation_state: 'invalid',
      confirmed_at_block: null,
    };
  }

  // PENDING: bond on sigchain, conditions not fully met
  if (!foundingCloseBlock) {
    return {
      confirmed: false,
      confirmation_state: 'pending',
      confirmed_at_block: null,
    };
  }

  // CONFIRMED: bond on sigchain AND close_block declared AND index ≤ 5
  // Note: confirmed_at_block = foundingCloseBlock (evaluation block height)
  // In production this would be the current chain block at evaluation time.
  // Since we don't have a live chain connection, we use foundingCloseBlock as proxy
  // (the block at which confirmation became possible).
  const confirmed = true;
  const confirmedAtBlock = foundingCloseBlock;

  // CLOSED-COHORT-FINAL: when 5/5 filled and all CONFIRMED
  if (cohortSlotsFilled >= 5) {
    return {
      confirmed,
      confirmation_state: 'closed-cohort-final',
      confirmed_at_block: confirmedAtBlock,
    };
  }

  return {
    confirmed,
    confirmation_state: 'confirmed',
    confirmed_at_block: confirmedAtBlock,
  };
}

// ---------------------------------------------------------------------------
// Build chain_verify_line per §2.1
// ---------------------------------------------------------------------------
function buildChainVerifyLine(bondEntry, foundingIndex, confirmedState) {
  if (confirmedState.confirmation_state === 'pending' || confirmedState.confirmation_state === 'invalid') {
    return 'Bond signed — awaiting founding window confirmation.';
  }
  const signedAtShort = (bondEntry.signed_at || '').slice(0, 10); // YYYY-MM-DD
  return `Bonded founding member #${foundingIndex} of 5 — bond signed ${signedAtShort}, verified via koad.human-sponsor.bond-issued on koad's sigchain.`;
}

// ---------------------------------------------------------------------------
// Event firing — fire a daemon emission via localhost REST /emit
// Non-blocking, non-fatal: if the daemon isn't ready yet, the event is skipped.
// This is intentional — founding cohort confirmation events are idempotent;
// the next scanner cycle will confirm the same state.
// ---------------------------------------------------------------------------
function fireEmission(entity, type, body, meta) {
  const payload = JSON.stringify({ entity, type, body, meta });

  const req = http.request({
    hostname: 'localhost',
    port: 28282,
    path: '/emit',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
    },
  }, (res) => {
    if (res.statusCode !== 200) {
      console.warn(`[FOUNDING-COHORT] emission fire returned ${res.statusCode} for ${type}`);
    }
  });

  req.on('error', (e) => {
    // Expected during startup before the REST stack is up — silent
    if (process.env.KOAD_IO_FOUNDING_COHORT_DEBUG) {
      console.warn(`[FOUNDING-COHORT] emission fire error (${type}):`, e.message);
    }
  });

  req.end(payload);
}

// ---------------------------------------------------------------------------
// Argus conformance flag fire
// ---------------------------------------------------------------------------
function fireArgusFlag(handle, foundingIndex, issue) {
  console.warn(`[FOUNDING-COHORT] ARGUS-FLAG: ${handle} (index ${foundingIndex}) — ${issue}`);
  fireEmission('cacula', 'cacula.badge.founding-cohort.argus-flag', `Conformance error: ${handle}`, {
    handle,
    founding_index: foundingIndex,
    issue,
    spec: 'CACULA-SPEC-004',
  });
}

// ---------------------------------------------------------------------------
// Track previous states to detect transitions (for event firing)
// ---------------------------------------------------------------------------
const _prevStates = new Map(); // handle → confirmation_state

// ---------------------------------------------------------------------------
// Main scan — projects founding cohort state into collections
// ---------------------------------------------------------------------------
function scan() {
  const foundingCloseBlock = readFoundingCloseBlock();
  const foundingBonds = scanFoundingBondEntries();
  const sortedBonds = deriveFundingIndex(foundingBonds);
  const cohortSlotsFilled = Math.min(sortedBonds.length, 5); // capped at 5 for valid cohort
  const cohortClosedOnChain = isCohortClosedOnChain();

  const badgeRecords = [];

  for (let i = 0; i < sortedBonds.length; i++) {
    const bond = sortedBonds[i];
    const foundingIndex = i + 1; // 1-based
    const handle = bond.grantee_handle || `unknown-${i}`;

    // Per §5.3 / §11.3: entries at position > 5 get invalid state + argus flag
    if (foundingIndex > 5) {
      fireArgusFlag(handle, foundingIndex, 'founding_index > 5: post-cohort bond entered the engine; ceremony layer should have blocked this');
    }

    const stateResult = deriveConfirmationState(bond, foundingIndex, foundingCloseBlock, cohortSlotsFilled);

    // Also upgrade to closed-cohort-final if sigchain declares it even before 5/5 fill
    // (defensive: sigchain closure entry is authoritative per §3.3)
    let finalConfirmationState = stateResult.confirmation_state;
    if (cohortClosedOnChain && stateResult.confirmation_state === 'confirmed') {
      finalConfirmationState = 'closed-cohort-final';
    }

    const chainVerifyLine = buildChainVerifyLine(bond, foundingIndex, { ...stateResult, confirmation_state: finalConfirmationState });

    // Argus: confirmed: true with founding_close_block: null is a conformance fail
    if (stateResult.confirmed && !foundingCloseBlock) {
      fireArgusFlag(handle, foundingIndex, 'confirmed: true with founding_close_block: null — invalid per CACULA-SPEC-004 §10');
    }

    const badge = {
      _id: handle,
      // Base recognized badge fields (CACULA-SPEC-004 §2.1)
      type: 'badge',
      subtype: 'achievement',
      id: 'recognized',
      category: 'membership',
      one_time: true,

      // Founding overlay
      founding: true,
      founding_index: foundingIndex,
      founding_position_label: foundingIndex <= 5 ? POSITION_LABELS[foundingIndex - 1] : `Position ${foundingIndex} (Invalid)`,

      bond_ref: {
        bond_cid: bond.bond_cid || null,
        bond_type: 'member',
        signed_at: bond.signed_at || null,
        spec: 'VESTA-SPEC-182',
      },

      // Confirmation state
      confirmed: stateResult.confirmed,
      confirmation_state: finalConfirmationState,
      confirmed_at_block: stateResult.confirmed_at_block,

      // Cohort record
      cohort_size: 5,
      cohort_slots_filled: cohortSlotsFilled,
      cohort_closed: cohortClosedOnChain || cohortSlotsFilled >= 5,

      // Chain verify line
      chain_verify_line: chainVerifyLine,

      // Governance
      founding_close_block: foundingCloseBlock,
      claim_model: 'opt-in',
      portability: 'kingdom_attested',

      // Display surfaces
      display_surface: ['profile', 'insider-panel', 'explorer-card'],
      founding_display_surface: ['kingdom-founding-ledger'],

      // Audit
      scanned_at: new Date(),
    };

    badgeRecords.push(badge);

    // Detect state transitions for event firing
    const prevState = _prevStates.get(handle);

    if (prevState !== finalConfirmationState) {
      if (finalConfirmationState === 'confirmed') {
        console.log(`[FOUNDING-COHORT] ${handle} → CONFIRMED (index ${foundingIndex})`);
        // Fire eligibility notification (opt-in claim model — event triggers UI prompt)
        fireEmission(handle, 'cacula.badge.founding-cohort.confirmed',
          `Your founding bond is confirmed. Claim your Founding Member badge.`,
          {
            handle,
            founding_index: foundingIndex,
            founding_position_label: badge.founding_position_label,
            badge_id: 'recognized',
            confirmed_at_block: stateResult.confirmed_at_block,
            claim_model: 'opt-in',
            spec: 'CACULA-SPEC-004',
            meta: {
              achievements: [{
                type: 'badge',
                earned_via: 'founding-cohort-bond',
                entity: handle,
                badge_id: 'recognized',
              }],
            },
          }
        );
      }

      if (finalConfirmationState === 'closed-cohort-final' && prevState !== 'closed-cohort-final') {
        console.log(`[FOUNDING-COHORT] ${handle} → CLOSED-COHORT-FINAL`);
      }

      _prevStates.set(handle, finalConfirmationState);
    }
  }

  // Upsert badge records into FoundingCohort collection
  const currentHandles = new Set(badgeRecords.map(b => b._id));

  // Remove stale records (handle no longer in scan — e.g. bond revoked)
  FoundingCohort.find().fetch().forEach(existing => {
    if (!currentHandles.has(existing._id)) {
      FoundingCohort.remove(existing._id);
      console.log('[FOUNDING-COHORT] removed stale badge record for:', existing._id);
    }
  });

  for (const badge of badgeRecords) {
    const existing = FoundingCohort.findOne({ _id: badge._id });
    if (existing) {
      FoundingCohort.update(badge._id, { $set: badge });
    } else {
      FoundingCohort.insert(badge);
      console.log(`[FOUNDING-COHORT] new badge record: ${badge._id} (index ${badge.founding_index})`);
    }
  }

  // Build and upsert the cohort ledger (CACULA-SPEC-004 §7.1)
  const ledgerSlots = [];
  for (let i = 1; i <= 5; i++) {
    const badge = badgeRecords.find(b => b.founding_index === i);
    if (badge) {
      ledgerSlots.push({
        index: i,
        handle: badge._id,
        display_name: null, // populated by storefront from EntityScanner
        confirmation_state: badge.confirmation_state,
        signed_at: badge.bond_ref ? badge.bond_ref.signed_at : null,
      });
    } else {
      ledgerSlots.push({
        index: i,
        handle: null,
        display_name: null,
        confirmation_state: 'empty',
        signed_at: null,
      });
    }
  }

  const allConfirmed = badgeRecords.filter(b => b.founding_index <= 5 && b.confirmed).length >= 5;
  const cohortClosed = cohortClosedOnChain || allConfirmed;

  const ledger = {
    _id: 'cohort',
    size: 5,
    slots: ledgerSlots,
    cohort_closed: cohortClosed,
    source: 'koad_sigchain',
    founding_close_block: foundingCloseBlock,
    scanned_at: new Date(),
  };

  const existingLedger = FoundingCohortLedger.findOne({ _id: 'cohort' });
  if (existingLedger) {
    FoundingCohortLedger.update('cohort', { $set: ledger });
  } else {
    FoundingCohortLedger.insert(ledger);
  }

  // Fire cohort-closed event when 5/5 confirmed and we haven't fired it before
  if (allConfirmed && !_prevStates.get('__cohort_closed__')) {
    console.log('[FOUNDING-COHORT] 5/5 CONFIRMED — firing cacula.cohort.founding.closed');
    const confirmedMembers = badgeRecords
      .filter(b => b.founding_index <= 5 && b.confirmed)
      .map(b => ({ handle: b._id, founding_index: b.founding_index }));

    fireEmission('cacula', 'cacula.cohort.founding.closed',
      `Founding cohort is complete — all 5 founding members confirmed.`,
      {
        confirmed_members: confirmedMembers,
        cohort_closed: true,
        spec: 'CACULA-SPEC-004',
      }
    );
    _prevStates.set('__cohort_closed__', true);
  }

  const validBadges = badgeRecords.filter(b => b.founding_index <= 5);
  const pending = validBadges.filter(b => b.confirmation_state === 'pending').length;
  const confirmed = validBadges.filter(b => b.confirmation_state === 'confirmed' || b.confirmation_state === 'closed-cohort-final').length;
  const invalid = badgeRecords.filter(b => b.confirmation_state === 'invalid').length;

  console.log(`[FOUNDING-COHORT] scan: ${validBadges.length}/5 bonds found — ${pending} pending, ${confirmed} confirmed${invalid ? `, ${invalid} invalid` : ''}${foundingCloseBlock ? ` (close_block: ${foundingCloseBlock})` : ' (close_block: not set)'}`);
}

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------
Meteor.publish('founding.cohort', async function () {
  await koad.ready.await('foundingCohort');
  return FoundingCohort.find();
});

Meteor.publish('founding.cohort.ledger', async function () {
  await koad.ready.await('foundingCohort');
  return FoundingCohortLedger.find();
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
Meteor.startup(() => {
  koad.ready.register('foundingCohort');

  Meteor.setTimeout(async () => {
    try {
      // Initial scan
      scan();

      // Periodic re-scan every 5 minutes (checks for new sigchain entries, close_block changes)
      // Gated on KOAD_IO_WORKERS_ENABLED — daemon runs one-shot only
      const workersEnabled = process.env.KOAD_IO_WORKERS_ENABLED !== 'false';
      if (workersEnabled && typeof koad !== 'undefined' && koad.workers && typeof koad.workers.start === 'function') {
        await koad.workers.start({
          service: 'founding-cohort-scan',
          type: 'indexer',
          interval: 5, // minutes
          runImmediately: false,
          task: async () => {
            scan();
          },
        });
        console.log('[FOUNDING-COHORT] periodic scan registered (5-min interval)');
      }
    } catch (e) {
      console.error('[FOUNDING-COHORT] startup error:', e.message);
    }

    if (!globalThis.indexerReady) globalThis.indexerReady = {};
    globalThis.indexerReady.foundingCohort = new Date().toISOString();
    koad.ready.signal('foundingCohort');

    console.log('[FOUNDING-COHORT] live — scanning koad.human-sponsor.bond-issued entries');
  }, 3000); // after entity-scanner and bonds have loaded
});
