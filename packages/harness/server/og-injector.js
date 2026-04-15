/*
 * koad:harness — OG / oembed meta-tag injector (juno#90, phases 1 + 2)
 *
 * Problem: Meteor renders the same boilerplate HTML for every URL. Lazy
 * crawlers (Slackbot, Discordbot, Twitterbot, facebookexternalhit, LinkedInBot,
 * etc.) do not execute JS, so they see the bare app shell regardless of
 * subdomain or path. Result: every link preview looks the same.
 *
 * Fix: a Meteor middleware that, before Meteor's boilerplate renders, decides
 * what document the URL represents and emits proper OG/oembed/twitter tags
 * (plus a theme-color from `data.outfit` if present). For crawler UAs we ship
 * a self-contained minimal HTML page; for real browsers we append the tags
 * to `req.dynamicHead` so they land in the very first byte.
 *
 * Phase 1 (shipped 2026-04-14) keyed off `Host` → entity. Phase 2 generalises
 * that to a small registry of URL patterns so any route that represents a
 * document — `/parties/:id`, `/posts/:slug`, `/docs/:path*` — can self-describe
 * its preview from the document it would render.
 *
 * --------------------------------------------------------------------------
 * Resolution order (first match wins, then crawler/dynamic-head fork)
 *
 *   1. Registered patterns (most-specific-first, ordered by registration but
 *      sorted by specificity) — `KoadHarnessOgInjector.registerPattern(...)`
 *   2. Host → entity (phase 1)                            — namespace pages
 *   3. Site defaults from `og.defaults` / `og.siteName`  — never blank
 *
 * --------------------------------------------------------------------------
 * Registering a pattern (server-side, at app boot)
 *
 *   KoadHarnessOgInjector.registerPattern({
 *     path: '/parties/:id',
 *     resolve(params, req) {            // sync or async
 *       return Parties.findOne(params.id);
 *     },
 *     toOg(doc, req) {
 *       return {
 *         title: doc.name,
 *         description: doc.summary,
 *         image: `/parties/${doc._id}/cover`,   // absolute URL, or path (we'll absolutise)
 *         type: 'article',
 *         outfit: doc.outfit,                    // optional → emits theme-color
 *       };
 *     },
 *   });
 *
 * `resolve()` returning null/undefined means "no document at this URL" and we
 * fall through to the next layer (eventually site defaults).
 *
 * --------------------------------------------------------------------------
 * Settings shape (unchanged from phase 1, plus optional defaults)
 *
 *   "og": {
 *     "enabled": true,
 *     "domain": "kingofalldata.com",
 *     "siteName": "kingofalldata.com",
 *     "defaultDescription": "...",
 *     "entities": ["alice", "juno", ...],
 *     "defaults": {                              // phase 2 — site-wide fallback
 *       "title": "kingofalldata.com",
 *       "description": "The entry point for a sovereign web",
 *       "image": "/icons/icon-512.png",
 *       "type": "website",
 *       "outfit": { "h": 31, "s": 34 }
 *     }
 *   }
 */

const CRAWLER_UA = /(Slackbot|Discordbot|Twitterbot|facebookexternalhit|LinkedInBot|TelegramBot|WhatsApp|Applebot|Mastodon|Pleroma|Akkoma|Iframely|embedly|SkypeUriPreview|redditbot|Bingbot|Googlebot|DuckDuckBot|YandexBot|Baiduspider|MetaInspector|OpenGraphCheck)/i;

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getSubdomain(host) {
  if (!host) return null;
  const hostname = host.split(':')[0].toLowerCase();
  const parts = hostname.split('.');
  if (parts.length <= 2) return null; // bare domain — leave it to default tags
  return parts[0];
}

function pickDescription(entity, fallback) {
  // Prefer first non-empty paragraph of landing.md, else role, else fallback.
  if (entity.landingMd) {
    const para = entity.landingMd
      .split(/\n\s*\n/)
      .map(s => s.trim())
      .find(s => s && !s.startsWith('#'));
    if (para) {
      // Trim to ~200 chars, end on word boundary
      const flat = para.replace(/\s+/g, ' ');
      if (flat.length <= 200) return flat;
      return flat.slice(0, 197).replace(/\s+\S*$/, '') + '…';
    }
  }
  if (entity.role) return entity.role;
  return fallback;
}

// --- Pattern matching ---------------------------------------------------
//
// Mirrors koad:io-router's `compilePath` (path-to-regexp v1) so registered
// patterns look like Iron Router routes. We don't depend on the router
// package — the harness has to work in apps that don't use it — but we
// follow the same conventions: `:name`, `:name?`, `:name*`, `(\\d+)` etc.

