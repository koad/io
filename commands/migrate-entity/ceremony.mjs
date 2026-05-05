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
//   verify-mnemonic --mnemonic "word1 ... word24" --userid "handle @ domain" --expected-fingerprint "<fpr>"
//     Recovers master from mnemonic, verifies fingerprint matches.
//     Outputs: { valid: true, masterFingerprint } or { valid: false, error: "..." }
//
//   sign-entity-entries
//     Signs koad.entity.genesis + koad.entity.leaf-authorize entries per SPEC-175 §4.
//     Uses sovereign master (from mnemonic) to sign both entries.
//     Reads existing sovereign sigchain head from disk to chain entries correctly.
//     Outputs: { genesisEntry, genesisCid, leafEntry, leafCid, newHeadCid }
//     Required args:
//       --mnemonic "<24 words>"           sovereign recovery phrase
//       --userid "<handle> @ <domain>"    sovereign userid (for master reconstruction)
//       --master-fingerprint "<40hex>"    sovereign master fingerprint (for verification)
//       --entity-handle "<name>"          entity being migrated
//       --entity-fingerprint "<40hex>"    fingerprint of entity.public.asc
//       --entity-public-armor "<armor>"   armored entity public key
//       --leaf-fingerprint "<40hex>"      fingerprint of devices/<host>/leaf.public.asc
//       --host "<hostname>"               machine hostname
//       --sigchain-head "<cid>"|""        current sovereign sigchain head CID (empty if none)
//
// Ref: VESTA-SPEC-175 §6.2 — entity migration steps 2–4
// Ref: VESTA-SPEC-175 §4 — sigchain entry types koad.entity.genesis + koad.entity.leaf-authorize
// Ref: VESTA-SPEC-111 §3.2b — PGP via kbpgp signing envelope

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// commands/migrate-entity/ → commands/ → .koad-io/
const KOAD_IO_ROOT = path.resolve(__dirname, '..', '..');
const CEREMONY_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'ceremony.js');
const SIGCHAIN_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'sigchain.js');

