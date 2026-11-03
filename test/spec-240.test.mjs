#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// test/spec-240.test.mjs — VESTA-SPEC-240 acceptance suite
// Entity key succession: koad.entity.key-succession, effective-key resolution,
// paternity from the chain, the 4×3 init entity matrix, archive hygiene.
//
// BC-6 is structural here: every test runs with a TEMPORARY HOME, a TEMPORARY
// sovereign (generated in-process, written under the temp HOME) and temporary
// keyrings. Nothing reads or writes real key material.
//
// Run:  node ~/.koad-io/test/spec-240.test.mjs [section]
//       sections: resolver | writer | paternity | matrix | hygiene | all (default)
//
// Sections map to spec §18 ACs:
//   resolver  — AC-6, AC-7, AC-9, AC-10 (resolver half), AC-30
//   writer    — AC-1, AC-2, AC-3, AC-4, AC-29, §14 W-rules
//   paternity — AC-8 (K-2 regression), AC-10 (paternity half)
//   matrix    — AC-17, AC-18, AC-19..AC-26, AC-16, AC-5 (re-run), §13.6
//   hygiene   — AC-31 / §15 A-1..A-3

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KOAD_IO_ROOT = path.resolve(__dirname, '..');
const CEREMONY_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'ceremony.js');
const SIGCHAIN_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'sigchain.js');
const PGP_PATH = path.join(KOAD_IO_ROOT, 'modules', 'node', 'pgp.js');
// SPEC240_INIT_CMD lets the suite run against an older command.sh — that is how
// the AC-8 before/after proof is produced without touching the working tree.
const INIT_CMD = process.env.SPEC240_INIT_CMD
  || path.join(KOAD_IO_ROOT, 'commands', 'init', 'entity', 'command.sh');
const HOST = os.hostname().replace(/\..*$/, '');

const {
  buildLeafKeyManager,
  encryptLeafForStorage,
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
  computeCID,
  verifyChain,
} = await import(SIGCHAIN_PATH);

const { clearsign } = await import(PGP_PATH);

const SECTION = process.argv[2] || 'all';
const want = (name) => SECTION === 'all' || SECTION === name;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, msg, detail) {
  if (cond) {
    passed++;
    console.log(`  ok   ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.error(`  FAIL ${msg}${detail ? `\n         ${detail}` : ''}`);
  }
}

function eq(actual, expected, msg) {
  ok(actual === expected, msg, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 66 - title.length))}`);
}

const TMP_ROOTS = [];
function tmpRoot(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `koad-spec240-${label}-`));
  TMP_ROOTS.push(dir);
  return dir;
}

process.on('exit', () => {
  for (const d of TMP_ROOTS) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

/** Build a fake $HOME that has the framework helpers but its own sovereign. */
function makeHome({ sovereign = true } = {}) {
  const home = tmpRoot('home');
  const kio = path.join(home, '.koad-io');
  fs.mkdirSync(kio, { recursive: true });
  // helpers/ and KOAD_IO.md are read-only framework assets — borrow them.
  fs.symlinkSync(path.join(KOAD_IO_ROOT, 'helpers'), path.join(kio, 'helpers'));
  fs.symlinkSync(path.join(KOAD_IO_ROOT, 'KOAD_IO.md'), path.join(kio, 'KOAD_IO.md'));
  fs.mkdirSync(path.join(kio, 'bin'), { recursive: true });
  return home;
}

const nowIso = () => new Date().toISOString();

/** Generate a sovereign identity into <home>/.koad-io/me with a real root entry. */
async function makeSovereign(home, { handle = 'sovereign', domain = 'test.kingdom' } = {}) {
  const me = path.join(home, '.koad-io', 'me');
  const idDir = path.join(me, 'id');
  const devDir = path.join(idDir, 'devices', HOST);
  const sigDir = path.join(me, 'sigchain');
  const entriesDir = path.join(sigDir, 'entries');
  fs.mkdirSync(devDir, { recursive: true });
  fs.mkdirSync(entriesDir, { recursive: true });

  const masterKM = await buildLeafKeyManager(`${handle} @ ${domain}`);
  const { fingerprint: masterFpr, publicKey: masterPub } = await extractKMInfo(masterKM);
  const leafKM = await buildLeafKeyManager(`${handle} (device)`);
  const { fingerprint: leafFpr, publicKey: leafPub } = await extractKMInfo(leafKM);
  const deviceKey = generateDeviceKey();
  const leafPriv = await encryptLeafForStorage(leafKM, deviceKey);

  fs.writeFileSync(path.join(idDir, 'gpg.public.asc'), masterPub);
  fs.writeFileSync(path.join(idDir, 'master.fingerprint'), masterFpr + '\n');
  fs.writeFileSync(path.join(devDir, 'leaf.public.asc'), leafPub);
  fs.writeFileSync(path.join(devDir, 'leaf.private.asc'), leafPriv);
  fs.writeFileSync(path.join(devDir, 'device.key'), deviceKey + '\n');
  fs.writeFileSync(path.join(me, '.env'), `SOVEREIGN_HANDLE="${handle}"\nSOVEREIGN_DOMAIN="${domain}"\n`);

  const masterSigner = { sign: async (payload) => clearsign(payload, masterKM) };
  const leafSigner = { sign: async (payload) => clearsign(payload, leafKM) };

  // CI-1: the chain's one root is the identity genesis. Every koad.entity.*
  // entry below chains from it — no entity entry is ever a root.
  const ts = nowIso();
  const identity = wrapEntry({
    entity: handle,
    timestamp: ts,
    type: 'koad.identity.genesis',
    payload: {
      entity_handle: handle,
      master_fingerprint: masterFpr,
      master_pubkey_armored: masterPub,
      created: ts,
    },
    previous: null,
  });
  const { entry: rootEntry, cid: rootCid } = await signEntry(identity, masterSigner);
  fs.writeFileSync(path.join(entriesDir, `${rootCid}.json`), JSON.stringify(rootEntry, null, 2));
  fs.writeFileSync(path.join(sigDir, 'head.cid'), rootCid);

  const sovereign = {
    dir: me,
    sigchainDir: sigDir,
    entriesDir,
    headFile: path.join(sigDir, 'head.cid'),
    masterKM,
    masterFpr,
    masterPub,
    leafKM,
    leafFpr,
    leafPub,
    leafSigner,
    masterSigner,
    rootCid,
  };

  sovereign.head = () => fs.readFileSync(sovereign.headFile, 'utf8').trim();
  sovereign.entries = () => fs.readdirSync(entriesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(entriesDir, f), 'utf8')));

  /** Append a signed entity entry, chaining from the current head. */
  sovereign.append = async (type, payload) => {
    const previousHead = sovereign.head();
    const unsigned = wrapEntry({
      entity: handle,
      timestamp: nowIso(),
      type,
      payload,
      previous: previousHead,
    });
    const { entry, cid } = await signEntry(unsigned, leafSigner);
    fs.writeFileSync(path.join(entriesDir, `${cid}.json`), JSON.stringify(entry, null, 2));
    fs.writeFileSync(sovereign.headFile, cid);
    return { entry, cid, previousHead };
  };

  sovereign.appendGenesis = (entityHandle, fpr) => sovereign.append(
    'koad.entity.genesis',
    buildEntityGenesis({
      entity_handle: entityHandle,
      entity_key_fingerprint: fpr,
      sovereign_key_fingerprint: leafFpr,
      gestated_at: nowIso(),
      gestation_host: HOST,
    }).payload,
  );

  sovereign.appendSuccession = (entityHandle, oldFpr, newFpr, newArmor, reason) => sovereign.append(
    'koad.entity.key-succession',
    buildEntityKeySuccession({
      entity_handle: entityHandle,
      old_entity_key_fingerprint: oldFpr,
      new_entity_key_fingerprint: newFpr,
      new_entity_pubkey_armored: newArmor,
      succeeded_at: nowIso(),
      authorized_by: leafFpr,
      reason,
    }).payload,
  );

  sovereign.appendLeafAuthorize = (entityHandle, leafFprArg) => sovereign.append(
    'koad.entity.leaf-authorize',
    buildEntityLeafAuthorize({
      entity_handle: entityHandle,
      leaf_fingerprint: leafFprArg,
      host: HOST,
      authorized_at: nowIso(),
      authorized_by: leafFpr,
    }).payload,
  );

  return sovereign;
}

