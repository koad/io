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
//   verify-leaf --sovereign-leaf-encrypted-path <path> --sovereign-device-key-path <path>
//     Decrypts the sovereign's device leaf and verifies it is readable.
//     Outputs: { valid: true, leafFingerprint } or { valid: false, error: "..." }
//
//   sign-entity-entries
//     Signs koad.entity.genesis + koad.entity.leaf-authorize entries per SPEC-175 §4.
//     Uses sovereign's active device leaf (SPEC-149: master is paper-only after genesis).
//     Outputs: { genesisEntry, genesisCid, leafEntry, leafCid, newHeadCid }
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
//       --skip-genesis                           secondary device adoption (only sign leaf-authorize)
//
// Ref: VESTA-SPEC-175 §6.2 — entity migration steps 2–4
// Ref: VESTA-SPEC-175 §4 — sigchain entry types koad.entity.genesis + koad.entity.leaf-authorize
// Ref: VESTA-SPEC-149 — master/leaf split; sovereign device leaf signs routine acts
// Ref: VESTA-SPEC-111 §3.2b — PGP via kbpgp signing envelope

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// commands/migrate-entity/ → commands/ → .koad-io/
const KOAD_IO_ROOT = path.resolve(__dirname, '..', '..');
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
  buildEntityLeafAuthorize,
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
  // --skip-genesis: secondary device adoption — entity already exists, only sign leaf-authorize
  const skipGenesis = args['skip-genesis'] === true || args['skip-genesis'] === 'true';

  if (!leafPath) die('--sovereign-leaf-encrypted-path is required for sign-entity-entries');
  if (!deviceKeyPath) die('--sovereign-device-key-path is required for sign-entity-entries');
  if (!sovereignLeafFingerprint) die('--sovereign-leaf-fingerprint is required for sign-entity-entries');
  if (!entityHandle) die('--entity-handle is required for sign-entity-entries');
  if (!skipGenesis && !entityFingerprint) die('--entity-fingerprint is required for sign-entity-entries (use --skip-genesis for secondary device)');
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

  let genesisEntry = null;
  let genesisCid = null;
  let previousForLeaf = sigchainHead || null;

  if (!skipGenesis) {
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
    genesisEntry = signed.entry;
    genesisCid = signed.cid;
    previousForLeaf = genesisCid;
  }

  // 3b. Build koad.entity.leaf-authorize entry
  //     authorized_by = sovereign leaf fingerprint (the actual signer)
  //     previous = genesisCid (if genesis was signed) or sigchainHead (secondary device)
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

  // 4. Output signed entries as JSON for command.sh to write to disk
  out({
    genesisEntry,     // null when skipGenesis=true
    genesisCid,       // null when skipGenesis=true
    leafEntry,
    leafCid,
    newHeadCid: leafCid,
    previousHeadCid: sigchainHead || null,
    skipGenesis,
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
  case 'sign-entity-entries':
    await cmdSignEntityEntries(args);
    break;
  default:
    die(`unknown command: ${command || '(none)'}. Valid commands: generate-entity, verify-leaf, sign-entity-entries`);
}
