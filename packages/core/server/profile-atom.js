/**
 * Vanity Atom Feed Endpoint — /<handle>.atom
 *
 * Reads ~/.<handle>/posts/ (folder-per-post, post.md with frontmatter)
 * and serves an Atom XML feed. Sorted by date descending, capped at 20.
 *
 * Brief: 2026-06-01-core-vanity-identity-endpoints
 */

import { WebApp } from 'meteor/webapp';

const os = Npm.require('os');
const fs = Npm.require('fs');
const path = Npm.require('path');
const crypto = Npm.require('crypto');

const home = os.homedir();
const _atomHandleRe = /^\/([a-z][a-z0-9_-]{0,30})\.atom$/;

// ── Simple frontmatter parser (flat key:value, sufficient for posts) ──
function parsePostFrontmatter(content) {
  if (!content || !content.startsWith('---')) return { fm: {}, body: content || '' };

  const secondDelim = content.indexOf('---', 3);
  if (secondDelim === -1) return { fm: {}, body: content };

  const fmBlock = content.substring(3, secondDelim).trim();
  const body = content.substring(secondDelim + 3).trim();

  const fm = {};
  for (const line of fmBlock.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (key && val) fm[key] = val;
  }
  return { fm, body };
}

// ── Deterministic UUID v5-ish (namespace + name → UUID-like) ──
function stableUUID(seed) {
  const hash = crypto.createHash('md5').update(seed).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '5' + hash.slice(13, 16),
    '8' + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

// ── XML escape ──
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ── Read posts ──
function readPosts(handle) {
  const postsDir = path.join(home, `.${handle}`, 'posts');
  const posts = [];

  let folders;
  try {
    folders = fs.readdirSync(postsDir, { withFileTypes: true });
  } catch (_) {
    return [];
  }

  for (const folder of folders) {
    if (!folder.isDirectory() || folder.name.startsWith('.')) continue;
    const postMdPath = path.join(postsDir, folder.name, 'post.md');
    try {
      const content = fs.readFileSync(postMdPath, 'utf8');
      const { fm, body } = parsePostFrontmatter(content);
      if (!fm.title) continue;

      posts.push({
        slug: folder.name,
        title: fm.title,
        date: fm.date || null,
        updated: fm.updated || fm.date || null,
        author: fm.author || null,
        type: fm.type || null,
        pillar: fm.pillar || null,
        status: fm.status || null,
        summary: body.slice(0, 300).replace(/^#.*$/m, '').trim(),
        body,
      });
    } catch (_) {
      // unreadable post — skip
    }
  }

  // Sort by date descending, cap at 20
  posts.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  return posts.slice(0, 20);
}

// ── Extract display name for feed title ──
function feedTitle(handle) {
  const entityMdPath = path.join(home, `.${handle}`, 'ENTITY.md');
  try {
    const content = fs.readFileSync(entityMdPath, 'utf8');
    // Try frontmatter name first
    if (content.startsWith('---')) {
      const secondDelim = content.indexOf('---', 3);
      if (secondDelim !== -1) {
        const fmBlock = content.substring(3, secondDelim);
        const nameMatch = fmBlock.match(/^name:\s*(.+)$/m);
        if (nameMatch) return `${nameMatch[1].trim()}'s Activity`;
      }
    }
    // Try H1
    const h1Match = content.match(/^# (.+)$/m);
    if (h1Match) return `${h1Match[1].trim()}'s Activity`;
  } catch (_) {}
  return `${handle}'s Activity`;
}

// ── Handler ──
WebApp.handlers.use((req, res, next) => {
  if (req.method !== 'GET') return next();

  const url = req.url.split('?')[0];
  const m = _atomHandleRe.exec(url);
  if (!m) return next();

  const handle = m[1];
  const entityDir = path.join(home, `.${handle}`);

  try {
    const stat = fs.statSync(entityDir);
    if (!stat.isDirectory()) return next();
  } catch (_) {
    return next();
  }

  const posts = readPosts(handle);
  const feedId = `urn:uuid:${stableUUID(`koad-io-feed:${handle}`)}`;
  const title = feedTitle(handle);
  const feedUpdated = posts.length > 0 && posts[0].date
    ? new Date(posts[0].date).toISOString()
    : new Date().toISOString();

  let xml = '<?xml version="1.0" encoding="utf-8"?>\n';
  xml += '<feed xmlns="http://www.w3.org/2005/Atom">\n';
  xml += `  <title>${esc(title)}</title>\n`;
  xml += `  <link href="https://kingofalldata.com/${esc(handle)}.atom" rel="self"/>\n`;
  xml += `  <link href="https://kingofalldata.com/${esc(handle)}"/>\n`;
  xml += `  <id>${feedId}</id>\n`;
  xml += `  <updated>${esc(feedUpdated)}</updated>\n`;

  for (const post of posts) {
    const entryId = `urn:uuid:${stableUUID(`koad-io-post:${handle}:${post.slug}`)}`;
    const entryDate = post.date ? new Date(post.date).toISOString() : feedUpdated;
    const entryUpdated = post.updated ? new Date(post.updated).toISOString() : entryDate;
    const postUrl = `https://kingofalldata.com/${esc(handle)}/posts/${esc(post.slug)}`;

    xml += '  <entry>\n';
    xml += `    <title>${esc(post.title)}</title>\n`;
    xml += `    <link href="${postUrl}"/>\n`;
    xml += `    <id>${entryId}</id>\n`;
    xml += `    <updated>${esc(entryUpdated)}</updated>\n`;
    if (post.author) {
      xml += `    <author><name>${esc(post.author)}</name></author>\n`;
    }
    if (post.summary) {
      xml += `    <summary>${esc(post.summary)}</summary>\n`;
    }
    xml += `    <content type="text">${esc(post.body)}</content>\n`;
    xml += '  </entry>\n';
  }

  xml += '</feed>\n';

  res.setHeader('Content-Type', 'application/atom+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200);
  res.end(xml);
});
