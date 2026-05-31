/**
 * Corpus by-URL Endpoint
 *
 * GET /api/corpus/by-url?url=<encoded-url>
 *
 * Queries the CorpusURLIndex collection (populated by the corpus-url-projector
 * indexer) for matching corpus items. Returns items ordered by recency,
 * max 20 results.
 *
 * SPEC-196 §8.2, mission: dark-passenger-corpus-url-projector-indexer-api-
 */
import { WebApp } from 'meteor/webapp';
const { URL } = require('url');

// Access the same in-memory collection the corpus-url-projector populates
const CorpusURLIndex = new Mongo.Collection('CorpusURLIndex', { connection: null });

Meteor.startup(() => {
  WebApp.handlers.use('/api/corpus/by-url', (req, res, next) => {
    if (req.method !== 'GET') return next();

    // Parse the url query param
    const parsedUrl = new URL(req.url, 'http://localhost');
    const encodedUrl = parsedUrl.searchParams.get('url');

    if (!encodedUrl) {
      res.writeHead(400, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        error: 'missing url parameter',
        queried_at: new Date().toISOString()
      }));
      return;
    }

    // Decode the URL
    let targetUrl;
    try {
      targetUrl = decodeURIComponent(encodedUrl);
    } catch (e) {
      res.writeHead(400, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        error: 'invalid url encoding',
        queried_at: new Date().toISOString()
      }));
      return;
    }

    // Extract domain for primary filtering
    let targetDomain = null;
    try {
      const u = new URL(targetUrl);
      targetDomain = u.hostname;
    } catch (_) {
      // If we can't parse the URL, still try to match by raw substring
    }

    // Normalize for matching
    const normalized = targetUrl.toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');

    // Build query
    const query = {};

    if (targetDomain) {
      // Primary filter: domain match
      query.url_domain = targetDomain;
    }

    // Fetch matching records
    let items = CorpusURLIndex.find(query, {
      sort: { indexed_at: -1 },
      limit: 100 // fetch more than we need for post-filter
    }).fetch();

    // Post-filter: URL substring/subpath match
    // A corpus item matches if its normalized_url starts with the target's normalized URL.
    // This allows matching parent paths (e.g., /issues/42 matches /issues/42#comment-5
    // after normalization strips the fragment).
    items = items.filter(item => {
      const itemNormalized = (item.normalized_url || '').toLowerCase();
      // Match if the item URL starts with the query URL
      if (itemNormalized.startsWith(normalized)) return true;
      // Also match if the query URL starts with the item URL (narrower query matching broader item)
      if (normalized.startsWith(itemNormalized)) return true;
      // Fuzzy: URL substring match (for partial paths)
      if (itemNormalized.includes(normalized) || normalized.includes(itemNormalized)) return true;
      // Direct URL equality
      if (item.url === targetUrl) return true;
      return false;
    });

    // Limit to 20
    items = items.slice(0, 20);

    // Build response — clean fields for the API surface
    const responseItems = items.map(item => ({
      entity: item.entity,
      type: item.type,
      title: item.title,
      path: item.path,
      action: item.action,
      url: item.url
    }));

    const response = {
      url: targetUrl,
      items: responseItems,
      count: responseItems.length,
      queried_at: new Date().toISOString()
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify(response, null, 2));
  });

  koad.services.push({
    id: 'corpus-by-url',
    endpoint: '/api/corpus/by-url',
    method: 'GET',
    status: 'up'
  });
  console.log('[corpus-by-url] Endpoint registered: GET /api/corpus/by-url');
});
