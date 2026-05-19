// Repo scanner — env-gated via KOAD_IO_INDEX_REPOS
// Walks kingdom folders for .git directories and indexes every repo:
//   path, remote origin, auth type, push access, branch, dirty, ahead/behind, last commit
// Publishes a Repositories collection so dashboards can render the full picture.

if (!process.env.KOAD_IO_INDEX_REPOS) return;

const fs = Npm.require('fs');
const path = Npm.require('path');
const { execFileSync } = Npm.require('child_process');

const HOME = process.env.HOME || '/home/koad';
const SCAN_INTERVAL_MS = 2 * 60 * 1000;
const GIT_TIMEOUT_MS = 2000;

const Repositories = new Mongo.Collection('Repositories', { connection: null });

// Run a git command in a directory, return stdout or null on failure
function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (e) {
    return null;
  }
}

// Classify the remote URL into an auth type
function classifyAuth(url) {
  if (!url) return 'none';
  if (url.startsWith('keybase://')) return 'keybase';
  if (url.startsWith('git@') || url.match(/^ssh:\/\//)) return 'ssh';
  if (url.startsWith('https://') || url.startsWith('http://')) return 'https';
  return 'local';
}

// Determine whether push is likely authenticated for this remote type
function canPush(authType, url) {
  if (authType === 'keybase') return true;
  if (authType === 'ssh') return true;
  if (authType === 'https') {
    // GitHub HTTPS with token or credential helper — assume yes if origin is set
    return !!url;
  }
  if (authType === 'local') return true;
  return false;
}

// Derive a human-readable category from the repo path
function categorize(repoPath) {
  const rel = repoPath.startsWith(HOME) ? repoPath.slice(HOME.length + 1) : repoPath;
  if (rel.startsWith('.koad-io/packages/')) return 'framework-package';
  if (rel.startsWith('.koad-io/')) return 'framework';
  if (rel.startsWith('.forge/packages/')) return 'forge-package';
  if (rel.startsWith('.forge/websites/')) return 'website';
  if (rel.startsWith('.forge/')) return 'forge';
  if (rel.match(/^\.[^/]+$/)) return 'entity';
  return 'other';
}

// Derive a short name from the repo path
function repoName(repoPath) {
  const rel = repoPath.startsWith(HOME) ? repoPath.slice(HOME.length + 1) : repoPath;
  return rel.replace(/^\./, '');
}

// Read repo state for a single git directory
function readRepo(repoPath) {
  const origin = git(repoPath, ['remote', 'get-url', 'origin']);
  const branch = git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const authType = classifyAuth(origin);

  // Dirty: any uncommitted changes (staged or unstaged)
  const statusOutput = git(repoPath, ['status', '--porcelain']);
  const dirty = statusOutput !== null && statusOutput.length > 0;

  // Ahead/behind tracking branch
  let ahead = 0, behind = 0;
  const tracking = git(repoPath, ['rev-parse', '--abbrev-ref', '@{upstream}']);
  if (tracking) {
    const counts = git(repoPath, ['rev-list', '--left-right', '--count', `${tracking}...HEAD`]);
    if (counts) {
      const parts = counts.split(/\s+/);
      behind = parseInt(parts[0], 10) || 0;
      ahead = parseInt(parts[1], 10) || 0;
    }
  }

  // Last commit timestamp
  let lastCommit = null;
  const ts = git(repoPath, ['log', '-1', '--format=%ct']);
  if (ts) {
    const epoch = parseInt(ts, 10);
    if (epoch && !isNaN(epoch)) lastCommit = new Date(epoch * 1000);
  }

  // Last commit message (first line)
  const lastMessage = git(repoPath, ['log', '-1', '--format=%s']);

  return {
    path: repoPath,
    name: repoName(repoPath),
    category: categorize(repoPath),
    origin: origin || null,
    authType,
    pushAuth: canPush(authType, origin),
    branch: branch || null,
    dirty,
    ahead,
    behind,
    lastCommit,
    lastMessage: lastMessage || null,
  };
}

// Find all .git directories under a root (non-recursive past .git)
function findGitRepos(root, maxDepth) {
  const repos = [];

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }

    for (const entry of entries) {
      if (entry.name === '.git') {
        repos.push(dir);
        return; // don't recurse into child repos
      }
      // Skip noise dirs
      if (entry.name === 'node_modules' || entry.name === '.meteor' ||
          entry.name === '.npm' || entry.name === 'dist' ||
          entry.name === '.trash' || entry.name === '.archive') continue;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        walk(path.join(dir, entry.name), depth + 1);
      }
    }
  }

  walk(root, 0);
  return repos;
}

