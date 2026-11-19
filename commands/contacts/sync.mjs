#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// sync.mjs — scrape Keybase (read-only) into the canon contact store:
//
//   /kingdom/contacts/keybase/index.json                 { me, syncedAt, contacts:[...] }
//   /kingdom/contacts/keybase/<username>/profile.json    keybase id profile
//   /kingdom/contacts/keybase/<username>/index.json      { username, fullName, teams, repos }
//
// Contacts = the union of members across koad's teams (teams with >1 member), minus
// koad. Shared repos = repos of the teams a contact shares with koad, from
// `keybase git list`. Reads only; never writes to Keybase.
//
// This is the ONLY place Keybase is called. It runs on demand (`koad-io contacts
// sync`) or from the app's Resync button — never on a page load.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';

const run = promisify(execFile);
const ROOT = process.env.KOAD_IO_CONTACTS_DIR || '/kingdom/contacts/keybase';
const KB_TIMEOUT = 25000;
const MAX_TEAMS = 120;

async function kb(args) {
  const { stdout } = await run('keybase', args, { timeout: KB_TIMEOUT, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}
async function kbJson(args) { return JSON.parse(await kb(args)); }

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// Download an image to dest (follows redirects). Returns true on a non-empty file.
function download(url, dest) {
  return new Promise((resolve) => {
    const getter = url.startsWith('https') ? https.get : http.get;
    const req = getter(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest).then(resolve);
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(false); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (!buf.length) return resolve(false);
        writeAtomic(dest, buf);
        resolve(true);
      });
    });
    req.on('error', () => resolve(false));
    req.setTimeout(15000, () => { req.destroy(); resolve(false); });
  });
}

// GET a URL as text (follows redirects). Returns null on failure.
function getText(url) {
  return new Promise((resolve) => {
    const getter = url.startsWith('https') ? https.get : http.get;
    const req = getter(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return getText(res.headers.location).then(resolve);
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(b));
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
  });
}

function reposByTeamFromGitList(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s+\S+\s+keybase:\/\/team\/(\S+)\/(\S+)\s*$/);
    if (m) (out[m[1]] = out[m[1]] || []).push(m[2]);
  }
  return out;
}