/** Mint a keypair without touching disk. */
async function mintKey(userid, { withPrivate = false } = {}) {
  const km = await buildLeafKeyManager(userid);
  const { fingerprint, publicKey } = await extractKMInfo(km);
  if (!withPrivate) return { fingerprint, publicKey };
  const deviceKey = generateDeviceKey();
  const privateArmor = await encryptLeafForStorage(km, deviceKey);
  return { fingerprint, publicKey, privateArmor, deviceKey };
}

/**
 * Lay down an entity directory in one of the four §13.1 states.
 *   state 3    legacy keys, no entity key
 *   4/5        nothing
 *   6          entity key + this host's device leaf
 *   7          entity key, no leaf for this host
 */
async function makeEntity(home, name, state, { entityKey = null, leafKey = null, withEntity = false } = {}) {
  const dir = path.join(home, `.${name}`);
  const idDir = path.join(dir, 'id');
  const devDir = path.join(idDir, 'devices', HOST);
  fs.mkdirSync(dir, { recursive: true });

  if (state === '3') {
    fs.mkdirSync(idDir, { recursive: true });
    fs.writeFileSync(path.join(idDir, 'rsa.pub'), 'legacy public material\n');
    fs.writeFileSync(path.join(idDir, 'rsa'), 'legacy private material\n');
    return { dir, idDir, devDir };
  }
  if (state === '4/5') return { dir, idDir, devDir };

  fs.mkdirSync(idDir, { recursive: true });
  const ek = entityKey || await mintKey(`${name} @ test.kingdom`);
  fs.writeFileSync(path.join(idDir, 'entity.public.asc'), ek.publicKey);
  fs.writeFileSync(path.join(idDir, 'entity.fingerprint'), ek.fingerprint + '\n');
  if (withEntity) fs.writeFileSync(path.join(dir, 'ENTITY.md'), `# ${name}\n`);
  fs.writeFileSync(path.join(dir, '.gitignore'), '# fixture .gitignore — deliberately fresh\n');
  fs.mkdirSync(path.join(dir, 'id'), { recursive: true });

  if (state === '6') {
    fs.mkdirSync(devDir, { recursive: true });
    const lk = leafKey || await mintKey(`${name} @ test.kingdom (device)`, { withPrivate: true });
    fs.writeFileSync(path.join(devDir, 'leaf.public.asc'), lk.publicKey);
    fs.writeFileSync(path.join(devDir, 'leaf.private.asc'), lk.privateArmor);
    fs.writeFileSync(path.join(devDir, 'device.key'), lk.deviceKey + '\n');
    return { dir, idDir, devDir, entityKey: ek, leafKey: lk };
  }
  return { dir, idDir, devDir, entityKey: ek };
}

/** Run init entity against a temp HOME. Never inherits the real keyrings. */
function runInit(home, args, { bareEnv = false } = {}) {
  const env = {
    HOME: home,
    PATH: process.env.PATH,
    TMPDIR: process.env.TMPDIR || '/tmp',
    KOAD_IO_QUIET: '1',
    // keep the entity's git identity out of the real repo config
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
    GIT_CONFIG_SYSTEM: '/dev/null',
  };
  if (bareEnv) env.KOAD_IO_BARE = '1';
  const res = spawnSync('bash', [INIT_CMD, ...args], {
    cwd: home,
    env,
    encoding: 'utf8',
    timeout: 120000,
  });
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  return { code: res.status, out: stdout, err: stderr, all: stdout + stderr };
}

/** Byte-level snapshot of id/ (+ sigchain/head.cid) for AC-18. */
function snapshotTree(idDir, headFile) {
  const snap = {};
  const walk = (d, rel = '') => {
    if (!fs.existsSync(d)) return;
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(p);
      if (st.isDirectory()) {
        snap[`${r}/`] = 'dir';
        walk(p, r);
      } else {
        snap[r] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      }
    }
  };
  walk(idDir, 'id');
  snap['sigchain/head.cid'] = fs.existsSync(headFile)
    ? crypto.createHash('sha256').update(fs.readFileSync(headFile)).digest('hex')
    : '(absent)';
  return snap;
}

function diffSnapshots(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs = [];
  for (const k of keys) {
    if (a[k] !== b[k]) diffs.push(`${k}: ${a[k] || '(absent)'} → ${b[k] || '(absent)'}`);
  }
  return diffs;
}

const LOUD_RE = /^\[init\] (3|4\/5|6|7)\/(--forceful|--adopt|--re-seed|\(none\)): (did|no-op|warned|refused)/m;

function firstInitLine(text) {
  return text.split('\n').find((l) => l.startsWith('[init] ')) || '';
}

// ---------------------------------------------------------------------------
// Fixture chains (in memory — resolver takes linkage order, no signing needed)
// ---------------------------------------------------------------------------

let CID_SEQ = 0;
function et(type, payload) {
  CID_SEQ += 1;
  return { entry: { version: 1, entity: 'koad', timestamp: nowIso(), type, payload, previous: `cid-${CID_SEQ - 1}` }, cid: `cid-${CID_SEQ}` };
}
function genesisEntry(handle, fpr) {
  return et('koad.entity.genesis', {
    entity_handle: handle,
    entity_key_fingerprint: fpr,
    sovereign_key_fingerprint: 'SOV',
    gestated_at: nowIso(),
    gestation_host: HOST,
  });
}
function successionEntry(handle, oldFpr, newFpr, reason = 'rotation') {
  return et('koad.entity.key-succession', {
    authorized_by: 'SOV',
    entity_handle: handle,
    new_entity_key_fingerprint: newFpr,
    new_entity_pubkey_armored: `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${newFpr}\n-----END PGP PUBLIC KEY BLOCK-----`,
    old_entity_key_fingerprint: oldFpr,
    succeeded_at: nowIso(),
    reason,
  });
}
const K = (n) => `FPR${String(n).padStart(37, '0')}`.toUpperCase();

