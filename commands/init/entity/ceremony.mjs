#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ceremony.mjs — entity migration key ceremony for koad-io migrate-entity
//
// Called by command.sh to perform entity key generation via @koad-io/node.
// Outputs JSON on stdout. All sensitive material stays in-process; never writes to disk.
//
// Commands:
//   generate-entity --userid "<handle> @ <domain>"
//     Generates a fresh Ed25519/EDDSA PGP keypair for the entity.
//     Outputs: entityPublicArmor, entityFingerprint, leafPublicArmor, leafPrivateArmor,
//              leafFingerprint, deviceKey
//
//   get-leaf-fingerprint --leaf-public-armor-file <path>
//     Reads the fingerprint of an armored PUBLIC key (a device leaf).
//     Outputs: { fingerprint } or { fingerprint: null, error: "..." }
//
//   verify-leaf --sovereign-leaf-encrypted-path <path> --sovereign-device-key-path <path>
//     Decrypts the sovereign's device leaf and verifies it is readable.
//     Outputs: { valid: true, leafFingerprint } or { valid: false, error: "..." }
//
//   sign-entity-entries
//     Signs koad.entity.genesis | koad.entity.key-succession + koad.entity.leaf-authorize
//     (+ optional koad.entity.leaf-revoke) per SPEC-175 §4 and SPEC-240 §5.2/§14.
//     Uses sovereign's active device leaf (SPEC-149: master is paper-only after genesis).
//     Outputs: { keyEvent, keyEventEntry, keyEventCid, leafEntry, leafCid,
//                revokeEntry, revokeCid, newHeadCid }
//     Required args:
//       --sovereign-leaf-encrypted-path <path>   path to leaf.private.asc
//       --sovereign-device-key-path <path>       path to device.key (passphrase file)
//       --sovereign-leaf-fingerprint "<40hex>"   sovereign device leaf fingerprint
//       --entity-handle "<name>"                 entity being migrated
//       --entity-fingerprint "<40hex>"           fingerprint of entity.public.asc
//       --entity-public-armor "<armor>"          armored entity public key
//       --leaf-fingerprint "<40hex>"             fingerprint of devices/<host>/leaf.public.asc
//       --host "<hostname>"                      machine hostname
//       --sigchain-head "<cid>"|""               current sovereign sigchain head CID (empty if none)
//       --key-event genesis|succession|none      which key event to file (default genesis)
//       --skip-genesis                           legacy alias for --key-event none
//       --old-entity-fingerprint "<40hex>"       REQUIRED when --key-event succession
//       --reason <reason>                        OPTIONAL succession reason (§5.2 closed set)
//       --revoke-leaf-fingerprint "<40hex>"      OPTIONAL: file leaf-revoke after leaf-authorize
//       --revoke-host "<hostname>"               OPTIONAL (defaults to --host)
//       --revoke-reason <reason>                 OPTIONAL
//
//   resolve-entity
//     Resolves the effective entity key and the leaf's epoch over the sovereign
//     chain (SPEC-240 §7/§9.4). Read-only.
//     Required args:
//       --handle "<name>"                        entity handle to resolve
//       --sigchain-dir <path>                    sovereign sigchain/ dir (entries/ + head.cid)
//       --leaf-fingerprint "<40hex>"             OPTIONAL: resolve this leaf's epoch
//     Outputs: { effective_fingerprint, established_by, history, anomalies,
//                keyEventCount, head, chainLength, leafEpoch }
//
// Ref: VESTA-SPEC-175 §6.2 — entity migration steps 2–4
// Ref: VESTA-SPEC-175 §4 — sigchain entry types koad.entity.genesis + koad.entity.leaf-authorize
// Ref: VESTA-SPEC-149 — master/leaf split; sovereign device leaf signs routine acts
// Ref: VESTA-SPEC-111 §3.2b — PGP via kbpgp signing envelope

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync, readdirSync, existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// commands/migrate-entity/ → commands/ → .koad-io/
const KOAD_IO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CEREMONY_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'ceremony.js');
const SIGCHAIN_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'sigchain.js');

const {
  buildLeafKeyManager,
  encryptLeafForStorage,
  decryptLeafFromStorage,
  extractKMInfo,
  generateDeviceKey,
} = await import(CEREMONY_PATH);

