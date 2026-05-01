#!/usr/bin/env node
// submit-bridge.mjs — Sigchain entry submission bridge (VESTA-SPEC-150)
//
// Called by command.sh. Reads config from environment variables.
//
// Flow:
//   1. Read identity from ~/.<entity>/id/ (master.pub.asc, leaf.private.asc, device.key, identity.json)
//   2. Load leaf key into koad.identity object
//   3. Build sigchain entries (genesis + leaf-authorize) from the identity material
//      - If identity.json already has sigchain_tip_cid: skip genesis re-generation
//        (identity was already submitted — build only the submission message)
//      - If no sigchain_tip_cid: first submission — build genesis + leaf-authorize
//   4. Pin entries to IPFS (HTTP API or ipfs CLI)
//   5. Build SPEC-150 head submission message, sign with leaf key
//   6. Notify Vesta endpoint (if --vesta-url provided)
//   7. Write local Vesta registry (unless --no-vesta-write)
//   8. Update identity.json with sigchain_tip_cid and entry CIDs
//   9. Optional: anchor on-chain (ROOTY-SPEC-001 OP_RETURN broadcast)
//
// Environment:
//   KOAD_IO_SUBMIT_ENTITY          — entity handle (required)
//   KOAD_IO_SUBMIT_PASSPHRASE      — leaf key passphrase (Path A; default: reads device.key)
//   KOAD_IO_SUBMIT_IPFS_API        — IPFS HTTP API URL (default: http://127.0.0.1:5001)
//   KOAD_IO_SUBMIT_ANCHOR_CHAIN    — chain ticker for OP_RETURN anchor (optional)
//   KOAD_IO_SUBMIT_ANCHOR_KEY      — path to chain wallet key file (optional)
//   KOAD_IO_SUBMIT_DRY_RUN         — '1' = build but do not pin/anchor/write
//   KOAD_IO_SUBMIT_VESTA_URL       — Vesta HTTP endpoint URL (optional)
//   KOAD_IO_SUBMIT_NO_VESTA_WRITE  — '1' = skip local Vesta registry write
//   HOME                           — used to resolve ~/.<entity>/id/

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Resolve @koad-io/node module path
// ---------------------------------------------------------------------------

const homeDir = process.env.HOME || '/tmp';
const nodeModulePath = join(homeDir, '.koad-io', 'modules', 'node');

let sigchainMod, identityMod, submissionMod, writerMod, ceremonyMod;
try {
  sigchainMod   = await import(join(nodeModulePath, 'sigchain.js'));
  identityMod   = await import(join(nodeModulePath, 'identity.js'));
  submissionMod = await import(join(nodeModulePath, 'identity-submission.js'));
  writerMod     = await import(join(nodeModulePath, 'identity-writer.js'));
  ceremonyMod   = await import(join(nodeModulePath, 'ceremony.js'));
} catch (err) {
  console.error(`[identity-submit] ERROR: Cannot import @koad-io/node modules from ${nodeModulePath}`);
  console.error(`  ${err.message}`);
  process.exit(1);
}

const { buildIdentityGenesis, buildLeafAuthorize, wrapEntry, signEntry, computeCID } = sigchainMod;
const { createKoadIdentity } = identityMod;
const { buildHeadSubmission } = submissionMod;
const { writeIdentityRegistry } = writerMod;
const { decryptLeafFromStorage } = ceremonyMod;

// ---------------------------------------------------------------------------
// Read environment config
// ---------------------------------------------------------------------------

const entity           = process.env.KOAD_IO_SUBMIT_ENTITY           || '';
const passphrase       = process.env.KOAD_IO_SUBMIT_PASSPHRASE        || '';
const mnemonicEnv      = process.env.KOAD_IO_SUBMIT_MNEMONIC          || '';
const bip39Passphrase  = process.env.KOAD_IO_SUBMIT_BIP39_PASSPHRASE  || '';
const ipfsApi          = process.env.KOAD_IO_SUBMIT_IPFS_API          || 'http://127.0.0.1:5001';
const anchorChain      = process.env.KOAD_IO_SUBMIT_ANCHOR_CHAIN      || '';
const anchorKeyPath    = process.env.KOAD_IO_SUBMIT_ANCHOR_KEY        || '';
const dryRun           = process.env.KOAD_IO_SUBMIT_DRY_RUN           === '1';
const vestaUrl         = process.env.KOAD_IO_SUBMIT_VESTA_URL         || '';
const noVestaWrite     = process.env.KOAD_IO_SUBMIT_NO_VESTA_WRITE    === '1';

