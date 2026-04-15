/* global Tinytest, KoadHarnessOgInjector */
// Tests for the juno#90 OG/oembed injector.
//
// Phase 1 coverage: subdomain extraction, description, tag generation,
// crawler page, crawler UA detection.
// Phase 2 coverage: pattern compilation/matching, sync + async resolvers,
// pattern → entity → site-defaults fallback chain, outfit → theme-color,
// missing-resolver-data fallthrough.

const {
  getSubdomain, pickDescription, buildOgTags, buildCrawlerPage, escapeHtml,
  CRAWLER_UA, compilePattern, matchPattern, hslToHex, outfitToThemeColor,
  renderOgHtml, buildSiteDefaultTags, buildPatternTags, findPatternMatch,
  clearPatterns,
} = KoadHarnessOgInjector._internal;

// ---------------------------------------------------------------------------
// Phase 1 (preserved)
// ---------------------------------------------------------------------------

Tinytest.add('og-injector - getSubdomain - extracts subdomain', function (test) {
  test.equal(getSubdomain('alice.kingofalldata.com'), 'alice');
  test.equal(getSubdomain('Alice.kingofalldata.com'), 'alice');
  test.equal(getSubdomain('alice.kingofalldata.com:443'), 'alice');
});

Tinytest.add('og-injector - getSubdomain - bare domain returns null', function (test) {
  test.equal(getSubdomain('kingofalldata.com'), null);
  test.equal(getSubdomain('localhost'), null);
  test.equal(getSubdomain(''), null);
  test.equal(getSubdomain(null), null);
});