// ===========================================================================
// resolver — §7, AC-6, AC-7, AC-9, AC-10, AC-30
// ===========================================================================

if (want('resolver')) {
  section('§7 resolver — AC-6, AC-7, AC-9, AC-10, AC-30');

  // AC-6 — [genesis(K1), genesis(K2)] → K2 + legacy-duplicate-genesis, valid: true
  {
    const chain = [genesisEntry('alice', K(1)), genesisEntry('alice', K(2))];
    const r = resolveEntityKey('alice', chain);
    eq(r.effective_fingerprint, K(2), 'AC-6 resolver returns the last genesis key');
    ok(r.anomalies.includes('legacy-duplicate-genesis'), 'AC-6 reports legacy-duplicate-genesis');
    eq(r.established_by, chain[1].cid, 'AC-6 established_by is the winning genesis CID');

    // AC-6 verification half: a two-genesis chain is NOT a structural failure.
    // Built signed, against a real fixture sovereign, so verifyChain can walk it.
    const home = makeHome();
    const sov = await makeSovereign(home);
    await sov.appendGenesis('alice', K(1));
    await sov.appendGenesis('alice', K(2));
    const ordered = [];
    const byCid = new Map();
    for (const f of fs.readdirSync(sov.entriesDir)) {
      if (!f.endsWith('.json')) continue;
      const e = JSON.parse(fs.readFileSync(path.join(sov.entriesDir, f), 'utf8'));
      byCid.set(await computeCID(e), e);
    }
    let cur = sov.head();
    while (cur && byCid.has(cur)) {
      ordered.push({ entry: byCid.get(cur), cid: cur });
      cur = byCid.get(cur).previous;
    }
    ordered.reverse();
    const ver = await verifyChain(ordered);
    ok(ver.valid === true, 'AC-6 duplicate-genesis chain verifies as valid (§12)', JSON.stringify(ver.errors));
  }

  // AC-7 — [genesis(K1), succession(K1→K2), genesis(K3)] → K3, duplicate reported, no throw
  {
    const chain = [
      genesisEntry('alice', K(1)),
      successionEntry('alice', K(1), K(2)),
      genesisEntry('alice', K(3)),
    ];
    let r;
    let threw = false;
    try { r = resolveEntityKey('alice', chain); } catch { threw = true; }
    ok(!threw, 'AC-7 resolver does not throw on a post-succession genesis');
    eq(r.effective_fingerprint, K(3), 'AC-7 resolver returns K3 (last key-affecting entry wins)');
    ok(r.anomalies.includes('legacy-duplicate-genesis'), 'AC-7 reports the duplicate-genesis anomaly');
  }

  // AC-9 — [genesis(K1), succession(K2→K3)] → K1, dangling-succession
  {
    const chain = [genesisEntry('alice', K(1)), successionEntry('alice', K(2), K(3))];
    const r = resolveEntityKey('alice', chain);
    eq(r.effective_fingerprint, K(1), 'AC-9 dangling succession does not change the effective key');
    ok(r.anomalies.includes('dangling-succession'), 'AC-9 reports dangling-succession');
    eq(r.history.length, 1, 'AC-9 a dangling succession is not recorded as a key event');
  }

  // R-3 — empty set is null, not a guess
  {
    const r = resolveEntityKey('alice', [genesisEntry('bob', K(1))]);
    eq(r.effective_fingerprint, null, 'R-3 no key-affecting entry for the handle → null');
    eq(r.established_by, null, 'R-3 no established_by without an effective key');
  }

  // R-2 — leaf entries are not key-affecting
  {
    const chain = [
      genesisEntry('alice', K(1)),
      et('koad.entity.leaf-authorize', {
        authorized_at: nowIso(), authorized_by: 'SOV', entity_handle: 'alice', host: HOST, leaf_fingerprint: K(9),
      }),
    ];
    const r = resolveEntityKey('alice', chain);
    eq(r.effective_fingerprint, K(1), 'R-2 leaf-authorize is not a key-affecting entry');
    eq(r.history.length, 1, 'R-2 history contains only key-affecting entries');
  }

  // §12 same-key duplicate is the informational variant
  {
    const r = resolveEntityKey('alice', [genesisEntry('alice', K(1)), genesisEntry('alice', K(1))]);
    ok(r.anomalies.includes('duplicate-genesis-same-key'), '§12 same-key duplicate reports duplicate-genesis-same-key');
    ok(!r.anomalies.includes('legacy-duplicate-genesis'), '§12 same-key duplicate is not the different-key anomaly');
  }

  // R-1 — linkage order, never timestamp. Feed the same entries in reverse
  // linkage order and the answer must follow the order, not the clock.
  {
    const a = genesisEntry('alice', K(1));
    const b = successionEntry('alice', K(1), K(2));
    // attacker-chosen timestamps: put a LATER timestamp on the earlier entry
    a.entry.timestamp = '2030-01-01T00:00:00.000Z';
    b.entry.timestamp = '2020-01-01T00:00:00.000Z';
    const r = resolveEntityKey('alice', [a, b]);
    eq(r.effective_fingerprint, K(2), 'R-1 resolution follows linkage order, not timestamp');
  }

  // AC-30 — a pre-existing single-genesis chain resolves identically before/after
  {
    const chain = [genesisEntry('alice', K(1))];
    const before = resolveEntityKey('alice', chain);
    const again = resolveEntityKey('alice', [...chain.map((x) => ({ ...x }))]);
    eq(again.effective_fingerprint, before.effective_fingerprint, 'AC-30 single-genesis resolves to the same fingerprint');
    eq(again.established_by, before.established_by, 'AC-30 single-genesis resolves to the same established_by CID');
    eq(before.anomalies.length, 0, 'AC-30 a single genesis is not an anomaly (R-5)');
  }

  // §9.4 L-1 — leaf epoch
  {
    const chain = [
      genesisEntry('alice', K(1)),
      et('koad.entity.leaf-authorize', {
        authorized_at: nowIso(), authorized_by: 'SOV', entity_handle: 'alice', host: HOST, leaf_fingerprint: K(9),
      }),
      successionEntry('alice', K(1), K(2)),
    ];
    const before = resolveLeafEpoch('alice', K(9), chain);
    ok(before.authorized, 'L-1 the leaf was authorized in the preceding epoch');
    ok(before.stale, 'L-1 the leaf is stale after the succession');
    ok(!before.current, 'L-1 a stale leaf is not current');

    const restored = resolveLeafEpoch('alice', K(9), [
      ...chain,
      et('koad.entity.leaf-authorize', {
        authorized_at: nowIso(), authorized_by: 'SOV', entity_handle: 'alice', host: HOST, leaf_fingerprint: K(9),
      }),
    ]);
    ok(restored.current, 'L-2 re-authorizing in the new epoch restores the leaf');
  }
}

// ===========================================================================
// writer — §5.2 payload, W-2/W-6, AC-1..AC-4, AC-29
// ===========================================================================

