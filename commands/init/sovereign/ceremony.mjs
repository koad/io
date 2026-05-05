#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// ceremony.mjs — sovereign key ceremony script for koad-io init sovereign
//
// Called by command.sh to perform cryptographic operations via @koad-io/node ceremony.js.
// Outputs JSON on stdout. All sensitive material stays in-process; never writes to disk.
//
// Commands:
//   generate --userid "handle @ domain"
//     Fresh genesis: generates master + leaf + device key.
//     Also signs koad.identity.genesis + koad.identity.leaf-authorize entries (master in memory).
//     Outputs include: genesisEntry, genesisCid, leafAuthorizeEntry, leafAuthorizeCid, newHeadCid.
//
//   validate --positions "3,11,8" --mnemonic "word1 word2 ... word24"
//
//   recover  --mnemonic "word1 word2 ... word24" --userid "handle @ domain"
//     Secondary-device adoption: derives master + fresh leaf + device key from mnemonic.
//     Skips koad.identity.genesis (already filed at genesis).
//     Signs a new koad.identity.leaf-authorize entry for this device's leaf.
//     Outputs include: leafAuthorizeEntry, leafAuthorizeCid, newHeadCid.
//     Caller must pass --sigchain-head <cid> if an existing chain is present.
//
// The Keybase backup is the git repo at keybase://private/<handle>/me — not the
// Keybase PGP keystore. export-master-armored and export-leaf-armored were removed;
// the mnemonic on paper + the Keybase repo are the two canonical recovery paths.
//
// Ref: VESTA-SPEC-149, VESTA-SPEC-174, VESTA-SPEC-111 §5.8

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

// Resolve @koad-io/node from the modules/node directory (two levels up from here:
//   commands/init/sovereign/ → commands/init/ → commands/ → .koad-io/
//   then into modules/node/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KOAD_IO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CEREMONY_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'ceremony.js');
const SIGCHAIN_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'sigchain.js');

// Dynamic import from resolved absolute path
const {
  generateEntropySync,
  entropyToMnemonicString,
  mnemonicToSeed,
  buildMasterKeyManager,
  buildLeafKeyManager,
  encryptLeafForStorage,
  extractKMInfo,
  generateDeviceKey,
  isValidMnemonic,
} = await import(CEREMONY_PATH);

const {
  buildIdentityGenesis,
  buildLeafAuthorize,
  wrapEntry,
  signEntry,
} = await import(SIGCHAIN_PATH);

const { clearsign } = await import(path.join(KOAD_IO_ROOT, 'modules', 'node', 'pgp.js'));

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
// Command: generate
// ---------------------------------------------------------------------------