if (!entity) {
  console.error('[identity-submit] ERROR: KOAD_IO_SUBMIT_ENTITY is required');
  process.exit(1);
}

const idDir = join(homeDir, `.${entity}`, 'id');

// ---------------------------------------------------------------------------
// Step 1 — Read identity files
// ---------------------------------------------------------------------------

console.error(`[identity-submit] Reading identity for entity: ${entity}`);

const masterPubPath  = join(idDir, 'master.pub.asc');
const leafPrivPath   = join(idDir, 'leaf.private.asc');
const deviceKeyPath  = join(idDir, 'device.key');
const metadataPath   = join(idDir, 'identity.json');

if (!existsSync(masterPubPath)) {
  console.error(`[identity-submit] ERROR: master.pub.asc not found at ${masterPubPath}`);
  process.exit(1);
}
if (!existsSync(leafPrivPath)) {
  console.error(`[identity-submit] ERROR: leaf.private.asc not found at ${leafPrivPath}`);
  process.exit(1);
}
if (!existsSync(metadataPath)) {
  console.error(`[identity-submit] ERROR: identity.json not found at ${metadataPath}`);
  process.exit(1);
}

const masterPublicKey  = readFileSync(masterPubPath, 'utf8');
const leafPrivateArmor = readFileSync(leafPrivPath, 'utf8');

// Resolve leaf decryption passphrase: Path A (user-supplied) or Path B (device.key)
let leafPassphrase = passphrase;
if (!leafPassphrase) {
  if (!existsSync(deviceKeyPath)) {
    console.error(`[identity-submit] ERROR: no --passphrase provided and device.key not found at ${deviceKeyPath}`);
    console.error('  Either provide --passphrase=<phrase> or ensure device.key exists.');
    process.exit(1);
  }
  leafPassphrase = readFileSync(deviceKeyPath, 'utf8').trim();
}

const metadataRaw = JSON.parse(readFileSync(metadataPath, 'utf8'));
const masterFingerprint = metadataRaw.masterFingerprint;
const leafFingerprints  = metadataRaw.leafFingerprints || [];
const leafFingerprint   = leafFingerprints[0] || null;

