// corpus-url-projector — URL reverse index for Dark Passenger
//
// Walks entity directories and extracts URL references from markdown files
// (briefs, tickler, memories, specs). Produces a JSONL file at
// ~/.vesta/data/corpus-url-index.jsonl and populates the CorpusURLIndex
// Mongo collection for API queries.
//
// SPEC-196 §8.1, mission: dark-passenger-corpus-url-projector-indexer-api-
//
// Gated on: KOAD_IO_INDEX_CORPUS_URL env var
// Runs: initial scan on Meteor.startup(), re-scans hourly via koad.workers

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOME = process.env.HOME || '/home/koad';
const OUTPUT_DIR = path.join(HOME, '.vesta', 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'corpus-url-index.jsonl');

// In-memory Mongo collection — same singleton the pluggable indexer projector will use
CorpusURLIndex = new Mongo.Collection('CorpusURLIndex', { connection: null });

// URL regex: matches https?://... URLs, stopping at whitespace, angle brackets, quotes, parens
const URL_REGEX = /https?:\/\/[^\s<>"')]+/g;

// GitHub shorthand ref: koad/<repo>#<number>
const GITHUB_REF_REGEX = /koad\/([\w.-]+)#(\d+)/g;

// Subdirectories to scan inside each entity/forge directory
const ENTITY_SCAN_SUBDIRS = ['briefs', 'tickler', 'memories', 'specs'];
const FORGE_SCAN_SUBDIRS = ['briefs', 'tickler', 'memories'];

// Type mapping: directory name → corpus item type
function dirToType(dirName) {
  switch (dirName) {
    case 'briefs': return 'brief';
    case 'tickler': return 'tickle';
    case 'memories': return 'memory';
    case 'specs': return 'spec';
    default: return 'other';
  }
}

// Default action label per type
function defaultAction(type) {
  switch (type) {
    case 'brief': return 'review brief';
    case 'tickle': return 'open in session';
    case 'memory': return 'view memory';
    case 'spec': return 'read spec';
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Frontmatter parser — lightweight YAML, handles inline scalars and lists
// ---------------------------------------------------------------------------

function parseFrontmatter(content) {
  if (!content || !content.startsWith('---')) return { fm: {}, body: content };

  const secondDelim = content.indexOf('\n---', 3);
  if (secondDelim === -1) return { fm: {}, body: content };

  const fmBlock = content.substring(3, secondDelim).trim();
  const body = content.substring(secondDelim + 4).trim();

  const fm = {};
  const lines = fmBlock.split('\n');
  let currentKey = null;
  let currentList = null;

  for (const line of lines) {
    // List item continuation: "  - value" under a current key
    const listMatch = line.match(/^\s{2}-\s+(.+)$/);
    if (listMatch && currentKey) {
      if (!currentList) {
        currentList = [];
        fm[currentKey] = currentList;
      }
      currentList.push(listMatch[1].trim());
      continue;
    }

    // New key
    currentList = null;
    const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const value = keyMatch[2].trim();
      if (value === '') {
        fm[currentKey] = undefined; // placeholder for list
      } else if (value === 'true') {
        fm[currentKey] = true;
      } else if (value === 'false') {
        fm[currentKey] = false;
      } else {
        fm[currentKey] = value;
      }
    }
  }

  // Convert undefined placeholders to empty arrays
  for (const [k, v] of Object.entries(fm)) {
    if (v === undefined) fm[k] = [];
  }

  return { fm, body };
}

// ---------------------------------------------------------------------------
// URL extraction from a single markdown file
// ---------------------------------------------------------------------------

function extractUrls(filePath, entity, type) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return [];
  }

  const { fm, body } = parseFrontmatter(content);
  const urls = new Set();
  const results = [];

  // Helper: add URL record
  function addUrl(url) {
    if (!url || typeof url !== 'string') return;
    const trimmed = url.trim();
    if (!trimmed) return;
    // Normalize
    let normalized = trimmed.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
    // Deduplicate within this file
    if (urls.has(normalized)) return;
    urls.add(normalized);

    // Extract domain
    let urlDomain = null;
    try {
      const u = new URL(trimmed);
      urlDomain = u.hostname;
    } catch (_) {
      // Not a valid URL — keep as-is but without domain extraction
      urlDomain = null;
    }

    const title = fm.title || fm.name || path.basename(filePath, '.md');
    const action = fm.action || defaultAction(type);

    // SHA-256 of entity+type+path+url for stable _id
    const idSeed = `${entity}|${type}|${filePath}|${normalized}`;
    const _id = crypto.createHash('sha256').update(idSeed).digest('hex').substring(0, 24);

    results.push({
      _id,
      url: trimmed,
      url_domain: urlDomain,
      normalized_url: normalized,
      entity,
      type,
      title,
      path: filePath,
      action,
      indexed_at: new Date().toISOString()
    });
  }

  // Pass 1: frontmatter url: field
  if (fm.url) addUrl(fm.url);

  // Pass 2: frontmatter urls: field (list)
  if (Array.isArray(fm.urls)) {
    for (const u of fm.urls) addUrl(u);
  }

  // Pass 3: frontmatter fields ending in _url (source_url, reference_url, etc.)
  // and the `related` field (URL-shaped values)
  for (const [key, value] of Object.entries(fm)) {
    if (key === 'url' || key === 'urls') continue;
    if (key.endsWith('_url') && typeof value === 'string') {
      addUrl(value);
    }
    if (key === 'related') {
      if (typeof value === 'string' && /^https?:\/\//.test(value)) {
        addUrl(value);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string' && /^https?:\/\//.test(item)) {
            addUrl(item);
          }
        }
      }
    }
  }

  // Pass 4: body text URL regex
  const bodyMatches = body.matchAll(URL_REGEX);
  for (const match of bodyMatches) {
    addUrl(match[0]);
  }

  // Pass 5: GitHub ref pattern (koad/<repo>#<number>)
  // Note: bodyMatches already caught most of these via https?:// prefix in body.
  // This pass catches the shorthand form in body text that isn't already a URL.
  const ghRefMatches = body.matchAll(GITHUB_REF_REGEX);
  for (const match of ghRefMatches) {
    const repo = match[1];
    const num = match[2];
    // Expand to full GitHub URLs
    addUrl(`https://github.com/koad/${repo}/issues/${num}`);
    addUrl(`https://github.com/koad/${repo}/pull/${num}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

/**
 * Recursively find all .md files in a directory
 */
function findMdFiles(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Recurse into subdirectories (e.g., tickler/open/, tickler/space/)
        results.push(...findMdFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  } catch (e) {
    // Permission error or missing dir — skip
  }
  return results;
}

/**
 * Scan a category directory (briefs, tickler, etc.) for an entity
 */
function scanCategory(catPath, entity, dirName) {
  const type = dirToType(dirName);
  const files = findMdFiles(catPath);
  const results = [];
  for (const filePath of files) {
    results.push(...extractUrls(filePath, entity, type));
  }
  return results;
}

/**
 * Discover entity directories (those containing ENTITY.md)
 */
function findEntityDirs() {
  const dirs = [];
  try {
    const entries = fs.readdirSync(HOME, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('.')) continue;
      const entityMdPath = path.join(HOME, entry.name, 'ENTITY.md');
      if (fs.existsSync(entityMdPath)) {
        dirs.push({ dir: path.join(HOME, entry.name), entity: entry.name.slice(1) });
      }
    }
  } catch (e) { /* skip */ }
  return dirs;
}

/**
 * Discover forge service directories
 */
function findForgeDirs() {
  const dirs = [];
  const forgePath = path.join(HOME, '.forge');
  try {
    if (fs.existsSync(forgePath)) {
      const entries = fs.readdirSync(forgePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push({ dir: path.join(forgePath, entry.name), entity: entry.name });
        }
      }
    }
  } catch (e) { /* skip */ }
  return dirs;
}

// ---------------------------------------------------------------------------
// Full scan — runs on startup and on schedule
// ---------------------------------------------------------------------------

function fullScan() {
  const allRecords = [];
  const entityDirs = findEntityDirs();
  const forgeDirs = findForgeDirs();

  // Scan entity directories
  for (const { dir, entity } of entityDirs) {
    for (const sub of ENTITY_SCAN_SUBDIRS) {
      const subPath = path.join(dir, sub);
      if (fs.existsSync(subPath)) {
        const records = scanCategory(subPath, entity, sub);
        allRecords.push(...records);
      }
    }
  }

  // Scan forge directories
  for (const { dir, entity } of forgeDirs) {
    for (const sub of FORGE_SCAN_SUBDIRS) {
      const subPath = path.join(dir, sub);
      if (fs.existsSync(subPath)) {
        const records = scanCategory(subPath, entity, sub);
        allRecords.push(...records);
      }
    }
  }

  // Write JSONL
  try {
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    const jsonlContent = allRecords.map(r => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(OUTPUT_FILE, jsonlContent);
    console.log(`[corpus-url-projector] Wrote ${allRecords.length} records to ${OUTPUT_FILE}`);
  } catch (e) {
    console.error(`[corpus-url-projector] Failed to write JSONL: ${e.message}`);
    return allRecords.length;
  }

  // Populate Mongo collection (upsert by _id)
  let upserted = 0;
  for (const record of allRecords) {
    try {
      const existing = CorpusURLIndex.findOne({ _id: record._id });
      if (existing) {
        CorpusURLIndex.update(record._id, { $set: record });
      } else {
        CorpusURLIndex.insert(record);
      }
      upserted++;
    } catch (e) {
      console.error(`[corpus-url-projector] Mongo upsert error: ${e.message}`);
    }
  }

  console.log(`[corpus-url-projector] Indexed ${upserted} records into CorpusURLIndex`);
  return allRecords.length;
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

Meteor.startup(() => {
  if (!process.env.KOAD_IO_INDEX_CORPUS_URL) {
    console.log('[corpus-url-projector] Inactive — set KOAD_IO_INDEX_CORPUS_URL=true to enable');
    return;
  }

  console.log('[corpus-url-projector] Starting initial scan...');
  const count = fullScan();
  console.log(`[corpus-url-projector] Initial scan complete: ${count} URL references indexed`);

  // Register hourly re-scan via koad.workers
  if (koad && koad.workers && koad.workers.start) {
    koad.workers.start({
      service: 'corpus-url-projector',
      type: 'worker',
      interval: 60, // hourly
      delay: 5,     // 5 minutes after boot
      runImmediately: false,
      task: async () => {
        const n = fullScan();
        console.log(`[corpus-url-projector] Scheduled re-scan: ${n} records`);
      }
    }).then(result => {
      if (result) {
        console.log(`[corpus-url-projector] Worker registered: ${result.workerId || result.service}`);
      } else {
        console.warn('[corpus-url-projector] Worker registration returned falsy — may be duplicate or failed');
      }
    }).catch(err => {
      console.error(`[corpus-url-projector] Worker registration failed: ${err.message}`);
    });
  } else {
    // Fallback: use Meteor.setInterval if workers package isn't available
    console.warn('[corpus-url-projector] koad.workers not available — falling back to setInterval');
    Meteor.setInterval(() => {
      fullScan();
    }, 60 * 60 * 1000); // hourly
  }
});