async function cmdGenerate(args) {
  const userid = args.userid;
  const entityHandle = args['entity-handle'] || userid.split(' ')[0];
  const sigchainHead = args['sigchain-head'] || null;
  const deviceLabel = args['device-label'] || null;
  if (!userid) die('--userid is required for generate');

  // 1. Generate entropy and mnemonic
  const entropy = generateEntropySync();
  const mnemonic = entropyToMnemonicString(entropy);

  // 2. Derive master key from mnemonic (raw-entropy path)
  const seed = mnemonicToSeed(mnemonic);
  const masterKM = await buildMasterKeyManager(seed, userid);
  const { fingerprint: masterFingerprint, publicKey: masterPublicArmor } = await extractKMInfo(masterKM);

  // 3. Generate random leaf key (not derived from mnemonic — per spec)
  const leafKM = await buildLeafKeyManager(userid);
  const { fingerprint: leafFingerprint, publicKey: leafPublicArmor } = await extractKMInfo(leafKM);

  // 4. Generate device key (hex-encoded 32 bytes of entropy)
  const deviceKey = generateDeviceKey();

  // 5. Encrypt leaf private key using device key as passphrase
  const leafPrivateArmor = await encryptLeafForStorage(leafKM, deviceKey);

  const words = mnemonic.split(' ');
  const label = words[0] + ' ' + words[1];

  // 6. Sign identity sigchain entries while master is in memory (SPEC-149 §6 step 2).
  //    koad.identity.genesis: self-attested by master, establishes the chain.
  //    koad.identity.leaf-authorize: master authorizes this device's leaf.
  //    Both are signed NOW — the master private key is never written to disk.
  const masterIdentity = {
    sign: async (payload, _opts = {}) => clearsign(payload, masterKM),
  };

  const now = new Date().toISOString();

  // Build koad.identity.genesis (SPEC-111 §5.8 — previous MUST be null)
  const genesisPayload = buildIdentityGenesis({
    entity_handle: entityHandle,
    master_fingerprint: masterFingerprint,
    master_pubkey_armored: masterPublicArmor,
    created: now,
    description: `${entityHandle} sovereign identity`,
  });
  const genesisUnsigned = wrapEntry({
    entity: entityHandle,
    timestamp: now,
    type: genesisPayload.type,
    payload: genesisPayload.payload,
    previous: null,  // genesis MUST have previous=null (SPEC-111 §5.8)
  });
  const { entry: genesisEntry, cid: genesisCid } = await signEntry(genesisUnsigned, masterIdentity, { useMaster: true });

  // Build koad.identity.leaf-authorize (chained from genesis)
  const leafAuthPayload = buildLeafAuthorize({
    leaf_fingerprint: leafFingerprint,
    leaf_pubkey_armored: leafPublicArmor,
    authorized_by_fingerprint: masterFingerprint,
    authorized_at: now,
    ...(deviceLabel ? { device_label: deviceLabel } : {}),
  });
  const leafAuthUnsigned = wrapEntry({
    entity: entityHandle,
    timestamp: now,
    type: leafAuthPayload.type,
    payload: leafAuthPayload.payload,
    previous: genesisCid,  // chained to genesis
  });
  const { entry: leafAuthorizeEntry, cid: leafAuthorizeCid } = await signEntry(leafAuthUnsigned, masterIdentity, { useMaster: true });

  // Master identity object has served its purpose — let GC claim it.
  // (The masterKM variable goes out of scope at end of this function.)

  out({
    label,
    mnemonic,
    masterFingerprint,
    masterPublicArmor,
    leafFingerprint,
    leafPublicArmor,
    leafPrivateArmor,
    deviceKey,          // at-rest passphrase for encrypting this device's leaf; not a keypair
    // Signed identity sigchain entries (SPEC-111 §5.8)
    genesisEntry,
    genesisCid,
    leafAuthorizeEntry,
    leafAuthorizeCid,
    newHeadCid: leafAuthorizeCid,
  });
}

// ---------------------------------------------------------------------------
// Command: validate
// ---------------------------------------------------------------------------

async function cmdValidate(args) {
  const positionsStr = args.positions;
  const mnemonic = args.mnemonic;

  if (!positionsStr) die('--positions is required for validate (e.g. "3,11,8")');
  if (!mnemonic) die('--mnemonic is required for validate');

  if (!isValidMnemonic(mnemonic)) {
    out({ valid: false, error: 'mnemonic is not a valid BIP39 mnemonic' });
    return;
  }

  const words = mnemonic.split(' ');
  const positions = positionsStr.split(',').map(p => parseInt(p.trim(), 10));

  // Read quiz answers from stdin — one word per position, newline-separated
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  const answers = input.trim().split('\n').map(s => s.trim());

  const errors = [];
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const expected = words[pos - 1];  // positions are 1-indexed
    const given = answers[i] || '';
    if (given.toLowerCase() !== expected.toLowerCase()) {
      errors.push(`word ${pos} is incorrect`);
    }
  }

  if (errors.length === 0) {
    out({ valid: true });
  } else {
    out({ valid: false, error: errors.join('; ') });
  }
}

// ---------------------------------------------------------------------------
// Command: recover
// ---------------------------------------------------------------------------