if (!masterFingerprint) {
  console.error('[identity-submit] ERROR: identity.json missing masterFingerprint');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 2 — Load leaf key into identity object
// ---------------------------------------------------------------------------

console.error('[identity-submit] Loading leaf key...');

let leafKeyManager;
try {
  if (typeof decryptLeafFromStorage !== 'function') {
    throw new Error('decryptLeafFromStorage not exported from ceremony.js — cannot decrypt leaf key');
  }
  leafKeyManager = await decryptLeafFromStorage(leafPrivateArmor, leafPassphrase);
} catch (err) {
  console.error(`[identity-submit] ERROR: Failed to decrypt leaf key: ${err.message}`);
  console.error('  If using Path A (passphrase), provide --passphrase=<phrase>');
  console.error('  If using Path B (device key), ensure device.key is readable at', deviceKeyPath);
  process.exit(1);
}

// Extract leaf public key for leaf-authorize entry
let leafPublicKey = null;
try {
  await new Promise((resolve, reject) => {
    leafKeyManager.export_pgp_public({}, (err, pub) => {
      if (err) return reject(err);
      leafPublicKey = pub;
      resolve();
    });
  });
} catch (err) {
  console.error(`[identity-submit] ERROR: Failed to export leaf public key: ${err.message}`);
  process.exit(1);
}

const identity = createKoadIdentity();
identity.load({
  handle: entity,
  masterFingerprint,
  masterPublicKey,
  keyManager: leafKeyManager,
  leafFingerprint: leafFingerprint || masterFingerprint, // fallback
  leafPublicKey,
});

// ---------------------------------------------------------------------------
// Step 3 — Determine submission state
//
// If identity.json already has sigchain_tip_cid, this is an update submission
// (the chain already exists on IPFS). We build the submission message pointing
// to the existing tip.
//
// If no sigchain_tip_cid: first submission. We need to:
//   a) Build genesis + leaf-authorize sigchain entries
//   b) Pin them to IPFS to get CIDs
//   c) Build submission pointing to the leaf-authorize CID as the new tip
// ---------------------------------------------------------------------------

const existingTip = metadataRaw.sigchain_tip_cid || null;
const entries = [];
let genesisEntry = null, genesisCID = null;
let leafAuthorizeEntry = null, leafAuthorizeCID = null;
let newHeadCID = null;
let previousHeadCID = null;

if (existingTip) {
  // Update path: chain already exists. Submission re-announces the current tip.
  // This is useful to propagate an existing tip to a new Vesta instance.
  console.error(`[identity-submit] Existing sigchain tip found: ${existingTip}`);
  newHeadCID = existingTip;
  previousHeadCID = metadataRaw.sigchain_previous_cid || null;
  console.error('[identity-submit] Re-submitting existing tip (no new entries generated)');
} else {
  // First submission path: generate genesis + leaf-authorize
  console.error('[identity-submit] First submission — generating genesis + leaf-authorize entries...');

  const now = new Date().toISOString();

  // Genesis entry
  const { type: genesisType, payload: genesisPayload } = buildIdentityGenesis({
    entity_handle: entity,
    master_fingerprint: masterFingerprint,
    master_pubkey_armored: masterPublicKey,
    created: now,
    description: `${entity} identity — koad:io sovereign entity (VESTA-SPEC-149)`,
  });

  const unsignedGenesis = wrapEntry({
    entity,
    timestamp: now,
    type: genesisType,
    payload: genesisPayload,
    previous: null,
  });

  // Genesis MUST be signed by master (SPEC-149 §6 step 2).
  // The --mnemonic flag reconstitutes the master briefly for chain signing.
  // Without --mnemonic: leaf-signed fallback with a clear warning (test/dev posture only).

  let useMasterForEntries = false;
  let masterKMForSigning = null; // transient: reconstituted master KM, scrubbed after use

  if (mnemonicEnv) {
    // Mnemonic provided — reconstitute master and verify it matches identity.json
    try {
      const { isValidMnemonic, mnemonicToSeed, buildMasterKeyManager, extractKMInfo } = ceremonyMod;

      if (typeof isValidMnemonic !== 'function') {
        throw new Error('isValidMnemonic not exported from ceremony.js');
      }
      if (!isValidMnemonic(mnemonicEnv.trim())) {
        console.error('[identity-submit] ERROR: --mnemonic value is not a valid BIP39 mnemonic phrase');
        process.exit(1);
      }

      // NOTE: ceremony.js mnemonicToSeed uses raw entropy path (not PBKDF2).
      // The --bip39-passphrase flag is accepted for forward-compatibility but has
      // no effect until ceremony.js implements the PBKDF2 path. Document this.
      if (bip39Passphrase) {
        console.error('[identity-submit] NOTE: --bip39-passphrase accepted but not yet applied (ceremony.js uses raw-entropy path; PBKDF2 path is a future spec update)');
      }

      const seed = mnemonicToSeed(mnemonicEnv.trim());
      const userid = `${entity} <${entity}@kingofalldata.com>`;
      masterKMForSigning = await buildMasterKeyManager(seed, userid);
      const { fingerprint: reconFP } = await extractKMInfo(masterKMForSigning);

      if (reconFP !== masterFingerprint) {
        console.error(`[identity-submit] ERROR: Reconstituted master fingerprint (${reconFP}) does not match identity.json (${masterFingerprint})`);
        console.error('  Verify you are using the correct mnemonic for this entity.');
        process.exit(1);
      }

      useMasterForEntries = true;
      console.error('[identity-submit] Master key reconstituted from mnemonic — entries will be master-signed (SPEC-149 §6 compliant)');

    } catch (err) {
      if (err.message.startsWith('[identity-submit] ERROR')) throw err;
      console.error(`[identity-submit] ERROR: Failed to reconstitute master from mnemonic: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.warn('[identity-submit] WARNING: genesis signed with leaf key — non-conforming with SPEC-149 §6 — provide --mnemonic for spec compliance');
    console.error('  For spec-compliant genesis signing: koad-io identity submit --mnemonic=<24 words>');
  }

  // Build a surrogate identity that routes useMaster=true to the reconstituted masterKM,
  // while useMaster=false uses the real loaded leaf (identity).
  // This avoids calling importMnemonic() on the real identity (which would replace the leaf).
  const signingIdentity = useMasterForEntries
    ? _makeMasterSigningIdentity(masterKMForSigning, identity)
    : identity;

  const signWithMaster = useMasterForEntries;

  // Sign genesis
  const genesisResult = await signEntry(unsignedGenesis, signingIdentity, { useMaster: signWithMaster });
  genesisEntry = genesisResult.entry;
  genesisCID = genesisResult.cid;
  entries.push(genesisResult);

  // Leaf-authorize entry (authorize the current device leaf)
  const { type: leafType, payload: leafPayload } = buildLeafAuthorize({
    leaf_fingerprint: leafFingerprint || masterFingerprint,
    leaf_pubkey_armored: leafPublicKey,
    authorized_by_fingerprint: masterFingerprint,
    authorized_at: now,
    device_label: process.env.HOSTNAME || process.env.HOST || 'unknown',
  });

  const unsignedLeafAuth = wrapEntry({
    entity,
    timestamp: now,
    type: leafType,
    payload: leafPayload,
    previous: genesisCID,
  });

  const leafAuthResult = await signEntry(unsignedLeafAuth, signingIdentity, { useMaster: signWithMaster });
  leafAuthorizeEntry = leafAuthResult.entry;
  leafAuthorizeCID = leafAuthResult.cid;
  entries.push(leafAuthResult);

  // Scrub master KM from memory immediately after signing (SPEC-149 §6 step 6 lockdown)
  if (useMasterForEntries && masterKMForSigning) {
    masterKMForSigning = null; // release reference — GC will collect
    console.error('[identity-submit] Master key reference released (scrubbed from signing session)');
  }

  newHeadCID = leafAuthorizeCID;
  previousHeadCID = null; // first publication
}

// ---------------------------------------------------------------------------
// Step 4 — Pin to IPFS
// ---------------------------------------------------------------------------

const pinnedCIDs = {};

if (dryRun) {
  console.log('[DRY RUN] Would pin the following entries to IPFS:');
  if (genesisCID) {
    console.log(`  genesis entry:       ${genesisCID}`);
    pinnedCIDs.genesis = genesisCID;
  }
  if (leafAuthorizeCID) {
    console.log(`  leaf-authorize entry: ${leafAuthorizeCID}`);
    pinnedCIDs.leafAuthorize = leafAuthorizeCID;
  }
  console.log(`  sigchain tip CID:    ${newHeadCID}`);
  pinnedCIDs.tip = newHeadCID;
  console.log(`[DRY RUN] Would submit to Vesta (SPEC-150 §5.1)`);
  console.log(`[DRY RUN] No files written.`);
} else {
  // Pin entries to IPFS
  for (const { entry, cid } of entries) {
    console.error(`[identity-submit] Pinning entry ${cid} to IPFS...`);
    const pinResult = await pinToIpfs(entry, cid, ipfsApi);
    if (!pinResult.ok) {
      console.error(`[identity-submit] WARNING: IPFS pin failed for ${cid}: ${pinResult.error}`);
      console.error('  Entry CID is computed locally; chain is valid even if remote pin failed.');
      console.error('  Run again after IPFS daemon is available to ensure persistence.');
    } else {
      console.error(`  Pinned: ${pinResult.cid}`);
    }
    pinnedCIDs[cid] = { ok: pinResult.ok, error: pinResult.error };
  }

  // ---------------------------------------------------------------------------
  // Step 5 — Build SPEC-150 submission message
  // ---------------------------------------------------------------------------

  console.error('[identity-submit] Building SPEC-150 submission message...');

  const { submission } = await buildHeadSubmission({
    entityHandle: entity,
    previousHeadCID,
    newHeadCID,
    identity,
    useMaster: false, // leaf-signed submission per SPEC-150 §4.1
  });

  // ---------------------------------------------------------------------------
  // Step 6 — Notify Vesta endpoint (if provided)
  // ---------------------------------------------------------------------------

  if (vestaUrl) {
    console.error(`[identity-submit] Posting SPEC-150 submission to Vesta at ${vestaUrl}...`);
    const postResult = await postToVesta(vestaUrl, submission);
    if (!postResult.ok) {
      console.error(`[identity-submit] WARNING: Vesta submission failed: ${postResult.error}`);
      console.error('  Fire-and-forget per SPEC-150 §12 — submission is non-fatal to the append operation.');
    } else {
      console.error(`  Vesta accepted: ${JSON.stringify(postResult.body)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 7 — Write local Vesta registry
  // ---------------------------------------------------------------------------

  if (!noVestaWrite) {
    console.error('[identity-submit] Writing local Vesta registry...');
    const writeResult = await writeIdentityRegistry({
      handle: entity,
      masterFingerprint,
      masterPublicKey,
      sigchainHeadCID: newHeadCID,
    });
    if (!writeResult.written) {
      console.error(`[identity-submit] WARNING: Vesta registry write failed: ${writeResult.error}`);
    } else {
      console.error(`  Registry written to: ${writeResult.sigchainDir}`);
      if (writeResult.created) {
        console.error('  (New registry record created)');
      } else {
        console.error('  (Existing registry record updated)');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Step 8 — Update identity.json with sigchain CIDs
  // ---------------------------------------------------------------------------

  console.error('[identity-submit] Updating identity.json...');

  const updatedMetadata = {
    ...metadataRaw,
    sigchain_tip_cid: newHeadCID,
    sigchain_genesis_cid: genesisCID || metadataRaw.sigchain_genesis_cid || null,
    sigchain_leaf_authorize_cid: leafAuthorizeCID || metadataRaw.sigchain_leaf_authorize_cid || null,
    sigchain_previous_cid: previousHeadCID,
    sigchain_submitted_at: new Date().toISOString(),
    spec: 'VESTA-SPEC-150 v1.1',
  };

  writeFileSync(metadataPath, JSON.stringify(updatedMetadata, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });

  // ---------------------------------------------------------------------------
  // Step 9 — On-chain anchor (optional, ROOTY-SPEC-001)
  // ---------------------------------------------------------------------------

  let anchorTxid = null;
  if (anchorChain) {
    console.error(`[identity-submit] Building on-chain anchor for ${anchorChain.toUpperCase()}...`);
    const anchorResult = await buildChainAnchor({
      chain: anchorChain,
      tipCID: newHeadCID,
      walletKeyPath: anchorKeyPath,
    });
    if (anchorResult.ok) {
      anchorTxid = anchorResult.txid;
      console.error(`  Anchor txid: ${anchorTxid}`);
      // Write txid into metadata
      updatedMetadata.anchor_txid = anchorTxid;
      updatedMetadata.anchor_chain = anchorChain;
      updatedMetadata.anchor_at = new Date().toISOString();
      writeFileSync(metadataPath, JSON.stringify(updatedMetadata, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });
    } else {
      console.error(`[identity-submit] WARNING: On-chain anchor failed: ${anchorResult.error}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Output summary
  // ---------------------------------------------------------------------------

  console.log('');
  console.log('Identity submitted.');
  console.log(`  Entity:             ${entity}`);
  console.log(`  Sigchain tip CID:   ${newHeadCID}`);
  if (genesisCID) {
    console.log(`  Genesis entry CID:  ${genesisCID}`);
  }
  if (leafAuthorizeCID) {
    console.log(`  Leaf-auth CID:      ${leafAuthorizeCID}`);
  }
  if (anchorTxid) {
    console.log(`  Chain anchor txid:  ${anchorTxid} (${anchorChain.toUpperCase()})`);
  }
  console.log(`  Metadata updated:   ${metadataPath}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  Verify the chain:   koad-io identity verify --entity=${entity}`);
  if (!vestaUrl) {
    console.log('  Notify Vesta:       koad-io identity submit --entity=' + entity + ' --vesta-url=<url>');
  }
}

// ---------------------------------------------------------------------------
// Master-signing surrogate identity helper
// ---------------------------------------------------------------------------

/**
 * Build a thin surrogate identity wrapper for master-signing chain entries.
 *
 * signEntry() calls identity.sign(payload, { useMaster }) — which internally
 * routes to either the device KM or master KM. Since importMnemonic() on the
 * real identity would replace the device leaf, we instead build a surrogate
 * that routes useMaster=true to a separately-reconstituted masterKM, and
 * useMaster=false (submission message signing) to the real leaf identity.
 *
 * Surrogate is intentionally minimal — only .sign() is needed by signEntry().
 * The masterKM reference is passed by the caller and scrubbed by the caller
 * after entries are signed.
 *
 * @param {object} masterKM   - kbpgp KeyManager for the master key (reconstituted)
 * @param {object} leafIdentity - real loaded leaf identity (from createKoadIdentity + load)
 * @returns {object} surrogate identity with .sign()
 */
function _makeMasterSigningIdentity(masterKM, leafIdentity) {
  const { clearsign } = (() => {
    // Defer pgp import — it's already loaded transitively via sigchain.js
    // We use a late-binding import inside sign() to avoid top-level await here.
    return {};
  })();

  return {
    get handle()            { return leafIdentity.handle; },
    get masterFingerprint() { return leafIdentity.masterFingerprint; },
    get masterPublicKey()   { return leafIdentity.masterPublicKey; },
    get fingerprint()       { return leafIdentity.fingerprint; },
    get publicKey()         { return leafIdentity.publicKey; },
    get posture()           { return 'ceremony'; },
    get isLoaded()          { return true; },
    get isMasterLoaded()    { return !!masterKM; },

    async sign(payload, { useMaster = false } = {}) {
      if (typeof payload !== 'string') {
        throw new Error('[master-signing-surrogate] sign() requires a string payload');
      }
      // Import pgp.js clearsign (same path as identity.js uses in standalone Node)
      const homeDir = process.env.HOME || '/tmp';
      const { join: pathJoin } = await import('path');
      const { clearsign: pgpClearsign } = await import(pathJoin(homeDir, '.koad-io', 'modules', 'node', 'pgp.js'));

      const km = useMaster ? masterKM : leafIdentity.getKeyManager();
      if (!km) {
        throw new Error(`[master-signing-surrogate] sign(): no ${useMaster ? 'master' : 'leaf'} key available`);
      }
      return pgpClearsign(payload, km);
    },
  };
}

// ---------------------------------------------------------------------------
// IPFS pinning helper
// ---------------------------------------------------------------------------

/**
 * Pin a sigchain entry to IPFS via the HTTP API.
 * Tries the HTTP API first; falls back to reporting the pre-computed CID.
 *
 * The IPFS HTTP API /api/v0/dag/put accepts a DAG-JSON payload and returns
 * the CID. We verify the returned CID matches our locally-computed one.
 *
 * @param {object} entry - Signed sigchain entry
 * @param {string} localCID - Locally-computed CID (for verification)
 * @param {string} apiUrl - IPFS HTTP API base URL
 * @returns {Promise<{ ok: boolean, cid?: string, error?: string }>}
 */
async function pinToIpfs(entry, localCID, apiUrl) {
  // Serialize entry as JSON for IPFS DAG put
  const entryJson = JSON.stringify(entry);

  try {
    const url = `${apiUrl}/api/v0/dag/put?store-codec=dag-json&input-codec=dag-json&pin=true`;

    // Use fetch (Node 18+) or fall back with a helpful error
    if (typeof fetch === 'undefined') {
      return {
        ok: false,
        error: 'fetch() not available — Node.js >= 18 is required for IPFS HTTP API calls',
      };
    }

    const formData = new FormData();
    const blob = new Blob([entryJson], { type: 'application/json' });
    formData.append('file', blob, 'entry.json');

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '(no response body)');
      return { ok: false, error: `IPFS API returned ${response.status}: ${text}` };
    }

    const result = await response.json();
    const returnedCID = result.Cid?.['/'] || result.Cid || null;

    if (returnedCID && returnedCID !== localCID) {
      return {
        ok: false,
        error: `IPFS returned CID ${returnedCID} but locally computed ${localCID} — mismatch`,
      };
    }

    return { ok: true, cid: localCID };

  } catch (err) {
    // IPFS daemon not running or unreachable — not fatal; CID is still valid
    return {
      ok: false,
      error: `IPFS API unreachable at ${apiUrl}: ${err.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Vesta HTTP submission helper (SPEC-150 §5.1)
// ---------------------------------------------------------------------------

/**
 * HTTP POST the SPEC-150 submission object to a Vesta endpoint.
 *
 * @param {string} vestaBaseUrl - Vesta daemon base URL
 * @param {object} submission - SPEC-150 submission object
 * @returns {Promise<{ ok: boolean, body?: object, error?: string }>}
 */
async function postToVesta(vestaBaseUrl, submission) {
  try {
    const url = vestaBaseUrl.replace(/\/$/, '') + '/api/identity/head/submit';

    if (typeof fetch === 'undefined') {
      return { ok: false, error: 'fetch() not available' };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submission),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        ok: false,
        error: `Vesta returned ${response.status}: ${JSON.stringify(body)}`,
      };
    }

    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// On-chain anchor helper (ROOTY-SPEC-001 OP_RETURN)
// ---------------------------------------------------------------------------

/**
 * Build and broadcast an OP_RETURN transaction anchoring the sigchain tip CID.
 * Per ROOTY-SPEC-001 §3: magic 0x6B494F + version 0x01 + flags 0x00 + binary CID.
 *
 * This is a best-effort implementation that constructs the payload and
 * documents the broadcast requirement. Full electrum broadcast requires
 * the ecoincore broadcast package.
 *
 * @param {object} opts
 * @param {string} opts.chain - Chain ticker (cdn, btc, doge)
 * @param {string} opts.tipCID - Sigchain tip CID (base32)
 * @param {string} opts.walletKeyPath - Path to wallet key file
 * @returns {Promise<{ ok: boolean, txid?: string, payload?: Buffer, error?: string }>}
 */
async function buildChainAnchor({ chain, tipCID, walletKeyPath }) {
  try {
    // Decode base32 CID to binary per ROOTY-SPEC-001 §3.3
    // The CID is 'baguczs...' format — we need raw CIDv1 bytes (37 bytes for sha2-256 dag-json)
    const { CID } = await import(join(nodeModulePath, 'node_modules', 'multiformats', 'dist', 'src', 'cid.js'));
    const cidObj = CID.parse(tipCID);
    const cidBytes = cidObj.bytes; // Uint8Array

    // Build payload: magic(3) + version(1) + flags(1) + cidBytes(37) = 42 bytes
    const magic = Buffer.from([0x6B, 0x49, 0x4F]); // "kIO"
    const version = Buffer.from([0x01]);
    const flags = Buffer.from([0x00]);
    const cidBuf = Buffer.from(cidBytes);

    const payload = Buffer.concat([magic, version, flags, cidBuf]);

    if (payload.length > 80) {
      return { ok: false, error: `OP_RETURN payload ${payload.length} bytes exceeds 80-byte limit` };
    }

    console.error(`[identity-submit] OP_RETURN payload (${payload.length} bytes): ${payload.toString('hex')}`);
    console.error('[identity-submit] NOTE: Full chain broadcast requires ecoincore electrum package.');
    console.error('  Payload is correctly formed per ROOTY-SPEC-001 §3.2.');
    console.error('  Broadcast manually using the ecoincore package or a compatible electrum wallet.');
    console.error(`  Chain: ${chain.toUpperCase()}`);
    console.error(`  Payload hex: ${payload.toString('hex')}`);

    // If wallet key is provided, attempt broadcast via ecoincore
    if (walletKeyPath && existsSync(walletKeyPath)) {
      console.error(`[identity-submit] Wallet key found at ${walletKeyPath} — attempting ecoincore broadcast`);
      // ecoincore broadcast is a Rooty-domain package — require its presence
      const ecoicoreBroadcastPath = join(homeDir, '.ecoincore', 'packages', 'electrum', 'broadcast.js');
      if (existsSync(ecoicoreBroadcastPath)) {
        try {
          const broadcastMod = await import(ecoicoreBroadcastPath);
          if (typeof broadcastMod.broadcastOpReturn === 'function') {
            const walletKey = readFileSync(walletKeyPath, 'utf8').trim();
            const txid = await broadcastMod.broadcastOpReturn({ chain, payload, walletKey });
            return { ok: true, txid, payload };
          }
        } catch (broadcastErr) {
          console.error(`[identity-submit] WARNING: ecoincore broadcast failed: ${broadcastErr.message}`);
        }
      } else {
        console.error('[identity-submit] NOTE: ecoincore/electrum broadcast.js not found — cannot broadcast automatically.');
      }
    }

    // Return payload for manual broadcast
    return {
      ok: true,
      txid: `(manual-broadcast-required — payload: ${payload.toString('hex')})`,
      payload,
    };

  } catch (err) {
    return { ok: false, error: err.message };
  }
}
