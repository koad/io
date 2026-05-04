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
//   validate --positions "3,11,8" --mnemonic "word1 word2 ... word24"
//   recover  --mnemonic "word1 word2 ... word24" --userid "handle @ domain"
//
// Ref: VESTA-SPEC-149, VESTA-SPEC-174

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

// Dynamic import from resolved absolute path
const {
  generateEntropySync,
  entropyToMnemonicString,
  mnemonicToSeed,
  buildMasterKeyManager,
  buildLeafKeyManager,
  encryptLeafForStorage,
  decryptLeafFromStorage,
  extractKMInfo,
  generateDeviceKey,
  isValidMnemonic,
} = await import(CEREMONY_PATH);

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

  out({
    label,
    mnemonic,
    masterFingerprint,
    masterPublicArmor,
    leafFingerprint,
    leafPublicArmor,
    leafPrivateArmor,
    devicePublicKey: deviceKey,   // stored as device.key.pub (the "public" half for this ceremony)
    devicePrivateKey: deviceKey,  // stored as device.key (the at-rest passphrase)
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

  out({
    label,
    mnemonic,
    masterFingerprint,
    masterPublicArmor,
    leafFingerprint,
    leafPublicArmor,
    leafPrivateArmor,
    devicePublicKey: deviceKey,
    devicePrivateKey: deviceKey,
  });
}

// ---------------------------------------------------------------------------
// Command: export-master-armored
// ---------------------------------------------------------------------------
//
// Re-derives the master key from the mnemonic and exports an unencrypted
// armored PGP private key block to stdout — for piping into `keybase pgp import`.
// The master never touches disk; it lives only in memory for this call's duration.
//
// Usage:
//   node ceremony.mjs export-master-armored --mnemonic "<24 words>" --userid "<userid>"
//
// Note on kbpgp KM statefulness: export_pgp_private({passphrase}) mutates the KM
// in-place. For an unencrypted export we pass no passphrase — so this is safe,
// but we still use a freshly-derived KM (not a reused one) to be explicit.

async function cmdExportMasterArmored(args) {
  const mnemonic = args.mnemonic;
  const userid = args.userid;

  if (!mnemonic) die('--mnemonic is required for export-master-armored');
  if (!userid) die('--userid is required for export-master-armored');

  if (!isValidMnemonic(mnemonic)) {
    die('provided mnemonic is not a valid BIP39 mnemonic');
  }

  // Re-derive master key from mnemonic — same deterministic path as generate/recover
  const seed = mnemonicToSeed(mnemonic);
  const masterKM = await buildMasterKeyManager(seed, userid);
  const { fingerprint } = await extractKMInfo(masterKM);

  // Export unencrypted armored private key — Keybase will handle re-encryption
  // with its own passphrase during `keybase pgp import`
  const armored = await new Promise((resolve, reject) => {
    masterKM.export_pgp_private({}, (err, armor) => {
      if (err) return reject(err);
      resolve(armor);
    });
  });

  if (!armored || !armored.includes('BEGIN PGP PRIVATE KEY BLOCK')) {
    die('export_pgp_private returned unexpected output — expected PGP PRIVATE KEY BLOCK');
  }

  // Write fingerprint as a comment to stderr so it's visible without polluting the pipe
  process.stderr.write('[ceremony] master fingerprint: ' + fingerprint + '\n');

  // Write armored private key to stdout — caller pipes to `keybase pgp import`
  process.stdout.write(armored);
  if (!armored.endsWith('\n')) process.stdout.write('\n');
}

// ---------------------------------------------------------------------------
// Command: export-leaf-armored
// ---------------------------------------------------------------------------
//
// Reads an encrypted leaf private key from disk (leaf.private.asc), decrypts
// it using the device key as passphrase, then exports an unencrypted armored
// PGP private key block to stdout — for piping into `keybase pgp import`.
//
// Usage:
//   node ceremony.mjs export-leaf-armored \
//     --leaf-encrypted-path "/path/to/leaf.private.asc" \
//     --device-key-path "/path/to/device.key"

async function cmdExportLeafArmored(args) {
  const leafEncryptedPath = args['leaf-encrypted-path'];
  const deviceKeyPath = args['device-key-path'];

  if (!leafEncryptedPath) die('--leaf-encrypted-path is required for export-leaf-armored');
  if (!deviceKeyPath) die('--device-key-path is required for export-leaf-armored');

  const fs = await import('fs');

  // Read encrypted leaf armor and device key passphrase from disk
  let armoredEncrypted;
  let passphrase;
  try {
    armoredEncrypted = fs.readFileSync(leafEncryptedPath, 'utf8').trim();
  } catch (e) {
    die('could not read leaf encrypted file: ' + e.message);
  }
  try {
    passphrase = fs.readFileSync(deviceKeyPath, 'utf8').trim();
  } catch (e) {
    die('could not read device key file: ' + e.message);
  }

  if (!armoredEncrypted.includes('BEGIN PGP PRIVATE KEY BLOCK')) {
    die('leaf file does not appear to contain a PGP PRIVATE KEY BLOCK');
  }
  if (!passphrase) {
    die('device key file is empty');
  }

  // Decrypt the leaf key using the device key as passphrase
  const leafKM = await decryptLeafFromStorage(armoredEncrypted, passphrase);
  const { fingerprint } = await extractKMInfo(leafKM);

  // Export unencrypted armored private key — Keybase handles re-encryption
  const armored = await new Promise((resolve, reject) => {
    leafKM.export_pgp_private({}, (err, armor) => {
      if (err) return reject(err);
      resolve(armor);
    });
  });

  if (!armored || !armored.includes('BEGIN PGP PRIVATE KEY BLOCK')) {
    die('export_pgp_private returned unexpected output — expected PGP PRIVATE KEY BLOCK');
  }

  process.stderr.write('[ceremony] leaf fingerprint: ' + fingerprint + '\n');

  process.stdout.write(armored);
  if (!armored.endsWith('\n')) process.stdout.write('\n');
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
  case 'export-master-armored':
    await cmdExportMasterArmored(args);
    break;
  case 'export-leaf-armored':
    await cmdExportLeafArmored(args);
    break;
  default:
    die(`unknown command: ${command || '(none)'}. Valid commands: generate, validate, recover, export-master-armored, export-leaf-armored`);
}
