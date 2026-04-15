/* global Tinytest, KoadHarnessOgInjector */
// Tests for the juno#90 OG/oembed injector.
//
// Covers the pure-function layer:
//   - subdomain extraction (host header → entity handle)
//   - description derivation (landing.md first paragraph > role > fallback)
//   - tag generation (escaping, og:type=profile, twitter:card)
//   - crawler page rendering (self-contained HTML)
//   - crawler UA detection regex

const { getSubdomain, pickDescription, buildOgTags, buildCrawlerPage, escapeHtml, CRAWLER_UA } = KoadHarnessOgInjector._internal;

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