const {
  buildEntityGenesis,
  buildEntityKeySuccession,
  buildEntityLeafAuthorize,
  buildEntityLeafRevoke,
  resolveEntityKey,
  resolveLeafEpoch,
  wrapEntry,
  signEntry,
} = await import(SIGCHAIN_PATH);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg) {
  process.stderr.write('[ceremony] ERROR: ' + msg + '\n');
  process.exit(1);
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Command: generate-entity
// ---------------------------------------------------------------------------
// Per SPEC-175 §3.3: the entity does NOT have a master private key.
// The entity keypair is a PGP public key that the sovereign certifies.
// We generate it as a standalone leaf-type keypair — it plays the role of
// the entity's public identity. No mnemonic derivation; this is intentional.
//
// A second leaf keypair is generated for this device (the operational signing key).

async function cmdGenerateEntity(args) {
  const userid = args.userid;
  if (!userid) die('--userid is required for generate-entity');

  // 1. Generate entity keypair — this is the entity's sovereign-level public identity.
  //    No private key will be written to disk for this keypair; only the public armor
  //    is committed. The entity doesn't hold its own master private key.
  const entityKM = await buildLeafKeyManager(userid);
  const { fingerprint: entityFingerprint, publicKey: entityPublicArmor } = await extractKMInfo(entityKM);

  // 2. Generate device leaf keypair — the operational signing key for this machine.
  const leafKM = await buildLeafKeyManager(userid + ' (device)');
  const { fingerprint: leafFingerprint, publicKey: leafPublicArmor } = await extractKMInfo(leafKM);

  // 3. Generate device key (passphrase for encrypting the device leaf at rest)
  const deviceKey = generateDeviceKey();

  // 4. Encrypt device leaf private key using device key as passphrase
  const leafPrivateArmor = await encryptLeafForStorage(leafKM, deviceKey);

  out({
    entityFingerprint,
    entityPublicArmor,
    leafFingerprint,
    leafPublicArmor,
    leafPrivateArmor,
    deviceKey,
  });
}

// ---------------------------------------------------------------------------
// Command: get-leaf-fingerprint
// ---------------------------------------------------------------------------
// Reads the fingerprint of an armored PUBLIC key file (id/devices/<host>/
// leaf.public.asc). Called by command.sh to learn which leaf is being replaced,
// which is what makes the §13.3 / W-6 leaf-revoke possible: without it the
// revoked fingerprint is the empty string and the revoke is silently skipped.
//
// NOTE: command.sh has called this since the state-6 backfill existed, but it
// was never implemented here — the call was wrapped in `2>/dev/null || true`,
// so it degraded to an empty fingerprint instead of failing loudly.

async function cmdGetLeafFingerprint(args) {
  const file = args['leaf-public-armor-file'];
  if (!file) die('--leaf-public-armor-file is required for get-leaf-fingerprint');

  let armor;
  try {
    armor = readFileSync(file, 'utf8');
  } catch (err) {
    out({ fingerprint: null, error: `cannot read ${file}: ${err.message}` });
    return;
  }

  // kbpgp lives in modules/node/node_modules — resolve from there, not from
  // this command directory.
  const modulesRequire = createRequire(path.join(KOAD_IO_ROOT, 'modules', 'node', 'index.js'));
  const kbpgp = modulesRequire('kbpgp');
  try {
    const km = await new Promise((resolve, reject) => {
      kbpgp.KeyManager.import_from_armored_pgp({ armored: armor }, (err, imported) => {
        if (err) return reject(err);
        if (!imported) return reject(new Error('kbpgp returned no KeyManager'));
        resolve(imported);
      });
    });
    const fingerprint = (km.get_pgp_fingerprint_str() || '').toUpperCase();
    if (!fingerprint) {
      out({ fingerprint: null, error: 'key parsed but carries no pgp fingerprint' });
      return;
    }
    out({ fingerprint });
  } catch (err) {
    out({ fingerprint: null, error: `cannot parse armored key: ${err.message}` });
  }
}

// ---------------------------------------------------------------------------
// Command: verify-leaf
// ---------------------------------------------------------------------------
// Decrypts the sovereign's device leaf and verifies it is readable.
// Used by command.sh to confirm the device leaf is present and accessible
// before proceeding with the migration. No mnemonic required.

async function cmdVerifyLeaf(args) {
  const leafPath = args['sovereign-leaf-encrypted-path'];
  const deviceKeyPath = args['sovereign-device-key-path'];

  if (!leafPath) die('--sovereign-leaf-encrypted-path is required for verify-leaf');
  if (!deviceKeyPath) die('--sovereign-device-key-path is required for verify-leaf');

  let armoredEncrypted, passphrase;
  try {
    armoredEncrypted = readFileSync(leafPath, 'utf8');
  } catch (err) {
    out({ valid: false, error: `cannot read leaf file: ${err.message}` });
    return;
  }

  try {
    passphrase = readFileSync(deviceKeyPath, 'utf8').trim();
  } catch (err) {
    out({ valid: false, error: `cannot read device key file: ${err.message}` });
    return;
  }

  try {
    const km = await decryptLeafFromStorage(armoredEncrypted, passphrase);
    const { fingerprint: leafFingerprint } = await extractKMInfo(km);
    out({ valid: true, leafFingerprint });
  } catch (err) {
    out({ valid: false, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Chain loader — linkage order only (SPEC-240 §7 R-1)
// ---------------------------------------------------------------------------
// Walks `previous` from head.cid back to the root and reverses. Order is NEVER
// derived from `timestamp`, mtime, filename, or directory iteration: timestamp
// sits inside the signed pre-image and is attacker-chosen; linkage is not.
// A chain that cannot be walked from its head resolves as EMPTY — the caller
// then reports `unverifiable` rather than guessing an effective key.

function loadChainFromDir(sigchainDir) {
  const entriesDir = path.join(sigchainDir, 'entries');
  const headFile = path.join(sigchainDir, 'head.cid');

  let head = null;
  try {
    head = readFileSync(headFile, 'utf8').trim() || null;
  } catch {
    head = null;
  }

  if (!existsSync(entriesDir)) return { chain: [], head: null };

  const byCid = new Map();
  let files = [];
  try {
    files = readdirSync(entriesDir);
  } catch {
    return { chain: [], head: null };
  }
  for (const name of files) {
    if (!name.endsWith('.json')) continue;
    try {
      const entry = JSON.parse(readFileSync(path.join(entriesDir, name), 'utf8'));
      byCid.set(name.replace(/\.json$/, ''), entry);
    } catch {
      // An unreadable entry is not a resolvable link; skip it.
    }
  }

  if (!head || !byCid.has(head)) return { chain: [], head: null };

  const chain = [];
  const seen = new Set();
  let cur = head;
  while (cur && byCid.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const entry = byCid.get(cur);
    chain.push({ entry, cid: cur });
    cur = entry.previous;
  }
  chain.reverse();
  return { chain, head };
}

// ---------------------------------------------------------------------------
// Command: resolve-entity
// ---------------------------------------------------------------------------

async function cmdResolveEntity(args) {
  const handle = args.handle;
  const sigchainDir = args['sigchain-dir'];
  const leafFingerprint = args['leaf-fingerprint'] || null;

  if (!handle) die('--handle is required for resolve-entity');
  if (!sigchainDir) die('--sigchain-dir is required for resolve-entity');

  const { chain, head } = loadChainFromDir(sigchainDir);
  const resolution = resolveEntityKey(handle, chain);
  const leafEpoch = leafFingerprint
    ? resolveLeafEpoch(handle, leafFingerprint, chain)
    : null;

  out({
    ...resolution,
    keyEventCount: resolution.history.length,
    head,
    chainLength: chain.length,
    leafEpoch,
  });
}

// ---------------------------------------------------------------------------
// Command: sign-entity-entries
// ---------------------------------------------------------------------------
// Builds and signs koad.entity.genesis + koad.entity.leaf-authorize sigchain entries
// per VESTA-SPEC-175 §4. Signed by the sovereign's active device leaf.
//
// Per SPEC-149: the master key is paper-only after genesis. Entity gestation and
// migration are routine sovereign acts, signed by the sovereign's device leaf.
// The authorized_by field in each entry records the sovereign's leaf fingerprint
// so verifiers can trace authority through the leaf-authorize entry that established it.
//
// The sovereign's sigchain entries are chained — previous CID links each entry
// to its predecessor.
//
// Entity entries are added to the SOVEREIGN's sigchain (not the entity's own chain).
// Per SPEC-175 §4: "Sigchain location: The sovereign's sigchain."

async function cmdSignEntityEntries(args) {
  const leafPath = args['sovereign-leaf-encrypted-path'];
  const deviceKeyPath = args['sovereign-device-key-path'];
  const sovereignLeafFingerprint = args['sovereign-leaf-fingerprint'];
  const entityHandle = args['entity-handle'];
  const entityFingerprint = args['entity-fingerprint'];
  // entity-public-armor comes through as multi-line; allow reading from env if too long for argv
  const entityPublicArmor = args['entity-public-armor'];
  const leafFingerprint = args['leaf-fingerprint'];
  const host = args.host;
  const sigchainHead = args['sigchain-head'] || null;
  // --key-event picks the key event; --skip-genesis is the legacy alias for none
  // (secondary device adoption — entity already exists, only sign leaf-authorize).
  let keyEvent = args['key-event'];
  if (args['skip-genesis'] === true || args['skip-genesis'] === 'true') keyEvent = 'none';
  if (!keyEvent) keyEvent = 'genesis';
  if (!['genesis', 'succession', 'none'].includes(keyEvent)) {
    die(`--key-event must be one of genesis|succession|none (got: ${keyEvent})`);
  }
  const oldEntityFingerprint = args['old-entity-fingerprint'];
  const successionReason = args.reason;
  const revokeLeafFingerprint = args['revoke-leaf-fingerprint'];
  const revokeHost = args['revoke-host'] || host;
  const revokeReason = args['revoke-reason'];

  if (!leafPath) die('--sovereign-leaf-encrypted-path is required for sign-entity-entries');
  if (!deviceKeyPath) die('--sovereign-device-key-path is required for sign-entity-entries');
  if (!sovereignLeafFingerprint) die('--sovereign-leaf-fingerprint is required for sign-entity-entries');
  if (!entityHandle) die('--entity-handle is required for sign-entity-entries');
  if (keyEvent !== 'none' && !entityFingerprint) die('--entity-fingerprint is required for sign-entity-entries (use --key-event none for secondary device)');
  if (keyEvent === 'succession' && !oldEntityFingerprint) die('--old-entity-fingerprint is required when --key-event succession');
  if (keyEvent === 'succession' && !entityPublicArmor) die('--entity-public-armor is required when --key-event succession (the chain must be self-contained)');
  if (!leafFingerprint) die('--leaf-fingerprint is required for sign-entity-entries');
  if (!host) die('--host is required for sign-entity-entries');

  // 1. Read and decrypt the sovereign's device leaf from disk
  let armoredEncrypted, passphrase;
  try {
    armoredEncrypted = readFileSync(leafPath, 'utf8');
  } catch (err) {
    die(`Cannot read sovereign leaf file at ${leafPath}: ${err.message}`);
  }
  try {
    passphrase = readFileSync(deviceKeyPath, 'utf8').trim();
  } catch (err) {
    die(`Cannot read device key file at ${deviceKeyPath}: ${err.message}`);
  }

  const sovereignLeafKM = await decryptLeafFromStorage(armoredEncrypted, passphrase);

  // 2. Build a minimal identity-like object that signEntry() can call .sign() on.
  //    Uses the sovereign's device leaf KM for all signing (SPEC-149: leaf signs routine acts).
  const { clearsign } = await import(path.join(KOAD_IO_ROOT, 'modules', 'node', 'pgp.js'));

  const sovereignIdentity = {
    sign: async (payload, _opts = {}) => {
      // Per SPEC-149: sovereign device leaf signs routine sovereign acts.
      // The authorized_by field in each entry records sovereignLeafFingerprint
      // so verifiers can trace authority through the sigchain.
      return clearsign(payload, sovereignLeafKM);
    },
  };

  const now = new Date().toISOString();

  let keyEventEntry = null;
  let keyEventCid = null;
  let keyEventType = 'none';
  let previousForLeaf = sigchainHead || null;

  if (keyEvent === 'genesis') {
    // 3a. Build koad.entity.genesis entry
    //     sovereign_key_fingerprint = sovereign leaf fingerprint (the actual signer)
    //     previous = sigchainHead (current sovereign chain tip, or null if sovereign has no chain)
    const genesisPayload = buildEntityGenesis({
      entity_handle: entityHandle,
      entity_key_fingerprint: entityFingerprint,
      sovereign_key_fingerprint: sovereignLeafFingerprint,
      gestated_at: now,
      gestation_host: host,
    });

    const genesisUnsigned = wrapEntry({
      entity: 'koad',  // sovereign's handle — these entries live in the sovereign's chain
      timestamp: now,
      type: genesisPayload.type,
      payload: genesisPayload.payload,
      previous: sigchainHead || null,
    });

    const signed = await signEntry(genesisUnsigned, sovereignIdentity);
    keyEventEntry = signed.entry;
    keyEventCid = signed.cid;
    keyEventType = 'genesis';
    previousForLeaf = keyEventCid;
  } else if (keyEvent === 'succession') {
    // 3a'. Build koad.entity.key-succession entry (SPEC-240 §5.2).
    //      A second genesis is what the deployed code filed on every rotation;
    //      it asks the chain to say the entity was born twice. This names the
    //      actual event instead: the handle continues, the key changed.
    const successionPayload = buildEntityKeySuccession({
      entity_handle: entityHandle,
      old_entity_key_fingerprint: oldEntityFingerprint,
      new_entity_key_fingerprint: entityFingerprint,
      new_entity_pubkey_armored: entityPublicArmor,
      succeeded_at: now,
      authorized_by: sovereignLeafFingerprint,
      reason: successionReason,
    });

    const successionUnsigned = wrapEntry({
      entity: 'koad',
      timestamp: now,
      type: successionPayload.type,
      payload: successionPayload.payload,
      previous: sigchainHead || null,
    });

    const signed = await signEntry(successionUnsigned, sovereignIdentity);
    keyEventEntry = signed.entry;
    keyEventCid = signed.cid;
    keyEventType = 'succession';
    previousForLeaf = keyEventCid;
  }

  // 3b. Build koad.entity.leaf-authorize entry
  //     authorized_by = sovereign leaf fingerprint (the actual signer)
  //     previous = key event CID (if filed) or sigchainHead (secondary device)
  // W-6: a leaf must never be authorized against a key the chain does not yet name.
  const leafPayload = buildEntityLeafAuthorize({
    entity_handle: entityHandle,
    leaf_fingerprint: leafFingerprint,
    host,
    authorized_at: now,
    authorized_by: sovereignLeafFingerprint,
  });

  const leafUnsigned = wrapEntry({
    entity: 'koad',  // sovereign's handle
    timestamp: now,
    type: leafPayload.type,
    payload: leafPayload.payload,
    previous: previousForLeaf,
  });

  const { entry: leafEntry, cid: leafCid } = await signEntry(leafUnsigned, sovereignIdentity);

  // 3c. Optional koad.entity.leaf-revoke for the replaced leaf (W-6 order:
  //     succession → leaf-authorize → leaf-revoke → head).
  let revokeEntry = null;
  let revokeCid = null;
  let lastCid = leafCid;

  if (revokeLeafFingerprint) {
    const revokePayload = buildEntityLeafRevoke({
      entity_handle: entityHandle,
      leaf_fingerprint: revokeLeafFingerprint,
      host: revokeHost,
      revoked_at: now,
      revoked_by: sovereignLeafFingerprint,
      reason: revokeReason,
    });

    const revokeUnsigned = wrapEntry({
      entity: 'koad',
      timestamp: now,
      type: revokePayload.type,
      payload: revokePayload.payload,
      previous: leafCid,
    });

    const signedRevoke = await signEntry(revokeUnsigned, sovereignIdentity);
    revokeEntry = signedRevoke.entry;
    revokeCid = signedRevoke.cid;
    lastCid = revokeCid;
  }

  // 4. Output signed entries as JSON for command.sh to write to disk
  out({
    keyEvent: keyEventType,
    keyEventEntry,        // null when keyEvent=none
    keyEventCid,          // null when keyEvent=none
    // legacy field names, kept for callers that predate the succession vocabulary
    genesisEntry: keyEventType === 'genesis' ? keyEventEntry : null,
    genesisCid: keyEventType === 'genesis' ? keyEventCid : null,
    leafEntry,
    leafCid,
    revokeEntry,          // null unless --revoke-leaf-fingerprint was given
    revokeCid,
    newHeadCid: lastCid,
    previousHeadCid: sigchainHead || null,
    skipGenesis: keyEventType !== 'genesis',
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const [,, command, ...rest] = process.argv;
const args = parseArgs(rest);

switch (command) {
  case 'generate-entity':
    await cmdGenerateEntity(args);
    break;
  case 'verify-leaf':
    await cmdVerifyLeaf(args);
    break;
  case 'get-leaf-fingerprint':
    await cmdGetLeafFingerprint(args);
    break;
  case 'sign-entity-entries':
    await cmdSignEntityEntries(args);
    break;
  case 'resolve-entity':
    await cmdResolveEntity(args);
    break;
  default:
    die(`unknown command: ${command || '(none)'}. Valid commands: generate-entity, verify-leaf, get-leaf-fingerprint, sign-entity-entries, resolve-entity`);
}
