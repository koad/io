/**
 * Auth Token Endpoint — SPEC-196 §4
 *
 * POST /api/auth/token
 *
 * Issues MCP session tokens for the Dark Passenger browser extension.
 * Tokens are UUID v4, stored in-memory (cleared on daemon restart).
 *
 * Request body (JSON):
 *   { client: string, version: string, fingerprint?: string }
 *
 * Response (200):
 *   { token: "<UUID-v4>", expires_at: null, scope: "extension"|"visitor", entity: "<handle>"|null }
 *
 * Response (400):
 *   { error: "bad_request", reason: "<message>" }
 *
 * SPEC-196 §4.2, VESTA-SPEC-140 (fallback bearer token path).
 */

// In-memory token store — initialized on startup when Mongo is available.
let SessionTokens = null;

Meteor.startup(() => {
	SessionTokens = new Mongo.Collection('SessionTokens', { connection: null });
	try {
		SessionTokens._ensureIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 });
	} catch (_) { /* index may already exist */ }
});

/**
 * Validate a Bearer token from an incoming request.
 * Returns { valid: true, entity, scope } or { valid: false, reason }.
 * Exported for use by other endpoint handlers.
 */
validateBearerToken = function (req) {
	const auth = req.headers['authorization'] || '';
	const m = auth.match(/^Bearer\s+(.+)$/i);
	if (!m) return { valid: false, reason: 'missing_token' };

	const token = m[1].trim();
	if (!token || token.length < 8 || token.length > 256) {
		return { valid: false, reason: 'invalid_token_format' };
	}

	const doc = SessionTokens.findOne({ token });
	if (!doc) return { valid: false, reason: 'unknown_token' };

	return { valid: true, entity: doc.entity, scope: doc.scope };
};

Meteor.startup(() => {
	WebApp.handlers.use('/api/auth/token', (req, res, next) => {
		// Only handle POST
		if (req.method !== 'POST') return next();

		// ── CORS preflight ──
		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			});
			res.end('');
			return;
		}

		// ── Parse body ──
		let body = '';
		req.on('data', chunk => { body += chunk; });
		req.on('end', () => {
			let parsed;
			try { parsed = JSON.parse(body); } catch (e) {
				res.writeHead(400, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({ error: 'bad_request', reason: 'invalid_json' }));
				return;
			}

			const client = parsed.client;
			const version = parsed.version;
			const fingerprint = parsed.fingerprint || null;

			// Validate required fields
			if (!client || typeof client !== 'string' || !client.trim()) {
				res.writeHead(400, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({ error: 'bad_request', reason: 'client is required' }));
				return;
			}
			if (!version || typeof version !== 'string' || !version.trim()) {
				res.writeHead(400, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({ error: 'bad_request', reason: 'version is required' }));
				return;
			}

			// ── Generate token ──
			const token = Random.id() + '-' + Random.id().slice(0, 12);

			// ── Bind entity from fingerprint if available ──
			let scope = 'visitor';
			let entity = null;

			if (fingerprint) {
				// Walk entity dirs looking for matching GPG fingerprint
				const fs = require('fs');
				const path = require('path');
				const HOME = require('os').homedir();
				try {
					const dirs = fs.readdirSync(HOME).filter(n => n.startsWith('.') && n.length > 1);
					for (const dir of dirs) {
						const fpPath = path.join(HOME, dir, 'id', 'entity.fingerprint');
						try {
							const fp = fs.readFileSync(fpPath, 'utf8').trim();
							if (fp === fingerprint || fp.replace(/\s/g, '').toLowerCase() === fingerprint.replace(/\s/g, '').toLowerCase()) {
								entity = dir.slice(1); // strip leading dot
								scope = 'extension';
								break;
							}
						} catch (_) { /* no fingerprint file for this entity */ }
					}
				} catch (_) { /* can't read home dir */ }
			}

			// ── Store token ──
			SessionTokens.insert({
				token,
				client: client.trim(),
				version: version.trim(),
				fingerprint,
				entity,
				scope,
				createdAt: new Date(),

			// ── Respond ──
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'no-store',
			res.end(JSON.stringify({
				token,
				expires_at: null,
				scope,
				entity,
			}));
		});
	});

	// Register in service discovery
	if (typeof koad !== 'undefined' && koad.services) {
		koad.services.push({
			id: 'auth-token',
			endpoint: '/api/auth/token',
			method: 'POST',
			status: 'up',
		});
	}
});
