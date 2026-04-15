/*
 * koad:harness — OG / oembed meta-tag injector for namespace pages (juno#90)
 *
 * Problem: Meteor renders the same boilerplate HTML for every host. When a
 * crawler (Slackbot, Discordbot, Twitterbot, facebookexternalhit, LinkedInBot,
 * etc.) hits `juno.kingofalldata.com` it sees the bare-domain title/og:* tags
 * because Blaze hydration only runs in real browsers.
 *
 * Fix: a Meteor middleware that inspects the incoming Host header BEFORE the
 * boilerplate is rendered. If the subdomain matches a configured entity, we
 * either (a) hand crawlers a self-contained minimal HTML page with correct OG
 * tags, or (b) for real browsers, set `req.dynamicHead` so Meteor's webapp
 * boilerplate ships the right tags on first byte.
 *
 * Configure under each harness via `config.og`:
 *
 *   "og": {
 *     "enabled": true,
 *     "domain": "kingofalldata.com",
 *     "siteName": "kingofalldata.com",
 *     "defaultDescription": "A sovereign entity in the koad:io ecosystem",
 *     "entities": ["alice", "juno", "vulcan", "muse"]   // optional
 *   }
 *
 * Subdomain → entity handle is direct: `alice.kingofalldata.com` → `alice`.
 * `og.entities` defaults to the harness's `entities` list. List it separately
 * when the site should produce previews for entities it doesn't chat-host
 * (e.g. juno's namespace page on a site whose harness only chats with alice).
 * If the subdomain isn't in the resolved list, we no-op.
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

function buildOgTags(entity, ogConfig, prefix, host, url) {
  const proto = 'https';
  const siteName = ogConfig.siteName || ogConfig.domain || host;
  const title = entity.name
    ? `${entity.name} — ${siteName}`
    : siteName;
  const description = pickDescription(entity, ogConfig.defaultDescription || siteName);
  const avatarUrl = entity.avatarPath
    ? `${proto}://${host}${prefix.replace(/\/+$/, '')}/entities/${entity.handle}/avatar`
    : `${proto}://${host}/icons/icon-512.png`;
  const pageUrl = `${proto}://${host}${url || '/'}`;

  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:image" content="${escapeHtml(avatarUrl)}">`,
    `<meta property="og:url" content="${escapeHtml(pageUrl)}">`,
    `<meta property="og:type" content="profile">`,
    `<meta property="og:site_name" content="${escapeHtml(siteName)}">`,
    `<meta property="profile:username" content="${escapeHtml(entity.handle)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(avatarUrl)}">`,
  ];
  return { html: tags.join('\n    '), title, description, image: avatarUrl, url: pageUrl };
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
        const sub = getSubdomain(host);
        if (!sub) return next();
        if (!ogEntities.includes(sub)) return next();

        // Don't OG-inject API/asset routes — only HTML page loads
        const url = req.url || '/';
        if (url.startsWith('/harness/') || url.startsWith('/sockjs/') ||
            url.startsWith('/_oplog/') || url.startsWith('/__meteor__/') ||
            url.startsWith('/packages/') || url.startsWith('/cdn/') ||
            /\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|map|json|xml|txt)(\?|$)/i.test(url)) {
          return next();
        }

        let entity;
        try {
          entity = await KoadHarnessEntityLoader.getEntity(
            sub, instance.config.entityBaseDir, instance.config.cacheTTL || 300000
          );
        } catch (loadErr) {
          instance.logErr(`og-injector: load failed for ${sub}: ${loadErr.message}`);
          return next();
        }
        if (!entity) return next();

        const ogData = buildOgTags(entity, og, instance.prefix, host, url);
        const ua = req.headers['user-agent'] || '';

        // Crawler short-circuit: skip Meteor entirely, hand back small HTML.
        if (CRAWLER_UA.test(ua)) {
          instance.log(`og-injector: crawler hit host=${host} ua="${ua.slice(0, 60)}" entity=${sub}`);
          const body = buildCrawlerPage(ogData);
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
            'Cache-Control': 'public, max-age=300',
            'X-Koad-Og-Source': 'crawler-shortcircuit',
          });
          return res.end(body);
        }

        // Real browser: hand the head fragment to Meteor's boilerplate.
        // WebApp's getBoilerplate inlines `req.dynamicHead` into the rendered head.
        // Meteor will dedupe its own default <title> if we provide one — but it
        // doesn't strip duplicate <meta property="og:*">. The client-side
        // template-defined <meta id="og-title"> et al will still be in the body
        // of <head>; we ship ours later in the head so they take precedence for
        // crawlers that read the LAST-defined value (most do not — they read
        // the FIRST). To guarantee correctness, we emit OG tags into dynamicHead
        // BEFORE the boilerplate's own static tags by virtue of how the
        // boilerplate template is structured (dynamicHead is appended after
        // <head> opens but before app templates render). For full safety we
        // also short-circuit crawlers above.
        req.dynamicHead = (req.dynamicHead || '') + ogData.html;
        res.setHeader('X-Koad-Og-Source', 'dynamic-head');
        return next();
      } catch (err) {
        instance.logErr(`og-injector error: ${err.message}`);
        return next();
      }
    });

    // Use connectHandlers (not rawConnectHandlers) so we run inside Meteor's
    // boilerplate pipeline and `req.dynamicHead` is honored.
    WebApp.connectHandlers.use(handler);
    instance.log(`og-injector: installed for domain=${og.domain} entities=[${ogEntities.join(', ')}]`);
  },

  // Exported for testing
  _internal: { getSubdomain, pickDescription, buildOgTags, buildCrawlerPage, escapeHtml, CRAWLER_UA },
};
