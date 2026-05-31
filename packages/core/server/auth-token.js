/**
 * Auth Token Endpoint — SPEC-196 §4
 *
 * POST /api/auth/token
 *
 * Issues MCP session tokens for the Dark Passenger browser extension.
 * Tokens are stored in-memory (cleared on daemon restart).
 *
 * SPEC-196 §4.2, VESTA-SPEC-140 (fallback bearer token path).
 */

import { WebApp } from 'meteor/webapp';

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
 */
validateBearerToken = function (req) {
	const auth = req.headers['authorization'] || '';
	const m = auth.match(/^Bearer\s+(.+)$/i);
	if (!m) return { valid: false, reason: 'missing_token' };

	const token = m[1].trim();
	if (!token || token.length < 8 || token.length > 256) {
		return { valid: false, reason: 'invalid_token_format' };
	}

	if (!SessionTokens) return { valid: false, reason: 'not_initialized' };
	const doc = SessionTokens.findOne({ token: token });
	if (!doc) return { valid: false, reason: 'unknown_token' };

	return { valid: true, entity: doc.entity, scope: doc.scope };
};

Meteor.startup(() => {
	WebApp.handlers.use('/api/auth/token', (req, res, next) => {
		if (req.method !== 'POST') return next();

		// CORS preflight
		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			});
			res.end();
			return;
		}

		// Try req.body first (Meteor body parser), fall back to raw stream
		function processBody(parsed) {
			var client = parsed.client;
			var version = parsed.version;
			var fingerprint = parsed.fingerprint || null;

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

			var token = Random.id() + '-' + Random.id().slice(0, 12);

			var scope = 'visitor';
			var entity = null;

			if (fingerprint) {
				var fs = require('fs');
				var path = require('path');
				var HOME = require('os').homedir();
				try {
					var dirs = fs.readdirSync(HOME).filter(function (n) { return n.startsWith('.') && n.length > 1; });
					for (var i = 0; i < dirs.length; i++) {
						var fpPath = path.join(HOME, dirs[i], 'id', 'entity.fingerprint');
						try {
							var fp = fs.readFileSync(fpPath, 'utf8').trim();
							if (fp === fingerprint || fp.replace(/\s/g, '').toLowerCase() === fingerprint.replace(/\s/g, '').toLowerCase()) {
								entity = dirs[i].slice(1);
								scope = 'extension';
								break;
							}
						} catch (_) { /* no fingerprint file */ }
					}
				} catch (_) { /* can't read home dir */ }
			}

			SessionTokens.insert({
				token: token,
				client: client.trim(),
				version: version.trim(),
				fingerprint: fingerprint,
				entity: entity,
				scope: scope,
				createdAt: new Date(),
			});

			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
				'Cache-Control': 'no-store',
			});
			res.end(JSON.stringify({
				token: token,
				expires_at: null,
				scope: scope,
				entity: entity,
			}));
		}

		// Check if body already parsed
		if (req.body && typeof req.body === 'object' && req.body.client) {
			processBody(req.body);
			return;
		}

		// Fall back to raw stream
		var rawBody = '';
		req.on('data', function (chunk) { rawBody += chunk; });
		req.on('end', function () {
			try {
				processBody(JSON.parse(rawBody));
			} catch (e) {
				res.writeHead(400, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({ error: 'bad_request', reason: 'invalid_json' }));
			}
		});
	});

	if (typeof koad !== 'undefined' && koad.services) {
		koad.services.push({
			id: 'auth-token',
			endpoint: '/api/auth/token',
			method: 'POST',
			status: 'up',
		});
	}
});
