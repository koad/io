#!/usr/bin/env node
// identity-init-bridge.mjs — BIP39 master+leaf key derivation bridge
//
// Called by command.sh. Reads config from environment variables.
// Generates or imports a BIP39 master key and a device leaf key per VESTA-SPEC-149.
// Writes keys to ~/.<entity>/id/ per §8.1.6 storage conventions.
//
// Environment:
//   KOAD_IO_IDENTITY_ENTITY      — entity handle (required)
//   KOAD_IO_IDENTITY_MNEMONIC    — import existing mnemonic (optional; generate fresh if absent)
//   KOAD_IO_IDENTITY_LEAF_COUNT  — number of leaf keys to pre-generate (default: 1)
//   KOAD_IO_IDENTITY_PASSPHRASE  — BIP39 passphrase for leaf encryption (optional)
//   KOAD_IO_IDENTITY_DRY_RUN     — '1' = generate but do not write to disk
//   KOAD_IO_IDENTITY_NO_CONFIRM  — '1' = skip interactive mnemonic quiz (for --no-confirm flag)
//   HOME                         — used to resolve ~/.<entity>/id/
//
// VESTA-SPEC-149 §6 lockdown ceremony steps implemented here:
//   Step 1  — Generate entropy / import mnemonic → master KM + leaf KM
//   Step 2  — Extract fingerprints and public keys
//   Step 3  — Print mnemonic to stdout
//   Step 4  — Interactive confirmation (unless --no-confirm)
//   Step 5  — Word quiz (unless --no-confirm)
//   Step 6  — Write leaf.private.asc + device.key + master.pub.asc

