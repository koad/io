/**
 * Context Injection Endpoint
 *
 * POST /api/context/inject
 *
 * Accepts structured tab/page context from the Dark Passenger browser extension
 * and emits it as a typed event to the kingdom nervous system.
 *
 * Request body (JSON):
 *   { url: string, title: string, text: string|null, metadata?: object }
 *
 * Response:
 *   { accepted: true, emission_id: "<id>" }
 *   { accepted: false, reason: "<message>" }
 *
 * v1 is fire-and-forget: accept, validate, emit context.injected typed event, return.
 * Session routing and entity targeting are deferred to a follow-on brief.
 *
 * SPEC-196 §6, mission: dark-passenger-api-context-inject-endpoint-read-
 */

import { WebApp } from 'meteor/webapp';

const Emissions = globalThis.EmissionsCollection;

Meteor.startup(() => {
	WebApp.handlers.use('/api/context/inject', (req, res, next) => {
		// Only handle POST
		if (req.method !== 'POST') return next();

		// ── CORS preflight ──
		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Authorization',
			});
			res.end();
			return;
		}

		// ── Read JSON body ──
		let body = '';
		req.on('data', chunk => { body += chunk; });
		req.on('end', () => {
			let payload;
			try {
				payload = JSON.parse(body);
			} catch (e) {
				res.writeHead(400, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({
					accepted: false,
					reason: 'invalid json body',
				}));
				return;
			}

			// ── Validate required fields ──
			if (!payload.url || typeof payload.url !== 'string') {
				res.writeHead(400, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({
					accepted: false,
					reason: 'missing or invalid field: url (string required)',
				}));
				return;
			}

			if (!payload.title || typeof payload.title !== 'string') {
				res.writeHead(400, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({
					accepted: false,
					reason: 'missing or invalid field: title (string required)',
				}));
				return;
			}

			// text is optional but must be string or null if present
			if (payload.text !== undefined && payload.text !== null && typeof payload.text !== 'string') {
				res.writeHead(400, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({
					accepted: false,
					reason: 'invalid field: text (must be string or null)',
				}));
				return;
			}

			// metadata is optional but must be an object if present
			if (payload.metadata !== undefined && (typeof payload.metadata !== 'object' || payload.metadata === null)) {
				res.writeHead(400, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({
					accepted: false,
					reason: 'invalid field: metadata (must be an object if present)',
				}));
				return;
			}

			// ── Build emission document ──
			const now = new Date();
			const doc = {
				entity: process.env.ENTITY || 'unknown',
				type: 'context.injected',
				body: payload.title,
				timestamp: now,
				meta: {
					url: payload.url,
					title: payload.title,
					text: payload.text || null,
				},
			};

			// Attach optional metadata
			if (payload.metadata) {
				Object.assign(doc.meta, payload.metadata);
			}

			// ── Emit into the nervous system ──
			let emissionId;
			try {
				emissionId = Emissions.insert(doc);
				console.log(`[context-inject] ${doc.entity}/context.injected: ${payload.title} (${payload.url})`);
			} catch (e) {
				console.error('[context-inject] Failed to insert emission:', e.message);
				res.writeHead(500, {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
				});
				res.end(JSON.stringify({
					accepted: false,
					reason: 'internal error: failed to emit event',
				}));
				return;
			}

			// ── Return success ──
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
			});
			res.end(JSON.stringify({
				accepted: true,
				emission_id: emissionId,
				served_at: now.toISOString(),
			}));
		});
	});

	koad.services.push({
		id: 'context-inject',
		endpoint: '/api/context/inject',
		method: 'POST',
		status: 'up',
	});

	const entity = process.env.ENTITY || 'unknown';
	console.log(`[context-inject] Endpoint registered: POST /api/context/inject (entity: ${entity})`);
});
