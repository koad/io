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
// Ref: VESTA-SPEC-175 §6.2 — entity migration steps 2–4

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// commands/migrate-entity/ → commands/ → .koad-io/
const KOAD_IO_ROOT = path.resolve(__dirname, '..', '..');
const CEREMONY_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'ceremony.js');

const {
  buildLeafKeyManager,
  encryptLeafForStorage,
  extractKMInfo,
  generateDeviceKey,
  mnemonicToSeed,
  buildMasterKeyManager,
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
  default:
    die(`unknown command: ${command || '(none)'}. Valid commands: generate-entity, verify-mnemonic`);
}