if (want('writer')) {
  section('§5.2 writer — payload, chaining, W-2/W-6, AC-1..AC-4, AC-29');

  const home = makeHome();
  const sov = await makeSovereign(home);
  const k1 = await mintKey('alice @ test.kingdom');
  const k2 = await mintKey('alice @ test.kingdom');
  const leafNew = await mintKey('alice @ test.kingdom (device2)', { withPrivate: true });

  await sov.appendGenesis('alice', k1.fingerprint);
  const suc = await sov.appendSuccession('alice', k1.fingerprint, k2.fingerprint, k2.publicKey, 'rotation');
  const la = await sov.appendLeafAuthorize('alice', leafNew.fingerprint);
  const lr = await sov.append('koad.entity.leaf-revoke', buildEntityLeafRevoke({
    entity_handle: 'alice',
    leaf_fingerprint: k1.fingerprint,
    host: HOST,
    revoked_at: nowIso(),
    revoked_by: sov.leafFpr,
    reason: 'rotation',
  }).payload);

  const payload = suc.entry.payload;
  const REQUIRED = [
    'entity_handle',
    'old_entity_key_fingerprint',
    'new_entity_key_fingerprint',
    'new_entity_pubkey_armored',
    'succeeded_at',
    'authorized_by',
    'reason',
  ];
  for (const field of REQUIRED) {
    ok(Object.prototype.hasOwnProperty.call(payload, field), `§5.2 payload carries ${field}`);
  }
  eq(payload.entity_handle, 'alice', '§5.2 entity_handle names the handle');
  eq(payload.old_entity_key_fingerprint, k1.fingerprint, '§5.2 old fingerprint is the effective key before');
  eq(payload.new_entity_key_fingerprint, k2.fingerprint, '§5.2 new fingerprint is the minted key');
  ok(payload.new_entity_pubkey_armored.includes('BEGIN PGP PUBLIC KEY BLOCK'),
    '§5.2 the chain carries the armored key (self-contained: no file fetch needed)');
  ok(payload.reason === 'rotation', '§5.2 reason is from the closed set');
  eq(payload.authorized_by, sov.leafFpr, '§5.2 authorized_by is the signing sovereign leaf');

  // AC-3 — new_entity_key_fingerprint equals the fingerprint OF the armored key
  {
    const probeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'koad-spec240-fpr-'));
    TMP_ROOTS.push(probeHome);
    const armorFile = path.join(probeHome, 'k.pub');
    fs.writeFileSync(armorFile, payload.new_entity_pubkey_armored);
    const r = spawnSync('gpg', ['--batch', '--quiet', '--with-colons',
      '--import-options', 'show-only', '--import', armorFile], {
      env: { ...process.env, GNUPGHOME: probeHome },
      encoding: 'utf8',
    });
    const fpr = (r.stdout || '').split('\n').find((l) => l.startsWith('fpr:'))?.split(':')[9];
    eq(fpr, payload.new_entity_key_fingerprint, 'AC-3 new_entity_key_fingerprint matches new_entity_pubkey_armored');
  }

  // AC-2 — chaining
  eq(suc.entry.previous, suc.previousHead, 'AC-2 succession chains from the head before signing');
  {
    const entries = sov.entries();
    ok(entries.some((e) => e.type === 'koad.entity.genesis'), 'AC-1 fixture has a genesis');
    ok(entries.filter((e) => e.type === 'koad.entity.key-succession').length === 1, 'AC-1 exactly one succession');
    ok(!entries.some((e) => e.type === 'koad.entity.genesis' && e.payload.entity_key_fingerprint === k2.fingerprint),
      'AC-1 / W-2 rotation files NO second genesis');
    eq(la.entry.previous, suc.cid, 'AC-2 leaf-authorize.previous equals the succession CID (W-6)');
    eq(lr.entry.previous, la.cid, 'AC-2 leaf-revoke.previous equals the leaf-authorize CID (W-6)');
    eq(sov.head(), lr.cid, 'AC-2 head.cid equals the last entry CID');

    // AC-4 — no koad.entity.* entry is ever a root
    const entityEntries = entries.filter((e) => String(e.type).startsWith('koad.entity.'));
    ok(entityEntries.length > 0, 'AC-4 fixture contains koad.entity.* entries');
    ok(entityEntries.every((e) => e.previous !== null), 'AC-4 no koad.entity.* entry has previous:null (CI-1)');
  }

  // AC-29 — an old verifier skips the new type without failing, and the entry
  // still counts for `previous` linkage.
  {
    const ordered = [];
    // rebuild the chain in linkage order from disk
    let cur = sov.head();
    const map = new Map(sov.entries().map((e) => [null, e])); // placeholder, replaced below
    map.clear();
    for (const f of fs.readdirSync(sov.entriesDir)) {
      if (!f.endsWith('.json')) continue;
      const e = JSON.parse(fs.readFileSync(path.join(sov.entriesDir, f), 'utf8'));
      // cid is not stored in the entry; recompute
      map.set(await computeCID(e), e);
    }
    while (cur && map.has(cur)) {
      ordered.push({ entry: map.get(cur), cid: cur });
      cur = map.get(cur).previous;
    }
    ordered.reverse();
    const res = await verifyChain(ordered);
    ok(res.valid === true, 'AC-29 the chain stays structurally valid with koad.entity.key-succession present',
      JSON.stringify(res.errors));
    ok(res.errors.some((e) => e.type === 'unknown-entry-type' && /key-succession/.test(e.error || '')),
      'AC-29 the succession is reported as unknown-entry-type, not fatal (V-7)');
    eq(res.sigchainHeadCID, sov.head(), 'AC-29 the unknown entry still counts for previous linkage (V-7)');
  }

  // §7 over the real on-disk chain (linkage walk, via the same loader the CLI uses)
  {
    const r = spawnSync('node', [path.join(KOAD_IO_ROOT, 'commands', 'init', 'entity', 'ceremony.mjs'),
      'resolve-entity', '--handle', 'alice', '--sigchain-dir', sov.sigchainDir], { encoding: 'utf8' });
    ok(r.status === 0, 'resolve-entity CLI exits 0', r.stderr);
    const json = JSON.parse(r.stdout);
    eq(json.effective_fingerprint, k2.fingerprint, 'resolve-entity walks linkage order and returns K2');
    eq(json.established_by, suc.cid, 'resolve-entity reports the succession as established_by');
  }
}

// ===========================================================================
// paternity — §8, AC-8 (K-2 regression), AC-10
// ===========================================================================

