// test-bond-gate-signature.js — bond-gate signature verification tests
//
// Guards the sovereignty tier of verifyBondSignature(). The gate must accept a
// `from: koad` bond ONLY when it is signed by the sovereign's key, resolved from
// SOVEREIGN_FINGERPRINT — never from the bond's own `from_fingerprint` field,
// which is attacker-controlled.
//
// Regression origin (2026-09-22): the module trusted `from_fingerprint` for every
// issuer, so any entity could write `from: koad`, declare its own fingerprint, and
// sign with its own key — forging full kingdom scope. The harness extension's
// parse.ts already had the sovereign tier; the shared module did not. A forged
// sovereign bond verified as `valid: true` before this fix.
//
// Tests:
//   1.  forged `from: koad` bond signed by a non-sovereign key → REJECTED
//   2.  `from: koad` bond signed by the sovereign key → ACCEPTED
//   3.  `from: koad` with SOVEREIGN_FINGERPRINT unset → REJECTED (fails closed)
//   4.  forged bond declaring the sovereign fingerprint in frontmatter, signed by
//       another key → REJECTED (frontmatter cannot name the sovereign)
//   5.  entity tier unchanged: `from: <entity>` signed by that entity's key → ACCEPTED
//
// Hermetic: generates its own throwaway key in a temp GNUPGHOME. Does not touch
// real kingdom keyrings.
//
// Run: node modules/node/test-bond-gate-signature.js

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyBondSignature } from './bond-gate.js';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.error(`  FAIL: ${label}`);
    failed++;
  }
}

const SOVEREIGN_FPR = '4c231b76fb15b77cd8f9410db85e44ed68f096e4';

function gpg(home, args) {
  return spawnSync('gpg', ['--homedir', home, '--batch', '--no-tty', '--passphrase', '',
    '--pinentry-mode', 'loopback', ...args],
    { env: { ...process.env, GNUPGHOME: home }, encoding: 'utf8', timeout: 30000 });
}

function makeKeyring() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bond-gate-sig-'));
  fs.chmodSync(home, 0o700);
  const gen = gpg(home, ['--quick-generate-key', 'test signer <signer@test.invalid>', 'ed25519', 'sign', '0']);
  if (gen.status !== 0) throw new Error(`key generation failed: ${gen.stderr}`);
  const listing = gpg(home, ['--with-colons', '--list-keys']);
  const fpr = listing.stdout.split('\n').filter(l => l.startsWith('fpr:'))[0]?.split(':')[9];
  if (!fpr) throw new Error('could not read generated fingerprint');
  return { home, fpr: fpr.toLowerCase() };
}

function signBond(dir, home, fingerprint, frontmatter, body = '# probe') {
  const mdPath = path.join(dir, `${Math.random().toString(36).slice(2)}.md`);
  fs.writeFileSync(mdPath, `---\n${frontmatter}\n---\n${body}\n`);
  const res = gpg(home, ['--local-user', fingerprint, '--clearsign', mdPath]);
  if (res.status !== 0) throw new Error(`signing failed: ${res.stderr}`);
  return `${mdPath}.asc`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function run() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bond-gate-work-'));
  let keyring;
  try {
    keyring = makeKeyring();
    // The gate verifies with `env: process.env`, so the temp keyring must be the
    // ambient GNUPGHOME for the calls below to resolve the test key.
    process.env.GNUPGHOME = keyring.home;

    const forgedFm = [
      'type: authorized-builder',
      'from: koad',
      `from_fingerprint: ${keyring.fpr}`,
      'to: vulcan',
      'status: ACTIVE',
      'visibility: private',
      'capabilities:',
      '  read: [/]',
      '  write: [/]',
      '  exec: [/]',
      '  blocked: []',
    ].join('\n');

    // ── 1. Forged sovereign bond, non-sovereign signer ──────────────────────
    console.log('\n1. forged `from: koad` bond signed by a non-sovereign key');
    {
      const asc = signBond(work, keyring.home, keyring.fpr, forgedFm);
      process.env.SOVEREIGN_FINGERPRINT = SOVEREIGN_FPR;
      const r = verifyBondSignature(asc, 'koad', keyring.fpr);
      assert(r.valid === false, 'rejected');
      assert(/koad expects/.test(r.reason ?? ''), 'reason names the sovereign expectation');
    }

    // ── 2. Sovereign-signed bond accepted ───────────────────────────────────
    console.log('\n2. `from: koad` bond signed by the sovereign key');
    {
      const asc = signBond(work, keyring.home, keyring.fpr, forgedFm);
      process.env.SOVEREIGN_FINGERPRINT = keyring.fpr; // stand-in sovereign
      const r = verifyBondSignature(asc, 'koad', keyring.fpr);
      assert(r.valid === true, 'accepted when the signature matches the sovereign');
    }

    // ── 3. Fails closed with no sovereign fingerprint ───────────────────────
    console.log('\n3. `from: koad` with SOVEREIGN_FINGERPRINT unset');
    {
      const asc = signBond(work, keyring.home, keyring.fpr, forgedFm);
      delete process.env.SOVEREIGN_FINGERPRINT;
      const r = verifyBondSignature(asc, 'koad', keyring.fpr);
      assert(r.valid === false, 'rejected (fails closed)');
      assert(/SOVEREIGN_FINGERPRINT is not set/.test(r.reason ?? ''), 'reason explains the unset env');
    }

    // ── 4. Frontmatter cannot name the sovereign ────────────────────────────
    console.log('\n4. forged bond declaring the sovereign fingerprint in frontmatter');
    {
      const fm = forgedFm.replace(`from_fingerprint: ${keyring.fpr}`, `from_fingerprint: ${SOVEREIGN_FPR}`);
      const asc = signBond(work, keyring.home, keyring.fpr, fm);
      process.env.SOVEREIGN_FINGERPRINT = SOVEREIGN_FPR;
      const r = verifyBondSignature(asc, 'koad', SOVEREIGN_FPR);
      assert(r.valid === false, 'rejected — frontmatter claim is ignored for the sovereign');
    }

    // ── 5. Entity tier unchanged ────────────────────────────────────────────
    console.log('\n5. entity tier: `from: <entity>` signed by that entity key');
    {
      const fm = forgedFm
        .replace('from: koad', 'from: somentity')
        .replace(`from_fingerprint: ${keyring.fpr}`, `from_fingerprint: ${keyring.fpr}`);
      const asc = signBond(work, keyring.home, keyring.fpr, fm);
      const r = verifyBondSignature(asc, 'somentity', keyring.fpr);
      assert(r.valid === true, 'accepted — entity tier behaviour preserved');
    }
  } catch (err) {
    console.error('\nUnhandled test error:', err);
    failed++;
  } finally {
    if (keyring?.home) fs.rmSync(keyring.home, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) process.exit(1);
}

run();