// Gather all repos across the kingdom
function discoverRepos() {
  const repoPaths = new Set();

  // 1. Entity dirs — ~/.<name> (top-level only, depth 0)
  try {
    const homeEntries = fs.readdirSync(HOME);
    for (const entry of homeEntries) {
      if (!entry.startsWith('.')) continue;
      if (entry === '.koad-io' || entry === '.forge') continue; // handled below with deeper walks
      const full = path.join(HOME, entry);
      try {
        if (!fs.statSync(full).isDirectory()) continue;
        const gitDir = path.join(full, '.git');
        if (fs.existsSync(gitDir)) repoPaths.add(full);
      } catch (e) {}
    }
  } catch (e) {}

  // 2. Framework — ~/.koad-io itself + packages/* (depth 1)
  const koadIoDir = path.join(HOME, '.koad-io');
  if (fs.existsSync(path.join(koadIoDir, '.git'))) repoPaths.add(koadIoDir);
  for (const repo of findGitRepos(path.join(koadIoDir, 'packages'), 1)) repoPaths.add(repo);
  for (const repo of findGitRepos(path.join(koadIoDir, 'daemon'), 1)) repoPaths.add(repo);
  for (const repo of findGitRepos(path.join(koadIoDir, 'modules'), 1)) repoPaths.add(repo);

  // 3. Forge — ~/.forge itself + packages/*, websites/*, services/* (depth 1)
  const forgeDir = path.join(HOME, '.forge');
  if (fs.existsSync(path.join(forgeDir, '.git'))) repoPaths.add(forgeDir);
  for (const sub of ['packages', 'websites', 'services', 'dance-hall', 'control-tower']) {
    for (const repo of findGitRepos(path.join(forgeDir, sub), 1)) repoPaths.add(repo);
  }

  return Array.from(repoPaths).sort();
}

// Sync the Repositories collection with disk state
function syncRepos() {
  const paths = discoverRepos();
  const knownPaths = new Set(Repositories.find().fetch().map(r => r.path));
  const foundPaths = new Set();

  for (const repoPath of paths) {
    foundPaths.add(repoPath);
    const data = readRepo(repoPath);
    data.scannedAt = new Date();

    if (!knownPaths.has(repoPath)) {
      data.detectedAt = new Date();
      Repositories.insert(data);
    } else {
      Repositories.update({ path: repoPath }, { $set: data });
    }
  }

  // Remove repos that disappeared from disk
  Repositories.find().fetch().forEach(repo => {
    if (!foundPaths.has(repo.path)) {
      Repositories.remove(repo._id);
      console.log(`[REPOS] - ${repo.name}`);
    }
  });
}

// Startup
Meteor.startup(() => {
  koad.ready.register('repos');
  syncRepos();
  const count = Repositories.find().count();
  console.log(`[REPOS] Initial scan complete: ${count} repositories`);
  koad.ready.signal('repos');

  // Periodic rescan
  Meteor.setInterval(() => syncRepos(), SCAN_INTERVAL_MS);
});

// Publications
Meteor.publish('repositories', async function () {
  await koad.ready.await('repos');
  return Repositories.find({}, { sort: { category: 1, name: 1 } });
});

Meteor.publish('repositories.byCategory', async function (category) {
  check(category, String);
  await koad.ready.await('repos');
  return Repositories.find({ category }, { sort: { name: 1 } });
});

// Export for other indexers or MCP tools
RepoScanner = { Repositories, syncRepos, discoverRepos };