function compilePattern(path) {
  const keys = [];
  // Specificity = literal segment count (no params). Used to sort patterns so
  // `/parties/featured` wins over `/parties/:id`.
  let literalSegments = 0;
  const segments = path.split('/').filter(Boolean);
  for (const seg of segments) {
    if (!seg.includes(':') && !seg.includes('(') && !seg.includes('*')) {
      literalSegments++;
    }
  }
  // Build regex: `:name` → `([^/]+)`, `:name?` → optional, `:name*` → greedy.
  let source = '^';
  for (const seg of segments) {
    source += '/';
    // Match `:name` with optional `?` or `*` suffix
    const m = seg.match(/^:(\w+)([?*+]?)$/);
    if (m) {
      const [, name, suffix] = m;
      keys.push({ name, optional: suffix === '?' || suffix === '*', repeat: suffix === '*' || suffix === '+' });
      if (suffix === '*' || suffix === '+') {
        // greedy across slashes
        source = source.slice(0, -1); // drop the leading slash we just added
        source += suffix === '*' ? '(?:/(.*))?' : '/(.+)';
      } else if (suffix === '?') {
        source = source.slice(0, -1);
        source += '(?:/([^/]+))?';
      } else {
        source += '([^/]+)';
      }
    } else {
      // Literal segment — escape regex metacharacters
      source += seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  if (source === '^') source += '/?'; // root path
  source += '/?$';
  return { regex: new RegExp(source, 'i'), keys, literalSegments, raw: path };
}

function matchPattern(compiled, url) {
  // Strip query string before matching
  const path = url.split('?')[0];
  const m = compiled.regex.exec(path);
  if (!m) return null;
  const params = {};
  compiled.keys.forEach((key, i) => {
    const val = m[i + 1];
    if (val !== undefined) params[key.name] = decodeURIComponent(val);
  });
  return params;
}

// --- Outfit → theme-color ------------------------------------------------

function hslToHex(h, s, l) {
  // h: 0-360, s: 0-100, l: 0-100 (defaulted to 50 — mid-luminance for theme)
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs(hp % 2 - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = ln - c / 2;
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function outfitToThemeColor(outfit) {
  if (!outfit || typeof outfit !== 'object') return null;
  // Accept both canonical {h,s} and legacy {hue,saturation,brightness}
  const h = outfit.h !== undefined ? outfit.h : (outfit.hue !== undefined ? outfit.hue : null);
  const s = outfit.s !== undefined ? outfit.s : (outfit.saturation !== undefined ? outfit.saturation : null);
  if (h === null || s === null) return null;
  // brightness/lightness defaults to 50 for theme-color usage
  const l = outfit.l !== undefined ? outfit.l : (outfit.brightness !== undefined ? outfit.brightness : 50);
  return hslToHex(Number(h), Number(s), Number(l));
}

// --- Tag rendering -------------------------------------------------------

function absolutiseUrl(maybeUrl, host) {
  if (!maybeUrl) return null;
  if (/^https?:\/\//i.test(maybeUrl)) return maybeUrl;
  const path = maybeUrl.startsWith('/') ? maybeUrl : '/' + maybeUrl;
  return `https://${host}${path}`;
}

function renderOgHtml(og, host, url) {
  // Universal renderer — accepts a normalised OG object and emits tags.
  // og: { title, description, image, type, url, siteName, username, outfit, extra }
  const proto = 'https';
  const pageUrl = og.url || `${proto}://${host}${url || '/'}`;
  const image = absolutiseUrl(og.image, host) || `${proto}://${host}/icons/icon-512.png`;
  const tags = [
    `<title>${escapeHtml(og.title)}</title>`,
    `<meta name="description" content="${escapeHtml(og.description)}">`,
    `<meta property="og:title" content="${escapeHtml(og.title)}">`,
    `<meta property="og:description" content="${escapeHtml(og.description)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    `<meta property="og:url" content="${escapeHtml(pageUrl)}">`,
    `<meta property="og:type" content="${escapeHtml(og.type || 'website')}">`,
    `<meta property="og:site_name" content="${escapeHtml(og.siteName || host)}">`,
  ];
  if (og.username) {
    tags.push(`<meta property="profile:username" content="${escapeHtml(og.username)}">`);
  }
  tags.push(`<meta name="twitter:card" content="summary_large_image">`);
  tags.push(`<meta name="twitter:title" content="${escapeHtml(og.title)}">`);
  tags.push(`<meta name="twitter:description" content="${escapeHtml(og.description)}">`);
  tags.push(`<meta name="twitter:image" content="${escapeHtml(image)}">`);
  // Outfit → theme-color (self-describing data all the way down)
  const themeColor = outfitToThemeColor(og.outfit);
  if (themeColor) {
    tags.push(`<meta name="theme-color" content="${escapeHtml(themeColor)}">`);
  }
  if (Array.isArray(og.extra)) {
    for (const tag of og.extra) tags.push(String(tag));
  }
  return { html: tags.join('\n    '), title: og.title, description: og.description, image, url: pageUrl };
}

function buildOgTags(entity, ogConfig, prefix, host, url) {
  // Phase 1 entry point — entity → OG. Now delegates to renderOgHtml.
  const siteName = ogConfig.siteName || ogConfig.domain || host;
  const title = entity.name ? `${entity.name} — ${siteName}` : siteName;
  const description = pickDescription(entity, ogConfig.defaultDescription || siteName);
  const image = entity.avatarPath
    ? `https://${host}${prefix.replace(/\/+$/, '')}/entities/${entity.handle}/avatar`
    : null;
  return renderOgHtml({
    title,
    description,
    image,
    type: 'profile',
    url: `https://${host}${url || '/'}`,
    siteName,
    username: entity.handle,
    outfit: entity.outfit,
  }, host, url);
}

function buildSiteDefaultTags(ogConfig, host, url) {
  const siteName = ogConfig.siteName || ogConfig.domain || host;
  const defaults = ogConfig.defaults || {};
  return renderOgHtml({
    title: defaults.title || siteName,
    description: defaults.description || ogConfig.defaultDescription || siteName,
    image: defaults.image || null,
    type: defaults.type || 'website',
    url: `https://${host}${url || '/'}`,
    siteName,
    outfit: defaults.outfit,
  }, host, url);
}

function buildPatternTags(toOgResult, ogConfig, host, url) {
  // toOgResult is whatever the app's `toOg(doc, req)` returned — a free-form
  // OG-shaped object. We normalise and merge in site-level fallbacks.
  if (!toOgResult || typeof toOgResult !== 'object') return null;
  const siteName = ogConfig.siteName || ogConfig.domain || host;
  return renderOgHtml({
    title: toOgResult.title || siteName,
    description: toOgResult.description || ogConfig.defaultDescription || siteName,
    image: toOgResult.image || null,
    type: toOgResult.type || 'article',
    url: toOgResult.url || `https://${host}${url || '/'}`,
    siteName: toOgResult.siteName || siteName,
    username: toOgResult.username,
    outfit: toOgResult.outfit,
    extra: toOgResult.extra,
  }, host, url);
}

function buildCrawlerPage(og) {
  // Self-contained minimal HTML, no JS, no CSS — exactly what crawlers want.
  return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    ${og.html}
</head>
<body>
    <h1>${escapeHtml(og.title)}</h1>
    <p>${escapeHtml(og.description)}</p>
    <p><a href="${escapeHtml(og.url)}">${escapeHtml(og.url)}</a></p>
</body>
</html>
`;
}

// --- Pattern registry (process-wide, shared across HarnessInstances) -----

const _patterns = []; // [{ compiled, resolve, toOg }]

function registerPattern({ path, resolve, toOg }) {
  if (!path || typeof path !== 'string') {
    throw new Error('registerPattern: `path` (string) is required');
  }
  if (typeof resolve !== 'function') {
    throw new Error('registerPattern: `resolve(params, req)` is required');
  }
  if (typeof toOg !== 'function') {
    throw new Error('registerPattern: `toOg(doc, req)` is required');
  }
  const compiled = compilePattern(path);
  _patterns.push({ compiled, resolve, toOg });
  // Sort most-specific-first by literal-segment count, then by registration
  // order (stable). More literals = higher specificity.
  _patterns.sort((a, b) => b.compiled.literalSegments - a.compiled.literalSegments);
  return compiled;
}

function clearPatterns() {
  _patterns.length = 0;
}

async function findPatternMatch(url, req) {
  for (const entry of _patterns) {
    const params = matchPattern(entry.compiled, url);
    if (!params) continue;
    let doc;
    try {
      doc = await entry.resolve(params, req);
    } catch (err) {
      // Resolver errors don't crash the page — log + fall through.
      console.error(`[og-injector] pattern resolver threw for ${entry.compiled.raw}:`, err.message);
      continue;
    }
    if (!doc) continue; // resolver said "no document here" — try next pattern
    let ogShape;
    try {
      ogShape = entry.toOg(doc, req);
    } catch (err) {
      console.error(`[og-injector] pattern toOg threw for ${entry.compiled.raw}:`, err.message);
      continue;
    }
    if (!ogShape) continue;
    return { ogShape, params, pattern: entry.compiled.raw };
  }
  return null;
}

KoadHarnessOgInjector = {
  /**
   * Install the middleware. Called once per HarnessInstance from harness.js.
   * @param {Object} instance — HarnessInstance with config { entities, entityBaseDir, cacheTTL, og, path }
   */
  install(instance) {
    const og = instance.config.og;
    if (!og || og.enabled === false) {
      instance.log('og-injector: disabled (set og.enabled=true to turn on)');
      return;
    }
    if (!og.domain) {
      instance.logErr('og-injector: og.domain is required — refusing to install');
      return;
    }

    const ogEntities = (og.entities && og.entities.length)
      ? og.entities
      : instance.config.entities;

    const handler = Meteor.bindEnvironment(async (req, res, next) => {
      try {
        const host = req.headers.host;
        const url = req.url || '/';

        // Don't OG-inject API/asset routes — only HTML page loads
        if (url.startsWith('/harness/') || url.startsWith('/sockjs/') ||
            url.startsWith('/_oplog/') || url.startsWith('/__meteor__/') ||
            url.startsWith('/packages/') || url.startsWith('/cdn/') ||
            /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|map|json|xml|txt)(\?|$)/i.test(url)) {
          return next();
        }

        let ogData = null;
        let source = null;

        // (1) Most-specific-first: registered patterns
        const patternHit = await findPatternMatch(url, req);
        if (patternHit) {
          ogData = buildPatternTags(patternHit.ogShape, og, host, url);
          source = `pattern:${patternHit.pattern}`;
        }

        // (2) Phase 1: Host → entity
        if (!ogData) {
          const sub = getSubdomain(host);
          if (sub && ogEntities.includes(sub)) {
            try {
              const entity = await KoadHarnessEntityLoader.getEntity(
                sub, instance.config.entityBaseDir, instance.config.cacheTTL || 300000
              );
              if (entity) {
                ogData = buildOgTags(entity, og, instance.prefix, host, url);
                source = `entity:${sub}`;
              }
            } catch (loadErr) {
              instance.logErr(`og-injector: load failed for ${sub}: ${loadErr.message}`);
            }
          }
        }

        // (3) Site defaults — only short-circuit crawlers when configured.
        // For non-crawlers we leave Meteor's boilerplate untouched (it already
        // has the site's default tags from templates.html).
        if (!ogData) {
          const ua = req.headers['user-agent'] || '';
          if (CRAWLER_UA.test(ua) && og.defaults) {
            ogData = buildSiteDefaultTags(og, host, url);
            source = 'site-defaults';
          } else {
            return next();
          }
        }

        const ua = req.headers['user-agent'] || '';

        // Crawler short-circuit: skip Meteor entirely, hand back small HTML.
        if (CRAWLER_UA.test(ua)) {
          instance.log(`og-injector: crawler hit host=${host} url=${url} ua="${ua.slice(0, 60)}" source=${source}`);
          const body = buildCrawlerPage(ogData);
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
            'Cache-Control': 'public, max-age=300',
            'X-Koad-Og-Source': 'crawler-shortcircuit',
            'X-Koad-Og-Match': source,
          });
          return res.end(body);
        }

        // Real browser: hand the head fragment to Meteor's boilerplate.
        // dynamicHead is appended near the top of <head>, so our tags appear
        // before any static `<meta id="og-*">` from templates.html — which
        // matters for crawlers that read the FIRST occurrence (most do).
        req.dynamicHead = (req.dynamicHead || '') + ogData.html;
        res.setHeader('X-Koad-Og-Source', 'dynamic-head');
        res.setHeader('X-Koad-Og-Match', source);
        return next();
      } catch (err) {
        instance.logErr(`og-injector error: ${err.message}`);
        return next();
      }
    });

    // Use connectHandlers (not rawConnectHandlers) so we run inside Meteor's
    // boilerplate pipeline and `req.dynamicHead` is honored.
    WebApp.connectHandlers.use(handler);
    instance.log(`og-injector: installed for domain=${og.domain} entities=[${ogEntities.join(', ')}] patterns=${_patterns.length}`);
  },

  /**
   * Register a URL pattern → data resolver → OG mapper.
   * See file header for examples. Patterns are matched most-specific-first
   * (by literal-segment count) and fall through to entity/site-default logic.
   *
   * @param {Object} spec
   * @param {string} spec.path — e.g. '/parties/:id', '/posts/:slug', '/docs/:path*'
   * @param {Function} spec.resolve — (params, req) => doc | Promise<doc> | null
   * @param {Function} spec.toOg — (doc, req) => { title, description, image, type, outfit, ... }
   */
  registerPattern,

  /** Number of registered patterns (introspection / tests). */
  get patternCount() { return _patterns.length; },

  // Exported for testing
  _internal: {
    getSubdomain, pickDescription, buildOgTags, buildCrawlerPage, escapeHtml,
    CRAWLER_UA, compilePattern, matchPattern, hslToHex, outfitToThemeColor,
    renderOgHtml, buildSiteDefaultTags, buildPatternTags, findPatternMatch,
    clearPatterns,
  },
};