Tinytest.add('og-injector - escapeHtml - covers all dangerous chars', function (test) {
  test.equal(escapeHtml('<script>"&\'</script>'), '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
  test.equal(escapeHtml(null), '');
  test.equal(escapeHtml(undefined), '');
});

Tinytest.add('og-injector - pickDescription - prefers landing first paragraph', function (test) {
  const entity = {
    landingMd: '# Heading\n\nFirst paragraph here, the good stuff.\n\nSecond paragraph.',
    role: 'a role',
  };
  test.equal(pickDescription(entity, 'fallback'), 'First paragraph here, the good stuff.');
});

Tinytest.add('og-injector - pickDescription - skips heading lines', function (test) {
  const entity = { landingMd: '# Title\n## Subtitle\n\nReal content.' };
  test.equal(pickDescription(entity, 'fallback'), 'Real content.');
});

Tinytest.add('og-injector - pickDescription - truncates long paragraphs at word boundary', function (test) {
  const long = 'word '.repeat(60).trim();
  const out = pickDescription({ landingMd: long }, 'fallback');
  test.isTrue(out.length <= 200);
  test.isTrue(out.endsWith('…'));
});

Tinytest.add('og-injector - pickDescription - falls back to role then default', function (test) {
  test.equal(pickDescription({ role: 'mother' }, 'def'), 'mother');
  test.equal(pickDescription({}, 'def'), 'def');
});

Tinytest.add('og-injector - buildOgTags - shape and content', function (test) {
  const entity = {
    handle: 'alice',
    name: 'Alice',
    role: 'walks people home',
    avatarPath: '/home/koad/.alice/avatar.png',
    landingMd: 'Hi, I help.',
  };
  const og = { domain: 'kingofalldata.com', siteName: 'kingofalldata.com', defaultDescription: 'def' };
  const out = buildOgTags(entity, og, '/harness/alice', 'alice.kingofalldata.com', '/');
  test.equal(out.title, 'Alice — kingofalldata.com');
  test.equal(out.description, 'Hi, I help.');
  test.equal(out.image, 'https://alice.kingofalldata.com/harness/alice/entities/alice/avatar');
  test.equal(out.url, 'https://alice.kingofalldata.com/');
  test.isTrue(out.html.includes('<title>Alice'));
  test.isTrue(out.html.includes('og:type" content="profile"'));
  test.isTrue(out.html.includes('profile:username" content="alice"'));
  test.isTrue(out.html.includes('twitter:card'));
});

Tinytest.add('og-injector - buildOgTags - falls back to site icon when no avatar', function (test) {
  const entity = { handle: 'ghost', name: 'Ghost', avatarPath: null };
  const og = { domain: 'kingofalldata.com' };
  const out = buildOgTags(entity, og, '/harness/x', 'ghost.kingofalldata.com', '/');
  test.isTrue(out.image.endsWith('/icons/icon-512.png'));
});

Tinytest.add('og-injector - buildOgTags - escapes HTML in entity name', function (test) {
  const entity = { handle: 'x', name: '<script>alert(1)</script>', avatarPath: null };
  const og = { domain: 'k.com' };
  const out = buildOgTags(entity, og, '/h', 'x.k.com', '/');
  test.isTrue(out.html.includes('&lt;script&gt;'));
  test.isFalse(out.html.includes('<script>alert'));
});

Tinytest.add('og-injector - buildCrawlerPage - self-contained HTML', function (test) {
  const og = {
    title: 'T',
    description: 'D',
    url: 'https://x.com/',
    html: '<title>T</title>',
  };
  const page = buildCrawlerPage(og);
  test.isTrue(page.startsWith('<!doctype html>'));
  test.isTrue(page.includes('<title>T</title>'));
  test.isTrue(page.includes('<h1>T</h1>'));
  test.isTrue(page.includes('href="https://x.com/"'));
});

Tinytest.add('og-injector - CRAWLER_UA - detects known crawlers', function (test) {
  test.isTrue(CRAWLER_UA.test('Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'));
  test.isTrue(CRAWLER_UA.test('Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'));
  test.isTrue(CRAWLER_UA.test('Twitterbot/1.0'));
  test.isTrue(CRAWLER_UA.test('facebookexternalhit/1.1'));
  test.isTrue(CRAWLER_UA.test('LinkedInBot/1.0 (compatible; Mozilla/5.0)'));
  test.isTrue(CRAWLER_UA.test('TelegramBot (like TwitterBot)'));
  test.isTrue(CRAWLER_UA.test('WhatsApp/2.19.81 A'));
});

Tinytest.add('og-injector - CRAWLER_UA - real browsers are not crawlers', function (test) {
  test.isFalse(CRAWLER_UA.test('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'));
  test.isFalse(CRAWLER_UA.test('curl/8.4.0'));
  test.isFalse(CRAWLER_UA.test(''));
});

// ---------------------------------------------------------------------------
// Phase 2 — pattern matching
// ---------------------------------------------------------------------------

Tinytest.add('og-injector - compilePattern - literal path matches exactly', function (test) {
  const c = compilePattern('/about');
  test.equal(matchPattern(c, '/about'), {});
  test.equal(matchPattern(c, '/about/'), {});
  test.isNull(matchPattern(c, '/about/team'));
  test.isNull(matchPattern(c, '/aboutx'));
});

Tinytest.add('og-injector - compilePattern - :param captures one segment', function (test) {
  const c = compilePattern('/parties/:id');
  test.equal(matchPattern(c, '/parties/abc123'), { id: 'abc123' });
  test.equal(matchPattern(c, '/parties/abc123/'), { id: 'abc123' });
  test.isNull(matchPattern(c, '/parties'));
  test.isNull(matchPattern(c, '/parties/abc/extra'));
});

Tinytest.add('og-injector - compilePattern - :name* greedy match across slashes', function (test) {
  const c = compilePattern('/docs/:path*');
  test.equal(matchPattern(c, '/docs'), {});
  test.equal(matchPattern(c, '/docs/intro'), { path: 'intro' });
  test.equal(matchPattern(c, '/docs/guide/setup/install'), { path: 'guide/setup/install' });
});

Tinytest.add('og-injector - compilePattern - :name? optional segment', function (test) {
  const c = compilePattern('/posts/:slug?');
  test.equal(matchPattern(c, '/posts'), {});
  test.equal(matchPattern(c, '/posts/hello'), { slug: 'hello' });
  test.isNull(matchPattern(c, '/posts/hello/world'));
});

Tinytest.add('og-injector - compilePattern - decodes URL-encoded params', function (test) {
  const c = compilePattern('/users/:name');
  test.equal(matchPattern(c, '/users/jane%20doe'), { name: 'jane doe' });
});

Tinytest.add('og-injector - compilePattern - strips query strings before matching', function (test) {
  const c = compilePattern('/search');
  test.equal(matchPattern(c, '/search?q=foo'), {});
});

Tinytest.add('og-injector - compilePattern - specificity counts literal segments', function (test) {
  test.equal(compilePattern('/parties/featured').literalSegments, 2);
  test.equal(compilePattern('/parties/:id').literalSegments, 1);
  test.equal(compilePattern('/:any').literalSegments, 0);
});

// ---------------------------------------------------------------------------
// Phase 2 — outfit → theme-color
// ---------------------------------------------------------------------------

Tinytest.add('og-injector - hslToHex - canonical conversions', function (test) {
  test.equal(hslToHex(0, 100, 50), '#ff0000');     // red
  test.equal(hslToHex(120, 100, 50), '#00ff00');   // green
  test.equal(hslToHex(240, 100, 50), '#0000ff');   // blue
  test.equal(hslToHex(0, 0, 50), '#808080');       // grey
});

Tinytest.add('og-injector - outfitToThemeColor - canonical {h,s} shape', function (test) {
  test.equal(outfitToThemeColor({ h: 0, s: 100 }), '#ff0000');
  test.equal(outfitToThemeColor({ h: 31, s: 34 }), outfitToThemeColor({ h: 31, s: 34 }));
});

Tinytest.add('og-injector - outfitToThemeColor - legacy {hue,saturation} shape', function (test) {
  test.equal(outfitToThemeColor({ hue: 0, saturation: 100 }), '#ff0000');
});

Tinytest.add('og-injector - outfitToThemeColor - returns null for missing data', function (test) {
  test.isNull(outfitToThemeColor(null));
  test.isNull(outfitToThemeColor({}));
  test.isNull(outfitToThemeColor({ h: 0 })); // missing s
});

Tinytest.add('og-injector - renderOgHtml - emits theme-color when outfit present', function (test) {
  const out = renderOgHtml({
    title: 'T', description: 'D', type: 'article',
    outfit: { h: 0, s: 100 },
  }, 'x.com', '/');
  test.isTrue(out.html.includes('theme-color" content="#ff0000"'));
});

Tinytest.add('og-injector - renderOgHtml - omits theme-color when outfit absent', function (test) {
  const out = renderOgHtml({ title: 'T', description: 'D', type: 'article' }, 'x.com', '/');
  test.isFalse(out.html.includes('theme-color'));
});

Tinytest.add('og-injector - renderOgHtml - absolutises relative image paths', function (test) {
  const out = renderOgHtml({
    title: 'T', description: 'D', image: '/cover.png',
  }, 'x.com', '/');
  test.equal(out.image, 'https://x.com/cover.png');
});

Tinytest.add('og-injector - renderOgHtml - keeps absolute image URLs', function (test) {
  const out = renderOgHtml({
    title: 'T', description: 'D', image: 'https://cdn.example.com/c.png',
  }, 'x.com', '/');
  test.equal(out.image, 'https://cdn.example.com/c.png');
});

// ---------------------------------------------------------------------------
// Phase 2 — site defaults
// ---------------------------------------------------------------------------

Tinytest.add('og-injector - buildSiteDefaultTags - uses og.defaults when set', function (test) {
  const og = {
    domain: 'k.com', siteName: 'k.com', defaultDescription: 'def',
    defaults: { title: 'King of All Data', description: 'Sovereign web', image: '/icons/512.png', outfit: { h: 31, s: 34 } },
  };
  const out = buildSiteDefaultTags(og, 'k.com', '/');
  test.equal(out.title, 'King of All Data');
  test.equal(out.description, 'Sovereign web');
  test.equal(out.image, 'https://k.com/icons/512.png');
  test.isTrue(out.html.includes('theme-color'));
});

Tinytest.add('og-injector - buildSiteDefaultTags - falls back to siteName', function (test) {
  const og = { domain: 'k.com', siteName: 'k.com', defaultDescription: 'def' };
  const out = buildSiteDefaultTags(og, 'k.com', '/');
  test.equal(out.title, 'k.com');
  test.equal(out.description, 'def');
});

// ---------------------------------------------------------------------------
// Phase 2 — pattern registry
// ---------------------------------------------------------------------------

Tinytest.addAsync('og-injector - registerPattern - sync resolver match', function (test, done) {
  clearPatterns();
  KoadHarnessOgInjector.registerPattern({
    path: '/parties/:id',
    resolve(params) { return { _id: params.id, name: 'Test Party', summary: 'A great party' }; },
    toOg(doc) { return { title: doc.name, description: doc.summary, type: 'article' }; },
  });
  findPatternMatch('/parties/abc', { headers: {} }).then((hit) => {
    test.isNotNull(hit);
    test.equal(hit.params.id, 'abc');
    test.equal(hit.ogShape.title, 'Test Party');
    clearPatterns();
    done();
  });
});

Tinytest.addAsync('og-injector - registerPattern - async resolver match', function (test, done) {
  clearPatterns();
  KoadHarnessOgInjector.registerPattern({
    path: '/posts/:slug',
    resolve: async (params) => {
      await new Promise(r => setTimeout(r, 5));
      return { slug: params.slug, title: 'Async Post', body: 'hello' };
    },
    toOg: (doc) => ({ title: doc.title, description: doc.body, type: 'article' }),
  });
  findPatternMatch('/posts/hello', { headers: {} }).then((hit) => {
    test.isNotNull(hit);
    test.equal(hit.ogShape.title, 'Async Post');
    clearPatterns();
    done();
  });
});

Tinytest.addAsync('og-injector - registerPattern - missing data falls through', function (test, done) {
  clearPatterns();
  KoadHarnessOgInjector.registerPattern({
    path: '/parties/:id',
    resolve() { return null; }, // 404-ish: no document
    toOg(doc) { return { title: doc.name }; },
  });
  findPatternMatch('/parties/missing', { headers: {} }).then((hit) => {
    test.isNull(hit);
    clearPatterns();
    done();
  });
});

Tinytest.addAsync('og-injector - registerPattern - resolver throw falls through', function (test, done) {
  clearPatterns();
  KoadHarnessOgInjector.registerPattern({
    path: '/parties/:id',
    resolve() { throw new Error('db down'); },
    toOg(doc) { return { title: doc.name }; },
  });
  findPatternMatch('/parties/abc', { headers: {} }).then((hit) => {
    test.isNull(hit);
    clearPatterns();
    done();
  });
});

Tinytest.addAsync('og-injector - registerPattern - more-specific pattern wins', function (test, done) {
  clearPatterns();
  KoadHarnessOgInjector.registerPattern({
    path: '/parties/:id',
    resolve: (p) => ({ id: p.id, name: 'Generic ' + p.id }),
    toOg: (d) => ({ title: d.name }),
  });
  KoadHarnessOgInjector.registerPattern({
    path: '/parties/featured',
    resolve: () => ({ name: 'Featured Party' }),
    toOg: (d) => ({ title: d.name }),
  });
  findPatternMatch('/parties/featured', { headers: {} }).then((hit) => {
    test.isNotNull(hit);
    test.equal(hit.ogShape.title, 'Featured Party');
    test.equal(hit.pattern, '/parties/featured');
    clearPatterns();
    done();
  });
});

Tinytest.add('og-injector - registerPattern - validates spec', function (test) {
  test.throws(() => KoadHarnessOgInjector.registerPattern({}), /path/);
  test.throws(() => KoadHarnessOgInjector.registerPattern({ path: '/x' }), /resolve/);
  test.throws(() => KoadHarnessOgInjector.registerPattern({ path: '/x', resolve: () => {} }), /toOg/);
});

Tinytest.add('og-injector - buildPatternTags - emits outfit theme-color', function (test) {
  const og = { domain: 'k.com', siteName: 'k.com' };
  const out = buildPatternTags(
    { title: 'Doc', description: 'Body', outfit: { h: 240, s: 100 } },
    og, 'k.com', '/parties/abc'
  );
  test.equal(out.title, 'Doc');
  test.isTrue(out.html.includes('theme-color" content="#0000ff"'));
});

Tinytest.add('og-injector - buildPatternTags - returns null for empty toOg result', function (test) {
  const og = { domain: 'k.com' };
  test.isNull(buildPatternTags(null, og, 'k.com', '/'));
  test.isNull(buildPatternTags(undefined, og, 'k.com', '/'));
});