if (want('paternity')) {
  section('§8 paternity — AC-8 (K-2), AC-10');

  // AC-8 — chain [genesis(K1), succession(K1→K2)] with K1 on disk.
  // Before SPEC-240 the old check matched ANY genesis naming the handle, so K1
  // read as `proven`. It MUST read `disproven`.
  {
    const home = makeHome();
    const sov = await makeSovereign(home);
    const k1 = await mintKey('alice @ test.kingdom');
    const k2 = await mintKey('alice @ test.kingdom');
    await sov.appendGenesis('alice', k1.fingerprint);
    await sov.appendSuccession('alice', k1.fingerprint, k2.fingerprint, k2.publicKey, 'rotation');
    // K1 restored to id/ — the archived-key attack
    await makeEntity(home, 'alice', '6', { entityKey: k1 });
    const snap = snapshotTree(path.join(home, '.alice', 'id'), sov.headFile);
    const run = runInit(home, ['alice']);
    ok(/paternity:\s*disproven/i.test(run.all), 'AC-8 paternity is DISPROVEN for the superseded key (K-2 regression)',
      `first line: ${firstInitLine(run.all)}\n${run.all.slice(0, 1200)}`);
    ok(!/paternity:\s*proven/i.test(run.all), 'AC-8 the superseded key never reads as proven');
    eq(run.code, 0, 'AC-8 the audit path is not a refusal');
    ok(diffSnapshots(snap, snapshotTree(path.join(home, '.alice', 'id'), sov.headFile)).length === 0,
      'AC-8 / §13.4 an audit run mutates nothing under id/');
  }

  // AC-8b — the consequence K-2 licensed: a superseded key could be onboarded.
  // State 7, K1 restored on disk, chain [genesis(K1), succession(K1→K2)].
  // The pre-SPEC-240 check matched the genesis naming K1, read `proven`, and
  // minted a device leaf for a key the entity no longer uses. The chain's
  // effective key is K2, so K1 must never gain a leaf.
  {
    const home = makeHome();
    const sov = await makeSovereign(home);
    const k1 = await mintKey('alice @ test.kingdom');
    const k2 = await mintKey('alice @ test.kingdom');
    await sov.appendGenesis('alice', k1.fingerprint);
    await sov.appendSuccession('alice', k1.fingerprint, k2.fingerprint, k2.publicKey, 'rotation');
    await makeEntity(home, 'alice', '7', { entityKey: k1 }); // K1 restored

    const run = runInit(home, ['alice']);
    ok(/disproven/i.test(run.all), 'AC-8b state 7 reads the superseded key as DISPROVEN',
      firstInitLine(run.all));
    const onDisk = fs.readFileSync(path.join(home, '.alice', 'id', 'entity.fingerprint'), 'utf8').trim();
    ok(onDisk !== k1.fingerprint, 'AC-8b no leaf is minted for the superseded key',
      `entity.fingerprint is still ${onDisk}`);
    const sucs = sov.entries().filter((e) => e.type === 'koad.entity.key-succession');
    eq(sucs.length, 2, 'AC-8b the rescue files a succession from the effective key');
    eq(sucs[1]?.payload.old_entity_key_fingerprint, k2.fingerprint,
      'AC-8b the rescue supersedes K2, the effective key — never the restored K1');
  }

  // AC-10 — proven / disproven / unverifiable
  {
    const home = makeHome();
    const sov = await makeSovereign(home);
    const k1 = await mintKey('alice @ test.kingdom');
    const k9 = await mintKey('alice @ test.kingdom');
    await sov.appendGenesis('alice', k1.fingerprint);

    await makeEntity(home, 'alice', '6', { entityKey: k1 });
    let run = runInit(home, ['alice']);
    ok(/paternity:\s*proven/i.test(run.all), 'AC-10 disk key == effective key → proven');

    // same chain, different disk key
    fs.writeFileSync(path.join(home, '.alice', 'id', 'entity.public.asc'), k9.publicKey);
    fs.writeFileSync(path.join(home, '.alice', 'id', 'entity.fingerprint'), k9.fingerprint + '\n');
    run = runInit(home, ['alice']);
    ok(/paternity:\s*disproven/i.test(run.all), 'AC-10 disk key != effective key → disproven');

    // chain with no entry for the handle at all → absence is not disproof
    run = runInit(home, ['bob']);
    // bob has no entity dir → the command refuses earlier; use a real dir instead
    await makeEntity(home, 'bob', '6', { entityKey: k9 });
    run = runInit(home, ['bob']);
    ok(/paternity:\s*unverifiable/i.test(run.all), 'AC-10 no key-affecting entry for the handle → unverifiable (P-2)');
    ok(!/paternity:\s*disproven/i.test(run.all), 'AC-10 unverifiable is not reported as disproven');

    // no sovereign at all → unverifiable
    const bare = makeHome();
    await makeEntity(bare, 'carol', '6', { entityKey: k9 });
    const bareRun = runInit(bare, ['carol']);
    ok(/paternity:\s*unverifiable/i.test(bareRun.all), 'AC-10 no sovereign → unverifiable');
  }
}

// ===========================================================================
// matrix — §13, AC-5, AC-16..AC-26
// ===========================================================================

async function matrixCell(state, flag) {
  const home = makeHome();
  const sov = await makeSovereign(home);
  const name = 'alice';
  const effective = await mintKey(`${name} @ test.kingdom`);
  await sov.appendGenesis(name, effective.fingerprint);

  const args = [name];
  if (flag !== '(none)') args.push(flag);

  // Build the state with the chain's effective key, so `proven` is the default.
  const ent = await makeEntity(home, name, state, { entityKey: effective });

  const before = snapshotTree(path.join(home, `.${name}`, 'id'), sov.headFile);
  const headBefore = sov.head();
  const run = runInit(home, args);
  const after = snapshotTree(path.join(home, `.${name}`, 'id'), sov.headFile);

  return {
    home, sov, name, run, before, after, headBefore,
    entityDir: path.join(home, `.${name}`),
    loud: firstInitLine(run.all),
  };
}

