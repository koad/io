#!/usr/bin/env node
// verify-bridge.mjs — Sigchain integrity verification bridge
//
// Called by command.sh. Reads config from environment variables.
//
// Verification steps:
//   1. Read identity.json from ~/.<entity>/id/
//   2. If sigchain_tip_cid exists in identity.json, read cached entries from
//      ~/.vesta/entities/<entity>/sigchain/entries/ (written during submit)
//   3. Walk the chain with verifyChain() — validates signatures and CID links
//   4. Optionally verify SPEC-150 submission object shape
//   5. Report pass/fail per step
//
// Environment:
//   KOAD_IO_VERIFY_ENTITY     — entity handle (required)
//   KOAD_IO_VERIFY_PASSPHRASE — leaf key passphrase (Path A; optional)
//   KOAD_IO_VERIFY_VERBOSE    — '1' = verbose output
//   KOAD_IO_VERIFY_JSON       — '1' = JSON output
//   HOME                      — used to resolve ~/.<entity>/id/

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Resolve @koad-io/node module path
// ---------------------------------------------------------------------------

const homeDir = process.env.HOME || os.homedir();
const nodeModulePath = join(homeDir, '.koad-io', 'modules', 'node');

let sigchainMod, identityMod, ceremonyMod;
try {
  sigchainMod  = await import(join(nodeModulePath, 'sigchain.js'));
  identityMod  = await import(join(nodeModulePath, 'identity.js'));
  ceremonyMod  = await import(join(nodeModulePath, 'ceremony.js'));
} catch (err) {
  console.error(`[identity-verify] ERROR: Cannot import @koad-io/node modules from ${nodeModulePath}`);
  console.error(`  ${err.message}`);
  process.exit(1);
}

const { verifyChain, verifyEntry, computeCID } = sigchainMod;
const { createKoadIdentity } = identityMod;

// ---------------------------------------------------------------------------
// Read environment config
// ---------------------------------------------------------------------------

const entity     = process.env.KOAD_IO_VERIFY_ENTITY    || '';
const passphrase = process.env.KOAD_IO_VERIFY_PASSPHRASE || '';
const verbose    = process.env.KOAD_IO_VERIFY_VERBOSE    === '1';
const jsonOutput = process.env.KOAD_IO_VERIFY_JSON       === '1';

if (!entity) {
  console.error('[identity-verify] ERROR: KOAD_IO_VERIFY_ENTITY is required');
  process.exit(1);
}

const idDir = join(homeDir, `.${entity}`, 'id');
const vestaDir = join(homeDir, '.vesta', 'entities', entity, 'sigchain');

// ---------------------------------------------------------------------------
// Result accumulator
// ---------------------------------------------------------------------------

const checks = [];
let overallPass = true;

function check(label, passed, detail = null) {
  checks.push({ label, passed, detail });
  if (!passed) overallPass = false;
  if (!jsonOutput) {
    const icon = passed ? 'PASS' : 'FAIL';
    const detailStr = detail ? ` — ${detail}` : '';
    console.log(`  [${icon}] ${label}${detailStr}`);
  }
}

// ---------------------------------------------------------------------------
// Step 1 — Read identity.json
// ---------------------------------------------------------------------------

if (!jsonOutput) console.log(`\nVerifying identity: ${entity}\n`);

const metadataPath = join(idDir, 'identity.json');
if (!existsSync(metadataPath)) {
  check('identity.json exists', false, `not found at ${metadataPath}`);
  outputAndExit();
}

let metadata;
try {
  metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  check('identity.json readable', true);
} catch (err) {
  check('identity.json readable', false, err.message);
  outputAndExit();
}

// Check required fields
check(
  'masterFingerprint present',
  !!metadata.masterFingerprint,
  metadata.masterFingerprint || 'missing'
);
check(
  'leafFingerprints present',
  Array.isArray(metadata.leafFingerprints) && metadata.leafFingerprints.length > 0,
  metadata.leafFingerprints ? `[${metadata.leafFingerprints.join(', ')}]` : 'missing'
);

const hasTip = !!metadata.sigchain_tip_cid;
check(
  'sigchain_tip_cid present',
  hasTip,
  hasTip ? metadata.sigchain_tip_cid : 'not submitted yet — run identity submit first'
);

// ---------------------------------------------------------------------------
// Step 2 — Read cached sigchain entries from Vesta registry
// ---------------------------------------------------------------------------

let cachedEntries = [];
let entriesDir = null;