const {
  buildLeafKeyManager,
  encryptLeafForStorage,
  extractKMInfo,
  generateDeviceKey,
  mnemonicToSeed,
  buildMasterKeyManager,
  isValidMnemonic,
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
// Command: verify-mnemonic
// ---------------------------------------------------------------------------
// Recovers sovereign master from mnemonic, verifies against expected fingerprint.
// Used by command.sh to confirm the operator entered the correct mnemonic
// before proceeding with the migration.

async function cmdVerifyMnemonic(args) {
  const mnemonic = args.mnemonic;
  const userid = args.userid;
  const expectedFingerprint = args['expected-fingerprint'];

  if (!mnemonic) die('--mnemonic is required for verify-mnemonic');
  if (!userid) die('--userid is required for verify-mnemonic');
  if (!expectedFingerprint) die('--expected-fingerprint is required for verify-mnemonic');

  if (!isValidMnemonic(mnemonic)) {
    out({ valid: false, error: 'not a valid BIP39 mnemonic' });
    return;
  }

  const seed = mnemonicToSeed(mnemonic);
  const masterKM = await buildMasterKeyManager(seed, userid);
  const { fingerprint: masterFingerprint } = await extractKMInfo(masterKM);

  if (masterFingerprint === expectedFingerprint) {
    out({ valid: true, masterFingerprint });
  } else {
    out({
      valid: false,
      error: `fingerprint mismatch — derived ${masterFingerprint}, expected ${expectedFingerprint}`,
      derivedFingerprint: masterFingerprint,
      expectedFingerprint,
    });
  }
}

// ---------------------------------------------------------------------------
// Command: sign-entity-entries
// ---------------------------------------------------------------------------
// Builds and signs koad.entity.genesis + koad.entity.leaf-authorize sigchain entries
// per VESTA-SPEC-175 §4. Signed by sovereign master (from mnemonic).
//
// The sovereign's sigchain entries are chained — previous CID links each entry
// to its predecessor. If the sovereign has no existing sigchain (fresh init), the
// genesis entry links to the provided --sigchain-head (which may be empty for
// a fresh sovereign with no prior entries in its own identity chain).
//
// Entity entries are added to the SOVEREIGN's sigchain (not the entity's own chain).
// Per SPEC-175 §4: "Sigchain location: The sovereign's sigchain."
//
// Signing: sovereign master key (§4.1 — genesis) and then sovereign device leaf
// OR master (§4.2 — leaf-authorize). We use master for both since master is available.

async function cmdSignEntityEntries(args) {
  const mnemonic = args.mnemonic;
  const userid = args.userid;
  const masterFingerprint = args['master-fingerprint'];
  const entityHandle = args['entity-handle'];
  const entityFingerprint = args['entity-fingerprint'];
  // entity-public-armor comes through as multi-line; allow reading from env if too long for argv
  const entityPublicArmor = args['entity-public-armor'];
  const leafFingerprint = args['leaf-fingerprint'];
  const host = args.host;
  const sigchainHead = args['sigchain-head'] || null;
  // --skip-genesis: secondary device adoption — entity already exists, only sign leaf-authorize
  const skipGenesis = args['skip-genesis'] === true || args['skip-genesis'] === 'true';

  if (!mnemonic) die('--mnemonic is required for sign-entity-entries');
  if (!userid) die('--userid is required for sign-entity-entries');
  if (!masterFingerprint) die('--master-fingerprint is required for sign-entity-entries');
  if (!entityHandle) die('--entity-handle is required for sign-entity-entries');
  if (!skipGenesis && !entityFingerprint) die('--entity-fingerprint is required for sign-entity-entries (use --skip-genesis for secondary device)');
  if (!leafFingerprint) die('--leaf-fingerprint is required for sign-entity-entries');
  if (!host) die('--host is required for sign-entity-entries');

  if (!isValidMnemonic(mnemonic)) {
    die('Mnemonic is not a valid BIP39 mnemonic');
  }

  // 1. Reconstruct sovereign master from mnemonic
  const seed = mnemonicToSeed(mnemonic);
  const masterKM = await buildMasterKeyManager(seed, userid);
  const { fingerprint: derivedMasterFpr } = await extractKMInfo(masterKM);

  if (derivedMasterFpr !== masterFingerprint) {
    die(`Master fingerprint mismatch — derived ${derivedMasterFpr}, expected ${masterFingerprint}`);
  }

  // 2. Build a minimal identity-like object that signEntry() can call .sign() on.
  //    signEntry() calls identity.sign(preImageStr, { useMaster }) which we must implement.
  //    Since we have the master KM directly, we wire it here.
  const { clearsign } = await import(path.join(KOAD_IO_ROOT, 'modules', 'node', 'pgp.js'));

  const sovereignIdentity = {
    sign: async (payload, { useMaster = false } = {}) => {
      // For entity entries, signing with master is authoritative (SPEC-175 §4.1/§4.2)
      // We use master for both genesis and leaf-authorize entries since master is
      // loaded during migration (the operator just entered the mnemonic).
      return clearsign(payload, masterKM);
    },
  };

  const now = new Date().toISOString();

  let genesisEntry = null;
  let genesisCid = null;
  let previousForLeaf = sigchainHead || null;

  if (!skipGenesis) {
    // 3a. Build koad.entity.genesis entry
    //     previous = sigchainHead (current sovereign chain tip, or null if sovereign has no chain)
    const genesisPayload = buildEntityGenesis({
      entity_handle: entityHandle,
      entity_key_fingerprint: entityFingerprint,
      sovereign_key_fingerprint: masterFingerprint,
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

    const signed = await signEntry(genesisUnsigned, sovereignIdentity, { useMaster: true });
    genesisEntry = signed.entry;
    genesisCid = signed.cid;
    previousForLeaf = genesisCid;
  }

  // 3b. Build koad.entity.leaf-authorize entry
  //     previous = genesisCid (if genesis was signed) or sigchainHead (secondary device)
  const leafPayload = buildEntityLeafAuthorize({
    entity_handle: entityHandle,
    leaf_fingerprint: leafFingerprint,
    host,
    authorized_at: now,
    authorized_by: masterFingerprint,
  });

  const leafUnsigned = wrapEntry({
    entity: 'koad',  // sovereign's handle
    timestamp: now,
    type: leafPayload.type,
    payload: leafPayload.payload,
    previous: previousForLeaf,
  });

  const { entry: leafEntry, cid: leafCid } = await signEntry(leafUnsigned, sovereignIdentity, { useMaster: true });

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
  case 'verify-mnemonic':
    await cmdVerifyMnemonic(args);
    break;
  case 'sign-entity-entries':
    await cmdSignEntityEntries(args);
    break;
  default:
    die(`unknown command: ${command || '(none)'}. Valid commands: generate-entity, verify-mnemonic, sign-entity-entries`);
}
