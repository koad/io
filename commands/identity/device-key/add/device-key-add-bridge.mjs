#!/usr/bin/env node
// device-key-add-bridge.mjs — Add a new device key leaf to an existing identity
//
// Called by command.sh. Reads config from environment variables.
//
// Flow:
//   1. Read identity from ~/.<entity>/id/ (master.pub.asc, identity.json)
//   2. Reconstitute signing authority (master via mnemonic, OR load existing leaf key)
//   3. Generate a new independent device keypair
//   4. Build koad.identity.leaf-authorize sigchain entry, sign with authority
//   5. Compute CID for the new tip entry
//   6. Write new device key files to ~/.<entity>/id/devices/<device-name>/
//   7. Update identity.json with new leaf fingerprint + sigchain tip
//   8. Print output: new pubkey, file paths, tip CID
//
// Environment:
//   KOAD_IO_DEVKEY_ENTITY          — entity handle (required)
//   KOAD_IO_DEVKEY_DEVICE_NAME     — device name label (required, e.g. "wonderland-laptop")
//   KOAD_IO_DEVKEY_MNEMONIC        — BIP39 mnemonic phrase (resolved to inline by command.sh)
//   KOAD_IO_DEVKEY_BIP39_PASSPHRASE — BIP39 passphrase (optional)
//   KOAD_IO_DEVKEY_LEAF_KEY        — path to existing authorized leaf private key file
//   KOAD_IO_DEVKEY_LEAF_PASSPHRASE — passphrase for existing leaf key (or reads device.key)
//   KOAD_IO_DEVKEY_DRY_RUN         — '1' = generate but do not write files
//   KOAD_IO_DEVKEY_NO_CONFIRM      — '1' = skip confirmation prompt
//   HOME                           — used to resolve ~/.<entity>/id/

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';

// ---------------------------------------------------------------------------
// Resolve @koad-io/node module path
// ---------------------------------------------------------------------------

const homeDir = process.env.HOME || '/tmp';
const nodeModulePath = join(homeDir, '.koad-io', 'modules', 'node');

let sigchainMod, identityMod, ceremonyMod;
try {
  sigchainMod  = await import(join(nodeModulePath, 'sigchain.js'));
  identityMod  = await import(join(nodeModulePath, 'identity.js'));
  ceremonyMod  = await import(join(nodeModulePath, 'ceremony.js'));
} catch (err) {
  console.error(`[device-key-add] ERROR: Cannot import @koad-io/node modules from ${nodeModulePath}`);
  console.error(`  ${err.message}`);
  process.exit(1);
}

const { buildLeafAuthorize, wrapEntry, signEntry, computeCID } = sigchainMod;
const { createKoadIdentity } = identityMod;
const {
  isValidMnemonic, mnemonicToSeed, buildMasterKeyManager, buildLeafKeyManager,
  extractKMInfo, generateDeviceKey, encryptLeafForStorage, decryptLeafFromStorage,
} = ceremonyMod;

// ---------------------------------------------------------------------------
// Read environment config
// ---------------------------------------------------------------------------

const entity          = process.env.KOAD_IO_DEVKEY_ENTITY           || '';
const deviceName      = process.env.KOAD_IO_DEVKEY_DEVICE_NAME      || '';
const mnemonicEnv     = process.env.KOAD_IO_DEVKEY_MNEMONIC         || '';
const bip39Passphrase = process.env.KOAD_IO_DEVKEY_BIP39_PASSPHRASE || '';
const leafKeyPath     = process.env.KOAD_IO_DEVKEY_LEAF_KEY         || '';
const leafPassphrase  = process.env.KOAD_IO_DEVKEY_LEAF_PASSPHRASE  || '';
const dryRun          = process.env.KOAD_IO_DEVKEY_DRY_RUN          === '1';
const noConfirm       = process.env.KOAD_IO_DEVKEY_NO_CONFIRM       === '1';

if (!entity) {
  console.error('[device-key-add] ERROR: KOAD_IO_DEVKEY_ENTITY is required');
  process.exit(1);
}
if (!deviceName) {
  console.error('[device-key-add] ERROR: KOAD_IO_DEVKEY_DEVICE_NAME is required');
  process.exit(1);
}
if (!mnemonicEnv && !leafKeyPath) {
  console.error('[device-key-add] ERROR: authorization required — set KOAD_IO_DEVKEY_MNEMONIC or KOAD_IO_DEVKEY_LEAF_KEY');
  process.exit(1);
}