async function main() {
  const status = await kbJson(['status', '--json']);
  const me = status.Username;
  if (!me) throw new Error('keybase is not logged in');

  const mem = await kbJson(['team', 'list-memberships', '--json']);
  let teams = (mem.teams || []).filter((t) => (t.member_count || 0) > 1);
  const seen = new Set();
  teams = teams.filter((t) => { if (seen.has(t.fq_name)) return false; seen.add(t.fq_name); return true; });
  teams = teams.slice(0, MAX_TEAMS);

  let repos = {};
  try { repos = reposByTeamFromGitList(await kb(['git', 'list'])); } catch (e) { repos = {}; }

  process.stderr.write(`contacts sync: me=${me}, ${teams.length} teams with >1 member\n`);

  // union of members, team by team
  const byUser = new Map();
  for (const t of teams) {
    let data;
    try { data = await kbJson(['team', 'list-members', t.fq_name, '--json']); } catch (e) { continue; }
    const groups = (data && data.members) || {};
    for (const role of Object.keys(groups)) {
      for (const u of (groups[role] || [])) {
        if (!u.username || u.username === me) continue;
        let c = byUser.get(u.username);
        if (!c) { c = { username: u.username, fullName: u.fullName || '', teams: new Set() }; byUser.set(u.username, c); }
        if (u.fullName && !c.fullName) c.fullName = u.fullName;
        c.teams.add(t.fq_name);
      }
    }
  }

  const contacts = [];
  const total = byUser.size;
  let n = 0;
  for (const c of byUser.values()) {
    n += 1;
    if (n % 10 === 0) process.stderr.write(`  profiles ${n}/${total}…\n`);
    let profile;
    try {
      const id = await kbJson(['id', c.username, '--json']);
      c.rawId = id;
      const p = id.profile || {};
      profile = {
        username: id.username || c.username,
        fullName: p.full_name || c.fullName || '',
        bio: p.bio || '',
        location: p.location || '',
        pictures: p.pictures || null,
        proofs: (id.proofs || []).map((x) => ({
          type: (x.proof && (x.proof.key || x.proof.proofType)) || '',
          value: (x.proof && x.proof.value) || '',
          state: x.result && x.result.proofResult ? x.result.proofResult.state : null,
        })).filter((x) => x.value),
        stellar: id.stellar && id.stellar.federationAddress ? id.stellar.federationAddress : null,
      };
    } catch (e) {
      profile = { username: c.username, fullName: c.fullName || '', bio: '', location: '', pictures: null, proofs: [], stellar: null };
    }

    const teamsArr = [...c.teams].sort();
    const sharedRepos = [];
    for (const team of teamsArr) {
      for (const r of (repos[team] || [])) sharedRepos.push({ team, repo: r, url: `keybase://team/${team}/${r}` });
    }

    contacts.push({ username: c.username, fullName: profile.fullName || c.fullName || '', teams: teamsArr, repos: sharedRepos, profile, rawId: c.rawId });
  }

  contacts.sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));

  fs.mkdirSync(ROOT, { recursive: true });

  // per-contact folders (+ a locally cached avatar.png, served at /keybase/<handle>.png)
  const live = new Set();
  let done = 0;
  for (const c of contacts) {
    done += 1;
    live.add(c.username);
    const dir = path.join(ROOT, c.username);
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(path.join(dir, 'profile.json'), JSON.stringify(c.profile, null, 2) + '\n');

    // raw identity, signature chain, proofs, and public PGP key (best-effort per contact)
    try { if (c.rawId) writeAtomic(path.join(dir, 'id.json'), JSON.stringify(c.rawId, null, 2) + '\n'); } catch (e) {}
    try {
      const sigs = await kbJson(['sigs', 'list', '-j', c.username]);
      writeAtomic(path.join(dir, 'sigchain.json'), JSON.stringify(sigs, null, 2) + '\n');
    } catch (e) {}
    try { writeAtomic(path.join(dir, 'proofs.json'), JSON.stringify(c.profile.proofs || [], null, 2) + '\n'); } catch (e) {}
    try {
      const pgpPath = path.join(dir, 'pgp.asc');
      const got = await download('https://keybase.io/' + c.username + '/pgp_keys.asc', pgpPath);
      if (!got) { try { fs.unlinkSync(pgpPath); } catch (e) {} }
    } catch (e) {}

    // Keybase serves every user's avatar at a deterministic URL (302 → S3 image);
    // `keybase id` does not carry pictures. Follow the redirect and cache it.
    const avatar = await download('https://keybase.io/' + c.username + '/picture?size=256', path.join(dir, 'avatar.png'));
    c.avatar = avatar;

    // real device list (names, types, keys) via the public lookup API
    try {
      const txt = await getText('https://keybase.io/_/api/1.0/user/lookup.json?username=' + c.username + '&fields=devices');
      if (txt) {
        const j = JSON.parse(txt);
        const src = j && j.them && j.them.devices ? Object.values(j.them.devices) : [];
        const devices = src.map((d) => ({
          name: d.name || '', type: d.type || '',
          when: d.ctime ? new Date(d.ctime * 1000).toISOString().slice(0, 10) : '',
          status: d.status === 1 ? 'active' : 'inactive',
          keys: (d.keys || []).length,
          eldestKid: (d.keys && d.keys[0] && d.keys[0].kid) || '',
        }));
        writeAtomic(path.join(dir, 'devices.json'), JSON.stringify({ devices }, null, 2) + '\n');
      }
    } catch (e) {}

    writeAtomic(path.join(dir, 'index.json'), JSON.stringify({ username: c.username, fullName: c.fullName, teams: c.teams, repos: c.repos, avatar }, null, 2) + '\n');
    if (done % 20 === 0) process.stderr.write(`  avatars ${done}/${contacts.length}…\n`);
  }

  // prune folders for people no longer shared (keep index.json + non-dirs)
  for (const name of fs.readdirSync(ROOT)) {
    if (name === 'index.json' || name.endsWith('.tmp')) continue;
    const p = path.join(ROOT, name);
    try { if (fs.statSync(p).isDirectory() && !live.has(name)) fs.rmSync(p, { recursive: true, force: true }); } catch (e) {}
  }

  const syncedAt = new Date().toISOString();
  writeAtomic(path.join(ROOT, 'index.json'), JSON.stringify({
    me,
    syncedAt,
    teamCount: teams.length,
    contacts: contacts.map((c) => ({ username: c.username, fullName: c.fullName, teams: c.teams, repos: c.repos, avatar: !!c.avatar })),
  }, null, 2) + '\n');

  process.stdout.write(JSON.stringify({ me, syncedAt, count: contacts.length, teamCount: teams.length }) + '\n');
  process.stderr.write(`contacts sync: wrote ${contacts.length} contacts to ${ROOT}\n`);
}

main().catch((e) => {
  process.stderr.write('contacts sync failed: ' + ((e && (e.stderr || e.message)) || e) + '\n');
  process.exit(1);
});