async function cmdRecover(args) {
  const mnemonic = args.mnemonic;
  const userid = args.userid;
  const entityHandle = args['entity-handle'] || userid.split(' ')[0];
  // sigchain-head: existing chain tip — the new leaf-authorize entry chains from here
  const sigchainHead = args['sigchain-head'] || null;
  const deviceLabel = args['device-label'] || null;

  if (!mnemonic) die('--mnemonic is required for recover');
  if (!userid) die('--userid is required for recover');

  if (!isValidMnemonic(mnemonic)) {
    die('provided mnemonic is not a valid BIP39 mnemonic');
  }

  // 1. Derive master key from provided mnemonic (deterministic)
  const seed = mnemonicToSeed(mnemonic);
  const masterKM = await buildMasterKeyManager(seed, userid);
  const { fingerprint: masterFingerprint, publicKey: masterPublicArmor } = await extractKMInfo(masterKM);

  // 2. Generate fresh leaf key — NOT derived from mnemonic, per spec
  //    Leaf keys are per-install artifacts; the master is the root of trust.
  const leafKM = await buildLeafKeyManager(userid);
  const { fingerprint: leafFingerprint, publicKey: leafPublicArmor } = await extractKMInfo(leafKM);

  // 3. Generate fresh device key (hex-encoded 32 bytes of entropy)
  const deviceKey = generateDeviceKey();

  // 4. Encrypt leaf private key using device key as passphrase
  const leafPrivateArmor = await encryptLeafForStorage(leafKM, deviceKey);

  const words = mnemonic.split(' ');
  const label = words[0] + ' ' + words[1];

  // 5. Sign koad.identity.leaf-authorize while master is in memory (SPEC-149 §6 step 2).
  //    On recovery / secondary-device adoption:
  //    - koad.identity.genesis is already filed (skip it)
  //    - sign ONLY koad.identity.leaf-authorize for this new device's leaf
  //    - chain from sigchain-head if provided (existing tip), otherwise chain from null
  //      (which is only valid if this device is being adopted before any chain exists,
  //       but that case should normally go through generate, not recover)
  const masterIdentity = {
    sign: async (payload, _opts = {}) => clearsign(payload, masterKM),
  };

  const now = new Date().toISOString();

  const leafAuthPayload = buildLeafAuthorize({
    leaf_fingerprint: leafFingerprint,
    leaf_pubkey_armored: leafPublicArmor,
    authorized_by_fingerprint: masterFingerprint,
    authorized_at: now,
    ...(deviceLabel ? { device_label: deviceLabel } : {}),
  });
  const leafAuthUnsigned = wrapEntry({
    entity: entityHandle,
    timestamp: now,
    type: leafAuthPayload.type,
    payload: leafAuthPayload.payload,
    previous: sigchainHead || null,  // chain from existing tip; null if no chain yet
  });
  const { entry: leafAuthorizeEntry, cid: leafAuthorizeCid } = await signEntry(leafAuthUnsigned, masterIdentity, { useMaster: true });

  out({
    label,
    mnemonic,
    masterFingerprint,
    masterPublicArmor,
    leafFingerprint,
    leafPublicArmor,
    leafPrivateArmor,
    deviceKey,          // at-rest passphrase for encrypting this device's leaf; not a keypair
    // Signed identity sigchain entry for this device (SPEC-111 §5.8)
    // Note: no genesisEntry/genesisCid on recover — genesis already exists in the chain
    leafAuthorizeEntry,
    leafAuthorizeCid,
    newHeadCid: leafAuthorizeCid,
    sigchainHead,       // echo back the incoming head so bash side can verify chain linkage
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const [,, command, ...rest] = process.argv;
const args = parseArgs(rest);

switch (command) {
  case 'generate':
    await cmdGenerate(args);
    break;
  case 'validate':
    await cmdValidate(args);
    break;
  case 'recover':
    await cmdRecover(args);
    break;
  default:
    die(`unknown command: ${command || '(none)'}. Valid commands: generate, validate, recover`);
}