const idDir = join(homeDir, `.${entity}`, 'id');

// ---------------------------------------------------------------------------
// Step 1 — Read identity files
// ---------------------------------------------------------------------------

console.error(`[device-key-add] Adding device key for entity: ${entity}`);
console.error(`[device-key-add] Device name: ${deviceName}`);

const masterPubPath = join(idDir, 'master.pub.asc');
const metadataPath  = join(idDir, 'identity.json');

if (!existsSync(masterPubPath)) {
  console.error(`[device-key-add] ERROR: master.pub.asc not found at ${masterPubPath}`);
  process.exit(1);
}
if (!existsSync(metadataPath)) {
  console.error(`[device-key-add] ERROR: identity.json not found at ${metadataPath}`);
  process.exit(1);
}

const masterPublicKey = readFileSync(masterPubPath, 'utf8');
const metadataRaw     = JSON.parse(readFileSync(metadataPath, 'utf8'));

const masterFingerprint = metadataRaw.masterFingerprint;
const existingLeafFPs   = metadataRaw.leafFingerprints || [];
const existingTip       = metadataRaw.sigchain_tip_cid || null;

if (!masterFingerprint) {
  console.error('[device-key-add] ERROR: identity.json missing masterFingerprint');
  process.exit(1);
}

if (!existingTip) {
  console.error('[device-key-add] ERROR: identity has no sigchain_tip_cid in identity.json');
  console.error('  Run "koad-io identity submit" first to publish the genesis chain, then add device keys.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 2 — Reconstitute signing authority
// ---------------------------------------------------------------------------

// signingIdentity: a minimal object with .sign() that routes to either master or leaf KM
let signerAuthority = null; // object with .sign(payload) → clearsign
let signerFingerprint = null; // fingerprint of the signing key (for authorized_by_fingerprint)
let useMasterSigning = false;

if (mnemonicEnv) {
  // Master signing path
  console.error('[device-key-add] Reconstituting master key from mnemonic...');

  if (!isValidMnemonic(mnemonicEnv.trim())) {
    console.error('[device-key-add] ERROR: --mnemonic value is not a valid BIP39 mnemonic phrase');
    process.exit(1);
  }

  if (bip39Passphrase) {
    console.error('[device-key-add] NOTE: --bip39-passphrase accepted but not yet applied (ceremony.js uses raw-entropy path)');
  }

  const seed = mnemonicToSeed(mnemonicEnv.trim());
  const userid = `${entity} <${entity}@kingofalldata.com>`;
  const masterKM = await buildMasterKeyManager(seed, userid);
  const { fingerprint: reconFP } = await extractKMInfo(masterKM);

  if (reconFP !== masterFingerprint) {
    console.error(`[device-key-add] ERROR: Reconstituted master fingerprint (${reconFP}) does not match identity.json (${masterFingerprint})`);
    console.error('  Verify you are using the correct mnemonic for this entity.');
    process.exit(1);
  }

  signerFingerprint = masterFingerprint;
  useMasterSigning  = true;

  // Build a closure-bound signing function from the master KM
  signerAuthority = await _buildKMSigner(masterKM);
  console.error(`[device-key-add] Master key reconstituted — will sign as master (${masterFingerprint})`);

} else {
  // Existing leaf signing path
  console.error(`[device-key-add] Loading existing leaf key from: ${leafKeyPath}`);

  if (!existsSync(leafKeyPath)) {
    console.error(`[device-key-add] ERROR: leaf key file not found at ${leafKeyPath}`);
    process.exit(1);
  }

  const leafArmored = readFileSync(leafKeyPath, 'utf8');

  // Resolve passphrase for the existing leaf: Path A (provided) or Path B (device.key)
  let resolvedLeafPassphrase = leafPassphrase;
  if (!resolvedLeafPassphrase) {
    // Try device.key in same dir as leaf key, or default device.key
    const leafDir = join(leafKeyPath, '..'); // dirname
    const leafDeviceKey = join(leafDir, 'device.key');
    const defaultDeviceKey = join(idDir, 'device.key');
    const deviceKeyFile = existsSync(leafDeviceKey) ? leafDeviceKey : defaultDeviceKey;

    if (!existsSync(deviceKeyFile)) {
      console.error(`[device-key-add] ERROR: no --leaf-passphrase provided and device.key not found`);
      console.error(`  Tried: ${leafDeviceKey} and ${defaultDeviceKey}`);
      process.exit(1);
    }
    resolvedLeafPassphrase = readFileSync(deviceKeyFile, 'utf8').trim();
  }

  const existingLeafKM = await decryptLeafFromStorage(leafArmored, resolvedLeafPassphrase);
  const { fingerprint: leafFP } = await extractKMInfo(existingLeafKM);

  // Verify this leaf is in the known leafFingerprints list
  if (existingLeafFPs.length > 0 && !existingLeafFPs.includes(leafFP)) {
    console.error(`[device-key-add] ERROR: provided leaf key fingerprint (${leafFP}) is not in identity.json leafFingerprints`);
    console.error(`  Known leaf fingerprints: ${existingLeafFPs.join(', ')}`);
    console.error('  Provide an authorized device leaf key.');
    process.exit(1);
  }

  signerFingerprint = leafFP;
  signerAuthority   = await _buildKMSigner(existingLeafKM);
  console.error(`[device-key-add] Existing leaf loaded — will sign as leaf (${leafFP})`);
}

// ---------------------------------------------------------------------------
// Step 3 — Generate new device keypair
// ---------------------------------------------------------------------------

console.error('[device-key-add] Generating new device keypair...');

const newLeafUserid = `${entity} (device: ${deviceName}) <${entity}@kingofalldata.com>`;
const newLeafKM = await buildLeafKeyManager(newLeafUserid);
const { fingerprint: newLeafFP, publicKey: newLeafPub } = await extractKMInfo(newLeafKM);

const newDeviceKey = generateDeviceKey();
const newLeafArmored = await encryptLeafForStorage(newLeafKM, newDeviceKey);

console.error(`[device-key-add] New device key fingerprint: ${newLeafFP}`);

// ---------------------------------------------------------------------------
// Step 4 — Build and sign koad.identity.leaf-authorize entry
// ---------------------------------------------------------------------------

const now = new Date().toISOString();

const { type: leafType, payload: leafPayload } = buildLeafAuthorize({
  leaf_fingerprint: newLeafFP,
  leaf_pubkey_armored: newLeafPub,
  authorized_by_fingerprint: signerFingerprint,
  authorized_at: now,
  device_label: deviceName,
});

const unsignedLeafAuth = wrapEntry({
  entity,
  timestamp: now,
  type: leafType,
  payload: leafPayload,
  previous: existingTip,
});

// Sign using the surrogate signer
const signedEntry = await _signEntryWithSurrogate(unsignedLeafAuth, signerAuthority);
const newTipCID = await computeCID(signedEntry);

console.error(`[device-key-add] Leaf-authorize entry signed. New tip CID: ${newTipCID}`);

// Scrub master material immediately after signing
if (useMasterSigning) {
  signerAuthority = null; // release master KM reference
  console.error('[device-key-add] Master key reference released (scrubbed from session)');
}

// ---------------------------------------------------------------------------
// Step 5 — Dry-run output
// ---------------------------------------------------------------------------

const deviceDir = join(idDir, 'devices', deviceName);
const newLeafPath      = join(deviceDir, 'leaf.private.asc');
const newDeviceKeyPath = join(deviceDir, 'device.key');
const newLeafPubPath   = join(deviceDir, 'leaf.pub.asc');

if (dryRun) {
  console.log('');
  console.log('[DRY RUN] Would write new device key files:');
  console.log(`  Leaf private key:  ${newLeafPath}`);
  console.log(`  Device key:        ${newDeviceKeyPath}`);
  console.log(`  Leaf public key:   ${newLeafPubPath}`);
  console.log('');
  console.log('[DRY RUN] Would update identity.json:');
  console.log(`  New leaf fingerprint: ${newLeafFP}`);
  console.log(`  New sigchain tip CID: ${newTipCID}`);
  console.log('');
  console.log('[DRY RUN] No files written.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Step 6 — Confirmation prompt
// ---------------------------------------------------------------------------

if (!noConfirm) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  console.log('');
  console.log('New device key summary:');
  console.log(`  Entity:           ${entity}`);
  console.log(`  Device name:      ${deviceName}`);
  console.log(`  New leaf fp:      ${newLeafFP}`);
  console.log(`  Authorized by:    ${signerFingerprint} (${useMasterSigning ? 'master' : 'leaf'})`);
  console.log(`  New sigchain tip: ${newTipCID}`);
  console.log('');

  const answer = await ask('Proceed to write device key files? [yes/no]: ');
  rl.close();

  if (answer.trim().toLowerCase() !== 'yes') {
    console.error('[device-key-add] Aborted by user.');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Step 7 — Write device key files
// ---------------------------------------------------------------------------

console.error(`[device-key-add] Writing device key files to ${deviceDir}/`);

mkdirSync(deviceDir, { recursive: true, mode: 0o700 });

writeFileSync(newLeafPath,      newLeafArmored, { encoding: 'utf8', mode: 0o600 });
writeFileSync(newDeviceKeyPath, newDeviceKey,   { encoding: 'utf8', mode: 0o600 });
writeFileSync(newLeafPubPath,   newLeafPub,     { encoding: 'utf8', mode: 0o644 });

// Write .gitignore to protect private material
const gitignorePath = join(deviceDir, '.gitignore');
if (!existsSync(gitignorePath)) {
  writeFileSync(gitignorePath, [
    '# Private key material — never commit',
    'leaf.private.asc',
    'device.key',
    '# Keep public key',
    '!leaf.pub.asc',
    '!.gitignore',
    '',
  ].join('\n'), { encoding: 'utf8', mode: 0o644 });
}

// Write the leaf-authorize entry to a local cache
const entryDir = join(idDir, 'sigchain-entries');
mkdirSync(entryDir, { recursive: true, mode: 0o755 });
const entryPath = join(entryDir, `${newTipCID}.json`);
writeFileSync(entryPath, JSON.stringify(signedEntry, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });

console.error(`  Leaf private key:  ${newLeafPath}`);
console.error(`  Device key:        ${newDeviceKeyPath}`);
console.error(`  Leaf public key:   ${newLeafPubPath}`);
console.error(`  Sigchain entry:    ${entryPath}`);

// ---------------------------------------------------------------------------
// Step 8 — Update identity.json
// ---------------------------------------------------------------------------

console.error('[device-key-add] Updating identity.json...');

const updatedLeafFPs = [...existingLeafFPs];
if (!updatedLeafFPs.includes(newLeafFP)) {
  updatedLeafFPs.push(newLeafFP);
}

const updatedMetadata = {
  ...metadataRaw,
  leafFingerprints: updatedLeafFPs,
  sigchain_tip_cid: newTipCID,
  sigchain_previous_cid: existingTip,
  sigchain_last_updated: now,
};

writeFileSync(metadataPath, JSON.stringify(updatedMetadata, null, 2) + '\n', { encoding: 'utf8', mode: 0o644 });

// ---------------------------------------------------------------------------
// Output summary
// ---------------------------------------------------------------------------

console.log('');
console.log('Device key added.');
console.log(`  Entity:             ${entity}`);
console.log(`  Device name:        ${deviceName}`);
console.log(`  New leaf pubkey:    ${newLeafPubPath}`);
console.log(`  New leaf fp:        ${newLeafFP}`);
console.log(`  Authorized by:      ${signerFingerprint} (${useMasterSigning ? 'master' : 'existing-leaf'})`);
console.log(`  Sigchain tip CID:   ${newTipCID}`);
console.log(`  Metadata updated:   ${metadataPath}`);
console.log('');
console.log('Next steps:');
console.log(`  Submit the updated chain:  koad-io identity submit --entity=${entity}`);
console.log(`  Verify the chain:          koad-io identity verify --entity=${entity}`);
console.log('');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a signing function closure around a kbpgp KeyManager.
 * Returns an object with a .sign(payload) method that uses pgp.js clearsign.
 *
 * @param {object} km - kbpgp KeyManager (private key loaded)
 * @returns {Promise<object>} signer with .sign(payload) → Promise<string>
 */
async function _buildKMSigner(km) {
  const { join: pathJoin } = await import('path');
  const { clearsign } = await import(pathJoin(homeDir, '.koad-io', 'modules', 'node', 'pgp.js'));

  return {
    sign: (payload) => clearsign(payload, km),
  };
}

/**
 * Sign an unsigned entry using a raw KM signer (bypasses identity object).
 * Mirrors the structure of sigchain.signEntry() but delegates to a raw .sign().
 *
 * @param {object} unsignedEntry - from wrapEntry()
 * @param {object} signer - object with .sign(preImageStr) → Promise<string>
 * @returns {Promise<object>} signed entry
 */
async function _signEntryWithSurrogate(unsignedEntry, signer) {
  const { preImageBytes } = sigchainMod;
  const preImage = preImageBytes(unsignedEntry);
  const preImageStr = new TextDecoder().decode(preImage);
  const armored = await signer.sign(preImageStr);
  return { ...unsignedEntry, signature: armored };
}