if (hasTip) {
  entriesDir = join(vestaDir, 'entries');

  if (existsSync(entriesDir)) {
    // Read all .json files from entries/ cache
    try {
      const files = readdirSync(entriesDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = JSON.parse(readFileSync(join(entriesDir, file), 'utf8'));
          cachedEntries.push(raw);
        } catch (e) {
          check(`entry cache file ${file} readable`, false, e.message);
        }
      }
      check(
        `entry cache readable (${cachedEntries.length} entries)`,
        cachedEntries.length > 0,
        cachedEntries.length === 0 ? 'no entries cached — chain walk requires cached entries' : null
      );
    } catch (err) {
      check('entries cache directory readable', false, err.message);
    }
  } else {
    check(
      'Vesta entry cache present',
      false,
      `${entriesDir} not found — entries were not written by identity submit`
    );
  }

  // ---------------------------------------------------------------------------
  // Fallback A: Fetch entries from IPFS when cache is empty
  // ---------------------------------------------------------------------------

  if (cachedEntries.length === 0 && hasTip) {
    if (!jsonOutput) {
      console.log('\n  No cached entries found. Attempting IPFS fetch for sigchain entries...');
    }

    const ipfsGateway = process.env.KOAD_IO_IPFS_GATEWAY || 'https://ipfs.io/ipfs';
    const ipfsTimeout = parseInt(process.env.KOAD_IO_IPFS_TIMEOUT || '20', 10) * 1000;

    /**
     * Fetch a single CID from IPFS (ipfs CLI or gateway).
     * Returns the parsed JSON object or null on failure.
     */
    async function fetchFromIpfs(cid) {
      // Try ipfs CLI
      try {
        const { execSync } = await import('child_process');
        const raw = execSync(`ipfs cat ${cid}`, { timeout: ipfsTimeout, stdio: ['ignore', 'pipe', 'ignore'] });
        return JSON.parse(raw.toString('utf8'));
      } catch (_) {}

      // Fall back to HTTP gateway
      if (typeof fetch !== 'undefined') {
        try {
          const resp = await Promise.race([
            fetch(`${ipfsGateway}/${cid}`),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ipfsTimeout)),
          ]);
          if (resp && resp.ok) {
            return await resp.json();
          }
        } catch (_) {}
      }
      return null;
    }

    // Walk the chain from the tip, following 'previous' links until we reach genesis.
    // Each fetched entry is written into the local cache so future verify calls are fast.
    const fetchedEntries = [];
    let walkCID = metadata.sigchain_tip_cid;
    let walkDepth = 0;
    const MAX_WALK = 256; // safety ceiling against infinite loops

    while (walkCID && walkDepth < MAX_WALK) {
      walkDepth++;
      const entryObj = await fetchFromIpfs(walkCID);
      if (!entryObj) {
        check(`IPFS fetch for ${walkCID.slice(0, 16)}...`, false, 'not reachable via ipfs CLI or gateway');
        break;
      }
      fetchedEntries.push(entryObj);

      // Write to local cache for next time
      if (existsSync(join(vestaDir, 'entries')) || (() => {
        try { mkdirSync(join(vestaDir, 'entries'), { recursive: true }); return true; } catch (_) { return false; }
      })()) {
        const cacheFile = join(vestaDir, 'entries', `${walkCID}.json`);
        try {
          writeFileSync(cacheFile, JSON.stringify(entryObj, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });
          if (verbose && !jsonOutput) {
            console.log(`    Cached fetched entry: ${walkCID.slice(0, 16)}...`);
          }
        } catch (_) {}
      }

      // Follow previous link
      const prev = entryObj.previous;
      if (!prev || prev === null) break; // reached genesis
      walkCID = prev;
    }

    if (fetchedEntries.length > 0) {
      cachedEntries = fetchedEntries;
      check(`IPFS chain walk fetched ${fetchedEntries.length} entr${fetchedEntries.length === 1 ? 'y' : 'ies'}`, true);
    } else {
      // IPFS unavailable — fall through to local key-file reconstruction
      if (!jsonOutput) {
        console.log('  IPFS unavailable. Falling back to local key file verification...');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Fallback B: reconstruct entries from identity files directly
  // ---------------------------------------------------------------------------

  if (cachedEntries.length === 0) {
    if (!jsonOutput) {
      console.log('\n  No cached entries found. Attempting reconstruction from identity files...');
    }

    // We can reconstruct genesis + leaf-authorize if we have the leaf key loaded
    // This path verifies the locally-available key material without needing cached IPFS entries
    const leafPrivPath  = join(idDir, 'leaf.private.asc');
    const deviceKeyPath = join(idDir, 'device.key');
    const masterPubPath = join(idDir, 'master.pub.asc');

    if (existsSync(leafPrivPath) && existsSync(masterPubPath)) {
      check('Key files present for local reconstruction', true);

      // We can at minimum verify the master pub key fingerprint matches identity.json
      const masterPub = readFileSync(masterPubPath, 'utf8');

      let reconFP = null;
      try {
        // Import the master public key via kbpgp KeyManager to extract fingerprint
        // kbpgp KeyManager.import_from_armored_pgp works for public keys too
        const kbpgp = (await import(join(nodeModulePath, 'node_modules', 'kbpgp', 'lib', 'openpgp', 'keymanager.js'))).KeyManager;
        const km = await new Promise((resolve, reject) => {
          kbpgp.import_from_armored_pgp({ armored: masterPub }, (err, loaded) => {
            if (err) return reject(err);
            resolve(loaded);
          });
        });
        const fpBuf = km.get_pgp_fingerprint();
        reconFP = fpBuf ? fpBuf.toString('hex').toUpperCase() : null;
      } catch (e) {
        // Could not import kbpgp directly; fall back to extractKMInfo if available
        try {
          if (typeof ceremonyMod.extractKMInfo === 'function') {
            const { fingerprint } = await ceremonyMod.extractKMInfo(masterPub);
            reconFP = fingerprint;
          }
        } catch (_) {}
      }

      if (reconFP) {
        check(
          'Master pubkey fingerprint matches identity.json',
          reconFP === metadata.masterFingerprint,
          `found: ${reconFP}, expected: ${metadata.masterFingerprint}`
        );
      } else {
        check(
          'Master pubkey fingerprint verifiable',
          false,
          'Cannot extract fingerprint from master.pub.asc — importArmoredMasterPublicKey not available'
        );
      }
    } else {
      check('Key files present', false, 'leaf.private.asc or master.pub.asc missing');
    }
  }
}

// ---------------------------------------------------------------------------
// Step 3 — Chain walk verification
// ---------------------------------------------------------------------------

if (cachedEntries.length > 0) {
  if (!jsonOutput) console.log('\n  Chain walk:');

  // Sort entries by genesis first (entries with previous=null first, then by chain order)
  // Attempt to sort by detecting the chain order
  const sortedEntries = sortChainEntries(cachedEntries);

  try {
    const chainResult = await verifyChain(sortedEntries);

    check('Chain valid (no critical errors)', chainResult.valid, chainResult.errors.length > 0 ? `${chainResult.errors.length} errors` : null);
    check(
      'Entity handle consistent',
      chainResult.entity_handle === entity,
      `chain: ${chainResult.entity_handle}, expected: ${entity}`
    );
    check(
      'Master fingerprint consistent',
      chainResult.masterFingerprint === metadata.masterFingerprint,
      `chain: ${chainResult.masterFingerprint}, identity.json: ${metadata.masterFingerprint}`
    );
    check(
      'Sigchain tip CID consistent',
      chainResult.sigchainHeadCID === metadata.sigchain_tip_cid,
      `chain: ${chainResult.sigchainHeadCID}, identity.json: ${metadata.sigchain_tip_cid}`
    );

    if (chainResult.leafSet.length > 0) {
      const leafFps = chainResult.leafSet.map(l => l.fingerprint);
      const identityLeafFps = metadata.leafFingerprints || [];
      const allPresent = identityLeafFps.every(fp => leafFps.includes(fp));
      check(
        `Leaf keys authorized (${chainResult.leafSet.length} active)`,
        chainResult.leafSet.length > 0,
        allPresent ? null : `identity.json leaf(s) not in chain: ${identityLeafFps.filter(fp => !leafFps.includes(fp)).join(', ')}`
      );
    } else {
      check('At least one leaf authorized', false, 'chain has no authorized leaves');
    }

    if (verbose && !jsonOutput) {
      console.log('\n  Chain walk detail:');
      console.log(`    Entity:             ${chainResult.entity_handle}`);
      console.log(`    Master fingerprint: ${chainResult.masterFingerprint}`);
      console.log(`    Sigchain head CID:  ${chainResult.sigchainHeadCID}`);
      console.log(`    Active leaves:      ${chainResult.leafSet.length}`);
      for (const leaf of chainResult.leafSet) {
        console.log(`      - ${leaf.fingerprint} (${leaf.device_label || 'no label'})`);
      }
      if (chainResult.errors.length > 0) {
        console.log(`    Errors (${chainResult.errors.length}):`);
        for (const err of chainResult.errors) {
          console.log(`      [${err.index}:${err.type}] ${err.error}`);
        }
      }
    }
  } catch (err) {
    check('Chain walk completed', false, err.message);
  }
}

// ---------------------------------------------------------------------------
// Step 4 — Vesta registry consistency check
// ---------------------------------------------------------------------------

if (!jsonOutput) console.log('\n  Vesta registry:');

const vestaMetaPath = join(vestaDir, 'metadata.json');
const vestaHeadPath = join(vestaDir, 'sigchain-head.txt');

if (existsSync(vestaMetaPath)) {
  try {
    const vestaMeta = JSON.parse(readFileSync(vestaMetaPath, 'utf8'));
    check('Vesta metadata.json readable', true);
    check(
      'Vesta masterFingerprint consistent',
      vestaMeta.masterFingerprint === metadata.masterFingerprint,
      `vesta: ${vestaMeta.masterFingerprint}, identity: ${metadata.masterFingerprint}`
    );
    if (hasTip) {
      check(
        'Vesta sigchainHeadCID consistent with identity.json',
        vestaMeta.sigchainHeadCID === metadata.sigchain_tip_cid,
        `vesta: ${vestaMeta.sigchainHeadCID}, identity: ${metadata.sigchain_tip_cid}`
      );
    }
  } catch (err) {
    check('Vesta metadata.json readable', false, err.message);
  }
} else {
  check(
    'Vesta registry written',
    false,
    `${vestaMetaPath} not found — run identity submit to create the registry`
  );
}

if (existsSync(vestaHeadPath)) {
  const vestaHead = readFileSync(vestaHeadPath, 'utf8').trim();
  if (hasTip) {
    check(
      'Vesta sigchain-head.txt consistent',
      vestaHead === metadata.sigchain_tip_cid,
      `vesta: ${vestaHead}, identity: ${metadata.sigchain_tip_cid}`
    );
  } else {
    check('Vesta sigchain-head.txt present', true, vestaHead);
  }
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

outputAndExit();

function outputAndExit() {
  const passCount = checks.filter(c => c.passed).length;
  const failCount = checks.filter(c => !c.passed).length;

  if (jsonOutput) {
    console.log(JSON.stringify({
      entity,
      overall: overallPass ? 'pass' : 'fail',
      passed: passCount,
      failed: failCount,
      checks,
    }, null, 2));
  } else {
    console.log('');
    console.log(`Result: ${overallPass ? 'PASS' : 'FAIL'} (${passCount} passed, ${failCount} failed)`);
    console.log('');
  }

  process.exit(overallPass ? 0 : 1);
}

/**
 * Sort chain entries in genesis-first order.
 * Entries are expected to be { entry, cid } pairs or plain signed entries.
 * Returns plain entries sorted for verifyChain().
 */
function sortChainEntries(entries) {
  // Normalize to plain entry objects
  const plain = entries.map(e => {
    if (e && typeof e === 'object' && 'entry' in e) return e.entry;
    return e;
  });

  // Find genesis (previous === null)
  const genesis = plain.find(e => e.previous === null);
  if (!genesis) return plain; // can't sort, return as-is

  // Build ordered chain by following previous links
  const byCID = {};
  for (const e of plain) {
    // We don't have pre-computed CIDs here, so use a different sort strategy:
    // sort by type — genesis first, then leaf-authorize, then everything else
    byCID[e.type] = e;
  }

  const typeOrder = [
    'koad.identity.genesis',
    'koad.genesis',
    'koad.identity.leaf-authorize',
    'koad.identity.leaf-revoke',
    'koad.identity.prune-all',
    'koad.identity.key-succession',
  ];

  const sorted = [];
  // Add genesis first
  sorted.push(genesis);
  // Add the rest in chain order by following previous links
  const added = new Set([genesis]);
  let current = genesis;
  let iterations = 0;
  while (sorted.length < plain.length && iterations < plain.length + 1) {
    iterations++;
    // Find an entry whose previous matches the current entry's CID
    // Since we don't have CIDs, we can't do this perfectly.
    // Fall back to type-order sort for entries we haven't yet added.
    const remaining = plain.filter(e => !added.has(e));
    if (remaining.length === 0) break;

    // Use type order to pick the next most likely entry
    let next = null;
    for (const t of typeOrder) {
      next = remaining.find(e => e.type === t);
      if (next) break;
    }
    if (!next) next = remaining[0];

    sorted.push(next);
    added.add(next);
    current = next;
  }

  return sorted;
}