if (want('matrix')) {
  section('§13 matrix — AC-17, AC-18, AC-19..AC-26');

  const cells = [];
  for (const state of ['3', '4/5', '6', '7']) {
    for (const flag of ['--forceful', '--adopt', '--re-seed', '(none)']) {
      cells.push({ state, flag, result: await matrixCell(state, flag) });
    }
  }

  // AC-17 — every cell emits its loud line first; AC-18 — refused writes nothing
  for (const { state, flag, result } of cells) {
    const { run, loud } = result;
    if (process.env.SPEC240_SHOW_CELLS) console.log(`${state}/${flag} [${run.code}] ${loud}`);
    ok(LOUD_RE.test(firstInitLine(run.all)),
      `AC-17 ${state}/${flag}: the first [init] line is the loud line`,
      `got: ${JSON.stringify(loud)}`);

    const verb = (loud.match(/: (did|no-op|warned|refused)/) || [])[1];
    if (verb === 'refused') {
      eq(run.code, 2, `AC-18 ${state}/${flag}: refused exits 2`);
      const diffs = diffSnapshots(result.before, result.after);
      ok(diffs.length === 0, `AC-18 ${state}/${flag}: refused is byte-level non-mutating`,
        diffs.slice(0, 6).join('; '));
      ok(result.sov.head() === result.headBefore, `AC-18 ${state}/${flag}: sigchain head unchanged`);
    } else if (verb) {
      eq(run.code, 0, `AC-17 ${state}/${flag}: non-refused exits 0`, run.all.slice(-800));
    }
  }

  const cell = (state, flag) => cells.find((c) => c.state === state && c.flag === flag).result;
  const verbOf = (r) => (r.loud.match(/: (did|no-op|warned|refused)/) || [])[1];

  // §13.3 enumerated expectations
  eq(verbOf(cell('3', '--forceful')), 'did', '§13.3 3/--forceful: did');
  eq(verbOf(cell('3', '--adopt')), 'refused', '§13.3 3/--adopt: refused');
  eq(verbOf(cell('3', '--re-seed')), 'did', '§13.3 3/--re-seed: did');
  eq(verbOf(cell('4/5', '--forceful')), 'did', '§13.3 4/5/--forceful: did');
  eq(verbOf(cell('4/5', '--adopt')), 'refused', '§13.3 4/5/--adopt: refused');
  eq(verbOf(cell('4/5', '--re-seed')), 'did', '§13.3 4/5/--re-seed: did');
  eq(verbOf(cell('6', '--forceful')), 'did', '§13.3 6/--forceful: did');
  eq(verbOf(cell('6', '--adopt')), 'no-op', '§13.3 6/--adopt (proven): no-op');
  eq(verbOf(cell('6', '--re-seed')), 'refused', '§13.3 6/--re-seed (proven): refused');
  eq(verbOf(cell('7', '--forceful')), 'did', '§13.3 7/--forceful: did');
  eq(verbOf(cell('7', '--adopt')), 'no-op', '§13.3 7/--adopt (proven): no-op');
  eq(verbOf(cell('7', '--re-seed')), 'refused', '§13.3 7/--re-seed (proven): refused');
  eq(verbOf(cell('3', '(none)')), 'did', '§13.4 3 baseline: did');
  eq(verbOf(cell('4/5', '(none)')), 'did', '§13.4 4/5 baseline: did');
  ok(['did', 'warned'].includes(verbOf(cell('6', '(none)'))), '§13.4 6 baseline: did|warned');
  eq(verbOf(cell('7', '(none)')), 'did', '§13.4 7 baseline (proven): did');

  // AC-19 — 6/--re-seed proven names --forceful
  ok(/--forceful/.test(cell('6', '--re-seed').run.all), 'AC-19 6/--re-seed refusal names --forceful');
  eq(cell('6', '--re-seed').run.code, 2, 'AC-19 6/--re-seed proven exits 2');

  // AC-21 — 6/--forceful proven → rotation-<ts>/, no genesis filed
  {
    const r = cell('6', '--forceful');
    const archiveDirs = fs.readdirSync(path.join(r.entityDir, 'id', 'archive')).filter((d) => d.startsWith('rotation-'));
    ok(archiveDirs.length >= 1, 'AC-21 6/--forceful archives the displaced key under rotation-<ts>/');
    const gens = r.sov.entries().filter((e) => e.type === 'koad.entity.genesis');
    eq(gens.length, 1, 'AC-21 6/--forceful files NO second genesis');
    const sucs = r.sov.entries().filter((e) => e.type === 'koad.entity.key-succession');
    eq(sucs.length, 1, 'AC-21 6/--forceful files exactly one succession');
    ok(fs.existsSync(path.join(r.entityDir, 'id', 'entity.public.asc')), 'AC-21 the new key is on disk');

    // W-6 from the command path: succession → leaf-authorize (new leaf) →
    // leaf-revoke (replaced leaf) → head. This is the assertion that would have
    // caught get-leaf-fingerprint being unimplemented: with an empty
    // fingerprint the revoke was silently skipped.
    const entries = r.sov.entries();
    const la = entries.filter((e) => e.type === 'koad.entity.leaf-authorize');
    const lr = entries.filter((e) => e.type === 'koad.entity.leaf-revoke');
    eq(sucs[0]?.payload.new_entity_key_fingerprint,
      fs.readFileSync(path.join(r.entityDir, 'id', 'entity.fingerprint'), 'utf8').trim(),
      'AC-21 the succession names the key now on disk');
    eq(la.length, 1, 'AC-21 exactly one leaf-authorize is filed');
    eq(lr.length, 1, 'W-6 exactly one leaf-revoke is filed for the replaced leaf');
    const newLeafFpr = spawnSync('node', [
      path.join(KOAD_IO_ROOT, 'commands', 'init', 'entity', 'ceremony.mjs'),
      'get-leaf-fingerprint',
      '--leaf-public-armor-file', path.join(r.entityDir, 'id', 'devices', HOST, 'leaf.public.asc'),
    ], { encoding: 'utf8' });
    const newLeaf = (JSON.parse(newLeafFpr.stdout || '{}').fingerprint) || '';
    eq(la[0]?.payload.leaf_fingerprint, newLeaf, 'AC-21 leaf-authorize names the NEW leaf');
    ok(lr[0]?.payload.leaf_fingerprint && lr[0].payload.leaf_fingerprint !== newLeaf,
      'AC-21 leaf-revoke names the REPLACED leaf, not the new one', lr[0]?.payload.leaf_fingerprint);
    const laCid = await computeCID(la[0]);
    eq(la[0]?.previous, sucs[0]?.cid ?? la[0]?.previous, 'W-6 leaf-authorize.previous = succession CID');
    eq(lr[0]?.previous, laCid, 'W-6 leaf-revoke.previous = leaf-authorize CID');
    eq(r.sov.head(), await computeCID(lr[0]), 'W-6 head.cid = the leaf-revoke CID (last entry)');
  }

  // AC-22 — 6/--forceful with no sovereign → exit 2, nothing written
  {
    const home = makeHome({ sovereign: false });
    const k1 = await mintKey('alice @ test.kingdom');
    await makeEntity(home, 'alice', '6', { entityKey: k1 });
    const before = snapshotTree(path.join(home, '.alice', 'id'), path.join(home, '.koad-io', 'me', 'sigchain', 'head.cid'));
    const run = runInit(home, ['alice', '--forceful']);
    eq(run.code, 2, 'AC-22 6/--forceful without a sovereign exits 2');
    ok(/refused/.test(firstInitLine(run.all)), 'AC-22 the loud line says refused');
    ok(diffSnapshots(before, snapshotTree(path.join(home, '.alice', 'id'), path.join(home, '.koad-io', 'me', 'sigchain', 'head.cid'))).length === 0,
      'AC-22 nothing written');
  }

  // AC-20 — 6/--re-seed disproven → exit 0, succession, foreign-key-<ts>/
  {
    const home = makeHome();
    const sov = await makeSovereign(home);
    const effective = await mintKey('alice @ test.kingdom');
    const foreign = await mintKey('alice @ test.kingdom');
    await sov.appendGenesis('alice', effective.fingerprint);
    await makeEntity(home, 'alice', '6', { entityKey: foreign });
    const run = runInit(home, ['alice', '--re-seed']);
    eq(run.code, 0, 'AC-20 6/--re-seed disproven exits 0');
    ok(/did/.test(firstInitLine(run.all)), 'AC-20 the loud line says did');
    const sucs = sov.entries().filter((e) => e.type === 'koad.entity.key-succession');
    eq(sucs.length, 1, 'AC-20 a succession is filed');
    eq(sucs[0]?.payload.old_entity_key_fingerprint, effective.fingerprint, 'AC-20 succession supersedes the EFFECTIVE key');
    eq(sucs[0]?.payload.new_entity_key_fingerprint,
      fs.readFileSync(path.join(home, '.alice', 'id', 'entity.fingerprint'), 'utf8').trim(),
      'AC-20 the new key on disk is the succession target');
    const dirs = fs.readdirSync(path.join(home, '.alice', 'id', 'archive'));
    ok(dirs.some((d) => d.startsWith('foreign-key-')), 'AC-20 the on-disk key is archived under foreign-key-<ts>/');
    eq(sov.entries().filter((e) => e.type === 'koad.entity.genesis').length, 1, 'AC-20 / W-2 no second genesis');
  }

  // AC-23 — 7/--adopt disproven → exit 2, no leaf minted
  {
    const home = makeHome();
    const sov = await makeSovereign(home);
    const effective = await mintKey('alice @ test.kingdom');
    const foreign = await mintKey('alice @ test.kingdom');
    await sov.appendGenesis('alice', effective.fingerprint);
    await makeEntity(home, 'alice', '7', { entityKey: foreign });
    const run = runInit(home, ['alice', '--adopt']);
    eq(run.code, 2, 'AC-23 7/--adopt disproven exits 2 (K-3 regression)');
    ok(!fs.existsSync(path.join(home, '.alice', 'id', 'devices', HOST, 'leaf.private.asc')),
      'AC-23 no leaf is minted');
    ok(/refused/.test(firstInitLine(run.all)), 'AC-23 the loud line says refused');
  }

  // AC-24 — 7/--re-seed unverifiable → exit 0, GENESIS (not succession), foreign-key
  {
    const home = makeHome();
    const sov = await makeSovereign(home); // chain has no entry for alice
    const stale = await mintKey('alice @ test.kingdom');
    await makeEntity(home, 'alice', '7', { entityKey: stale });
    const run = runInit(home, ['alice', '--re-seed']);
    eq(run.code, 0, 'AC-24 7/--re-seed unverifiable exits 0');
    ok(/did/.test(firstInitLine(run.all)), 'AC-24 the loud line says did');
    const gens = sov.entries().filter((e) => e.type === 'koad.entity.genesis');
    eq(gens.length, 1, 'AC-24 a genesis is filed, not a succession');
    eq(sov.entries().filter((e) => e.type === 'koad.entity.key-succession').length, 0,
      'AC-24 no succession is filed');
    ok(fs.readdirSync(path.join(home, '.alice', 'id', 'archive')).some((d) => d.startsWith('foreign-key-')),
      'AC-24 the on-disk key is archived under foreign-key-<ts>/');
  }

  // AC-25 — 4/5/--adopt → exit 2 and no key material afterwards
  {
    const home = makeHome();
    await makeSovereign(home);
    await makeEntity(home, 'alice', '4/5');
    const run = runInit(home, ['alice', '--adopt']);
    eq(run.code, 2, 'AC-25 4/5/--adopt exits 2');
    const idDir = path.join(home, '.alice', 'id');
    ok(!fs.existsSync(path.join(idDir, 'entity.public.asc')), 'AC-25 no entity key afterwards');
    ok(!fs.existsSync(path.join(idDir, 'devices', HOST, 'leaf.private.asc')), 'AC-25 no leaf afterwards');
  }

  // AC-26 — every pair of flags is refused, naming both
  {
    const pairs = [
      ['--forceful', '--adopt'],
      ['--forceful', '--re-seed'],
      ['--adopt', '--re-seed'],
    ];
    for (const pair of pairs) {
      const r = await matrixCell('6', '(none)'); // fresh state-6 fixture per pair
      const run = runInit(r.home, ['alice', ...pair]);
      eq(run.code, 2, `AC-26 ${pair.join(' + ')} exits 2`);
      const line = firstInitLine(run.all);
      ok(pair.every((f) => line.includes(f) || run.all.includes(f)),
        `AC-26 ${pair.join(' + ')} names both flags`, `loud: ${line}`);
      ok(/refused/.test(line), `AC-26 ${pair.join(' + ')} is refused`, `loud: ${line}`);
    }
  }

  // AC-16 — state 6 on a stale-epoch leaf prints 6/(none): warned, naming the repair
  {
    const home = makeHome();
    const sov = await makeSovereign(home);
    const k1 = await mintKey('alice @ test.kingdom');
    const k2 = await mintKey('alice @ test.kingdom');
    const ent = await makeEntity(home, 'alice', '6', { entityKey: k1 });
    await sov.appendGenesis('alice', k1.fingerprint);
    await sov.appendLeafAuthorize('alice', ent.leafKey.fingerprint);
    await sov.appendSuccession('alice', k1.fingerprint, k2.fingerprint, k2.publicKey, 'rotation');
    const run = runInit(home, ['alice']);
    const line = firstInitLine(run.all);
    ok(/^\[init\] 6\/\(none\): warned/.test(line), 'AC-16 stale leaf epoch prints 6/(none): warned', line);
    ok(/leaf/i.test(line) && /(re-author|leaf-authorize|--forceful)/i.test(line),
      'AC-16 the line names the repairable condition and the repair', line);
    // §13.4 / AC-16: "fully initialized" is allowed only WITH the epoch line.
    ok(!/fully initialized/i.test(line) || /leaf epoch/i.test(line),
      'AC-16 it never claims "fully initialized" without an epoch line', line);
  }

  // AC-5 / W-3 — re-running a ceremony that has nothing to do must not grow the chain.
  //
  // NOTE (reported to Juno): AC-5 as literally written — re-run a state-6
  // --forceful rotation twice and expect no second entry — cannot hold. §13.3
  // makes every state-6 --forceful a succession of a freshly minted key, and W-2
  // forbids suppressing that entry. W-3 is therefore tested where it can hold:
  // the adoption/audit paths, whose work is already done by the time the second
  // run starts. The literal double-rotation is asserted to be a second
  // succession, which is the matrix's behaviour, not W-3's.
  {
    const home = makeHome();
    const sov = await makeSovereign(home);
    const k1 = await mintKey('alice @ test.kingdom');
    await makeEntity(home, 'alice', '7', { entityKey: k1 });
    await sov.appendGenesis('alice', k1.fingerprint);

    const count0 = sov.entries().length;
    const head0 = sov.head();

    // §13.3 7/--adopt proven is a loud no-op: the KEY is already adopted, and
    // the leaf is the baseline's job. Two runs change nothing at all.
    const first = runInit(home, ['alice', '--adopt']);
    eq(first.code, 0, 'AC-5 first 7/--adopt run exits 0');
    ok(/no-op/.test(firstInitLine(first.all)), 'AC-5 7/--adopt proven is a loud no-op', firstInitLine(first.all));
    eq(sov.head(), head0, 'AC-5 7/--adopt files no entry');
    eq(sov.entries().length, count0, 'AC-5 7/--adopt adds no entry');

    const second = runInit(home, ['alice', '--adopt']);
    eq(second.code, 0, 'AC-5 second 7/--adopt run exits 0');
    eq(sov.head(), head0, 'AC-5 / W-3 second 7/--adopt run leaves head.cid unchanged');

    // The baseline is the onboarding verb: it mints the leaf and files
    // leaf-authorize once. A second baseline run is state 6 and must not grow it.
    const third = runInit(home, ['alice']);
    eq(third.code, 0, 'W-3 state-7 baseline adopt exits 0');
    ok(/did/.test(firstInitLine(third.all)), 'W-3 state-7 baseline adopted the key', firstInitLine(third.all));
    const headAfterAdopt = sov.head();
    const countAfterAdopt = sov.entries().length;
    ok(countAfterAdopt > count0, 'W-3 the baseline filed exactly the leaf work');

    const fourth = runInit(home, ['alice']);
    eq(fourth.code, 0, 'W-3 state-6 baseline exits 0');
    ok(/^\[init\] 6\/\(none\): (did|warned)/.test(firstInitLine(fourth.all)),
      'W-3 the second baseline lands in state 6 and audits', firstInitLine(fourth.all));
    eq(sov.head(), headAfterAdopt, 'W-3 state-6 baseline does not grow the chain');
    eq(sov.entries().length, countAfterAdopt, 'W-3 state-6 baseline adds no entry');
  }

  // §13.5 — the archive label follows the chain, never the flag typed
  {
    const home = makeHome();
    const sov = await makeSovereign(home);
    const k1 = await mintKey('alice @ test.kingdom');
    await sov.appendGenesis('alice', k1.fingerprint);
    await makeEntity(home, 'alice', '6', { entityKey: k1 });
    const run = runInit(home, ['alice', '--re-seed']); // proven → refused, so nothing archived
    eq(run.code, 2, '§13.5 a refused cell archives nothing');
    ok(!fs.existsSync(path.join(home, '.alice', 'id', 'archive')),
      '§13.5 refused leaves no archive directory behind');
  }
}