import { createInterface } from 'readline';
import { mkdirSync, writeFileSync, chmodSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Resolve @koad-io/node module path
// ---------------------------------------------------------------------------

// The node module lives at ~/.koad-io/modules/node/
const homeDir = process.env.HOME || '/tmp';
const nodeModulePath = join(homeDir, '.koad-io', 'modules', 'node');

let ceremony;
try {
  // Dynamic import from the absolute path on disk
  const mod = await import(join(nodeModulePath, 'ceremony.js'));
  ceremony = mod;
} catch (err) {
  console.error(`[identity-init] ERROR: Cannot import @koad-io/node/ceremony from ${nodeModulePath}`);
  console.error(`  ${err.message}`);
  console.error('  Ensure ~/.koad-io/modules/node/ exists and dependencies are installed.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Read environment config
// ---------------------------------------------------------------------------

const entity          = process.env.KOAD_IO_IDENTITY_ENTITY        || '';
const importMnemonic  = process.env.KOAD_IO_IDENTITY_MNEMONIC       || '';
const leafCount       = parseInt(process.env.KOAD_IO_IDENTITY_LEAF_COUNT || '1', 10);
const passphrase      = process.env.KOAD_IO_IDENTITY_PASSPHRASE     || '';
const dryRun          = process.env.KOAD_IO_IDENTITY_DRY_RUN        === '1';
const noConfirm       = process.env.KOAD_IO_IDENTITY_NO_CONFIRM     === '1';

if (!entity) {
  console.error('[identity-init] ERROR: KOAD_IO_IDENTITY_ENTITY is required');
  process.exit(1);
}

const idDir = join(homeDir, `.${entity}`, 'id');

// ---------------------------------------------------------------------------
// Step 1 — Generate entropy or import mnemonic
// ---------------------------------------------------------------------------

let mnemonic;
let seed;

if (importMnemonic) {
  // Validate and import existing mnemonic
  if (!ceremony.isValidMnemonic(importMnemonic)) {
    console.error('[identity-init] ERROR: provided --mnemonic is not a valid BIP39 mnemonic');
    process.exit(1);
  }
  mnemonic = importMnemonic;
  // mnemonicToSeed returns the raw entropy bytes (32 bytes) — same as generation path
  seed = ceremony.mnemonicToSeed(mnemonic);
  console.error(`[identity-init] Importing existing mnemonic for ${entity}`);
} else {
  // Generate fresh entropy
  const entropy = ceremony.generateEntropySync();
  mnemonic = ceremony.entropyToMnemonicString(entropy);
  // Derive seed from mnemonic (round-trips through entropy — deterministic)
  seed = ceremony.mnemonicToSeed(mnemonic);
  console.error(`[identity-init] Generated fresh BIP39 identity for ${entity}`);
}

// ---------------------------------------------------------------------------
// Build master key manager
// ---------------------------------------------------------------------------

const masterUserid = `${entity} <${entity}@kingofalldata.com>`;
const masterKM = await ceremony.buildMasterKeyManager(seed, masterUserid);
const { fingerprint: masterFingerprint, publicKey: masterPublicKey } =
  await ceremony.extractKMInfo(masterKM);

// ---------------------------------------------------------------------------
// Build leaf key managers (one per leaf-count)
// ---------------------------------------------------------------------------

const leafUserid = `${entity} (device leaf) <${entity}@kingofalldata.com>`;
const leaves = [];
for (let i = 0; i < Math.max(1, leafCount); i++) {
  const leafKM = await ceremony.buildLeafKeyManager(leafUserid);
  const deviceKey = ceremony.generateDeviceKey();
  // Use passphrase if provided, otherwise device key (SPEC-149 §8.1 Path B default)
  const leafPassphrase = passphrase || deviceKey;
  const leafArmored = await ceremony.encryptLeafForStorage(leafKM, leafPassphrase);
  const { fingerprint: leafFingerprint, publicKey: leafPublicKey } =
    await ceremony.extractKMInfo(leafKM);
  leaves.push({ leafArmored, leafFingerprint, leafPublicKey, deviceKey, leafPassphrase });
}

// ---------------------------------------------------------------------------
// Step 3 — Show the mnemonic
// ---------------------------------------------------------------------------

const words = mnemonic.split(' ');
const wordLines = [];
for (let i = 0; i < words.length; i += 6) {
  const chunk = words.slice(i, i + 6).map((w, j) => `${String(i + j + 1).padStart(2)}: ${w}`);
  wordLines.push(chunk.join('   '));
}

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════╗');
console.log('║                  MASTER IDENTITY MNEMONIC                       ║');
console.log('╠══════════════════════════════════════════════════════════════════╣');
console.log('║  Write these down. Every word. In order. On paper.              ║');
console.log('║  Do NOT type them anywhere else. Do NOT take a screenshot.      ║');
console.log('║  This is the ONLY recoverable copy. Guard it accordingly.       ║');
console.log('╠══════════════════════════════════════════════════════════════════╣');
for (const line of wordLines) {
  console.log(`║  ${line.padEnd(66)}║`);
}
console.log('╚══════════════════════════════════════════════════════════════════╝');
console.log('');
console.log(`  Entity:            ${entity}`);
console.log(`  Master fingerprint: ${masterFingerprint}`);
if (leaves.length === 1) {
  console.log(`  Leaf fingerprint:   ${leaves[0].leafFingerprint}`);
} else {
  leaves.forEach((l, i) => console.log(`  Leaf ${i + 1} fingerprint: ${l.leafFingerprint}`));
}
console.log('');

// ---------------------------------------------------------------------------
// Dry-run exit
// ---------------------------------------------------------------------------

if (dryRun) {
  console.log('[DRY RUN] Keys generated. No files written.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Steps 4 and 5 — Confirmation and quiz (skipped with --no-confirm)
// ---------------------------------------------------------------------------

if (!noConfirm) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });

  const ask = (q) => new Promise((res) => rl.question(q, res));

  // Step 4 — confirmation
  const confirm = await ask(
    '\nHave you written down all 24 words in order? [yes/no]: '
  );
  if (confirm.trim().toLowerCase() !== 'yes') {
    console.error('[identity-init] Aborted. Write down the mnemonic first, then run again.');
    rl.close();
    process.exit(1);
  }

  // Step 5 — quiz (3 random positions)
  const positions = [];
  while (positions.length < 3) {
    const pos = Math.floor(Math.random() * 24);
    if (!positions.includes(pos)) positions.push(pos);
  }
  positions.sort((a, b) => a - b);

  console.error('\nMnemonic quiz — type the correct word for each position:');
  let quizPassed = false;
  while (!quizPassed) {
    let allCorrect = true;
    for (const pos of positions) {
      const answer = await ask(`  Word ${pos + 1}: `);
      if (answer.trim().toLowerCase() !== words[pos].toLowerCase()) {
        console.error(`  ✗ Incorrect. Word ${pos + 1} should be "${words[pos]}". Try again.`);
        allCorrect = false;
        break;
      }
    }
    if (allCorrect) {
      quizPassed = true;
      console.error('\n  ✓ Quiz passed.');
    } else {
      console.error('\n  Quiz failed. Please check your written copy and try again.\n');
      // Re-randomize positions on failure (SPEC-149 §6 step 5)
      positions.length = 0;
      while (positions.length < 3) {
        const pos = Math.floor(Math.random() * 24);
        if (!positions.includes(pos)) positions.push(pos);
      }
      positions.sort((a, b) => a - b);
    }
  }

  rl.close();
}

// ---------------------------------------------------------------------------
// Step 6 — Lockdown: write keys to disk
// ---------------------------------------------------------------------------

// Ensure id/ directory exists
mkdirSync(idDir, { recursive: true, mode: 0o700 });

// Write master public key (not sensitive)
const masterPubPath = join(idDir, 'master.pub.asc');
writeFileSync(masterPubPath, masterPublicKey, { encoding: 'utf8', mode: 0o644 });

// Write leaf(s)
for (let i = 0; i < leaves.length; i++) {
  const { leafArmored, deviceKey } = leaves[i];
  const suffix = leaves.length === 1 ? '' : `.${i + 1}`;

  const leafPath       = join(idDir, `leaf.private.asc${suffix}`);
  const deviceKeyPath  = join(idDir, `device.key${suffix}`);

  writeFileSync(leafPath, leafArmored, { encoding: 'utf8', mode: 0o600 });
  writeFileSync(deviceKeyPath, deviceKey, { encoding: 'utf8', mode: 0o600 });
}

// Write a metadata summary (non-sensitive)
const metadata = {
  entity,
  masterFingerprint,
  leafFingerprints: leaves.map((l) => l.leafFingerprint),
  created: new Date().toISOString(),
  spec: 'VESTA-SPEC-149 v1.5',
};
const metaPath = join(idDir, 'identity.json');
writeFileSync(metaPath, JSON.stringify(metadata, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });

// Write .gitignore to protect private material
const gitignorePath = join(idDir, '.gitignore');
if (!existsSync(gitignorePath)) {
  writeFileSync(gitignorePath, [
    '# Private key material — never commit',
    '*.private.asc',
    'device.key*',
    '# Keep public keys and metadata',
    '!master.pub.asc',
    '!identity.json',
    '!.gitignore',
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o644 });
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n✓ Identity initialized.');
console.log(`  Entity:            ${entity}`);
console.log(`  Master pubkey:     ${idDir}/master.pub.asc`);
console.log(`  Master fingerprint: ${masterFingerprint}`);
if (leaves.length === 1) {
  console.log(`  Leaf private key:  ${idDir}/leaf.private.asc`);
  console.log(`  Device key:        ${idDir}/device.key`);
  console.log(`  Leaf fingerprint:  ${leaves[0].leafFingerprint}`);
} else {
  leaves.forEach((l, i) => {
    console.log(`  Leaf ${i + 1}:            ${idDir}/leaf.private.asc.${i + 1}`);
    console.log(`  Device key ${i + 1}:       ${idDir}/device.key.${i + 1}`);
    console.log(`  Leaf ${i + 1} fingerprint: ${l.leafFingerprint}`);
  });
}
console.log(`  Metadata:          ${idDir}/identity.json`);
console.log('');
console.log('Next steps:');
console.log('  1. Store your 24-word mnemonic paper backup in a secure location.');
console.log('  2. Authorize this device leaf from the primary device:');
console.log(`       koad-io identity device-key add \\`);
console.log(`           --entity ${entity} \\`);
console.log(`           --device-id $HOSTNAME \\`);
console.log(`           --leaf-fingerprint ${leaves[0].leafFingerprint}`);
console.log('');