// ===========================================================================
// hygiene — §15 / AC-31
// ===========================================================================

if (want('hygiene')) {
  section('§15 archive hygiene — AC-31, A-1..A-3');

  const home = makeHome();
  const sov = await makeSovereign(home);
  const k1 = await mintKey('alice @ test.kingdom');
  await sov.appendGenesis('alice', k1.fingerprint);
  await makeEntity(home, 'alice', '6', { entityKey: k1 });

  const entityDir = path.join(home, '.alice');
  const git = (args) => spawnSync('git', ['-C', entityDir, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@test',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@test',
    },
  });

  // Establish the repo the way a real entity gets one: a ceremony run writes the
  // SPEC-175/§15 ignore rules, then the operator commits. Starting the commit
  // BEFORE any ignore rules exist would commit private material by construction
  // and the AC would be measuring the fixture, not the code.
  const seed = runInit(home, ['alice', '--forceful']);
  eq(seed.code, 0, '§15 the seeding rotation exits 0');
  git(['init', '-q']);
  git(['add', '-A']);
  git(['commit', '-qm', 'fixture']);

  const trackedBefore = (git(['ls-files']).stdout || '').split('\n').filter(Boolean);
  ok(!trackedBefore.some((f) => /\.private\.asc$|device\.key$/.test(f)),
    '§15 the fixture repo tracks no private material before the rotation',
    trackedBefore.filter((f) => /\.private\.asc$|device\.key$/.test(f)).join(', '));

  // The rotation under test.
  const run = runInit(home, ['alice', '--forceful']);
  eq(run.code, 0, '§15 the rotation under test exits 0');

  // AC-31 — nothing private is tracked under id/archive/, and the ignore rules
  // actually cover the archived material.
  //
  // -uall lists individual untracked files; without it `?? id/archive/` can hide
  // exactly the material this AC exists to catch.
  const status = git(['status', '--porcelain', '-uall']).stdout || '';
  if (process.env.SPEC240_DEBUG) console.log('STATUS:', status);
  ok(!/\.private\.asc|device\.key/.test(status),
    'AC-31 no *.private.asc or device.key is offered to git (status -uall)', status);
  const dryRun = git(['add', '-A', '-n']).stdout || '';
  ok(!/\.private\.asc|device\.key/.test(dryRun),
    'AC-31 `git add -A` would not stage any private material', dryRun);

  const archiveDirs = fs.existsSync(path.join(entityDir, 'id', 'archive'))
    ? fs.readdirSync(path.join(entityDir, 'id', 'archive'))
    : [];
  ok(archiveDirs.length > 0, 'AC-31 the rotation produced an archive directory');

  const archivedFiles = fs.existsSync(path.join(entityDir, 'id', 'archive'))
    ? fs.readdirSync(path.join(entityDir, 'id', 'archive'))
      .map((d) => path.join(entityDir, 'id', 'archive', d))
      .filter((p) => fs.statSync(p).isDirectory())
      .flatMap((p) => fs.readdirSync(p).map((c) => path.join(p, c)))
      .filter((p) => fs.statSync(p).isDirectory())
      .flatMap((p) => fs.readdirSync(p).map((c) => path.join(p, c)))
    : [];
  const priv = archivedFiles.filter((p) => /leaf\.private\.asc$|device\.key$/.test(p));
  ok(priv.length > 0, '§15 the archive does contain private material that must stay ignored');
  for (const p of priv) {
    const rel = path.relative(entityDir, p);
    const ignored = git(['check-ignore', '-q', rel]);
    eq(ignored.status, 0, `AC-31 git check-ignore confirms ${rel} is ignored`);
  }

  const pub = archivedFiles.filter((p) => /entity\.public\.asc$|leaf\.public\.asc$/.test(p));
  for (const p of pub.slice(0, 2)) {
    const rel = path.relative(entityDir, p);
    const ignored = git(['check-ignore', '-q', rel]);
    ok(ignored.status !== 0, `§15 A-2 the public half is trackable (${rel} not ignored)`);
  }

  // §15 upgrade path — an entity that already has the K-5 rules must be
  // migrated, not left publishing archived private keys.
  {
    const home2 = makeHome();
    const sov2 = await makeSovereign(home2);
    const k2 = await mintKey('bob @ test.kingdom');
    await sov2.appendGenesis('bob', k2.fingerprint);
    const ent = await makeEntity(home2, 'bob', '6', { entityKey: k2 });
    fs.mkdirSync(path.join(ent.idDir), { recursive: true });
    fs.writeFileSync(path.join(ent.idDir, '.gitignore'), [
      '# legacy id/.gitignore (pre-SPEC-240)',
      'devices/*/leaf.private.asc',
      'devices/*/device.key',
      '!devices/*/leaf.public.asc',
      '!entity.public.asc',
      '!entity.fingerprint',
      '!migrated-at',
      '!archive/**',
      '!.gitignore',
      '',
    ].join('\n'));
    const r2 = runInit(home2, ['bob', '--forceful']);
    eq(r2.code, 0, '§15 upgrade-path rotation exits 0');
    const rules = fs.readFileSync(path.join(ent.idDir, '.gitignore'), 'utf8');
    ok(!/^!archive\/\*\*$/m.test(rules), '§15 the superseded !archive/** rule is removed');
    ok(/^archive\/\*\*$/m.test(rules), '§15 the archive tree is denied by default');
    ok(/^!archive\/\*\*\/leaf\.public\.asc$/m.test(rules), '§15 the public half is admitted explicitly');
    ok(/^\*\.private\.asc$/m.test(rules), '§15 A-1 private keys are denied explicitly');
    ok(/^device\.key$/m.test(rules), '§15 A-1 device keys are denied explicitly');
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(72)}`);
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\n  Failures:');
  for (const f of failures) console.log(`    - ${f}`);
}
console.log(`${'='.repeat(72)}\n`);
process.exit(failed > 0 ? 1 : 0);
