/**
 * Scripts Endpoint
 *
 * GET /api/scripts?url=<encoded-url>
 *
 * Walks all entity scripts/ directories, parses manifest.json files,
 * matches the query URL against declared url_patterns (Chrome content
 * script match patterns), and returns matching userscripts.
 *
 * SPEC-196 §9, mission: dark-passenger-api-scripts-endpoint-read-context
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');

/**
 * Convert a Chrome content script match pattern to a RegExp.
 *
 * Chrome patterns: <scheme>://<host><path>
 *   * in scheme → matches http or https (or ws/wss)
 *   *. in host  → prefix wildcard: *.example.com matches example.com, sub.example.com
 *   * in path   → glob wildcard: /issues/* matches /issues/42
 */
function patternToRegex(pattern) {
	if (typeof pattern !== 'string' || !pattern) return null;

	const schemeEnd = pattern.indexOf('://');
	if (schemeEnd === -1) return null;

	const scheme = pattern.substring(0, schemeEnd);
	const rest = pattern.substring(schemeEnd + 3);

	// Scheme
	let schemeRegex;
	if (scheme === '*') {
		schemeRegex = '(https?|wss?)';
	} else if (/^(https?|wss?)$/.test(scheme)) {
		schemeRegex = scheme;
	} else {
		return null; // unsupported scheme (ftp, file, chrome-extension, etc.)
	}

	// Split host from path
	const pathStart = rest.indexOf('/');
	let host, pathPat;
	if (pathStart === -1) {
		host = rest;
		pathPat = '/*';
	} else {
		host = rest.substring(0, pathStart);
		pathPat = rest.substring(pathStart);
	}

	// Host
	let hostRegex;
	if (host === '*') {
		hostRegex = '[^/]+';
	} else if (host.startsWith('*.')) {
		hostRegex = '([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\\.)?'
			+ host.substring(2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	} else {
		hostRegex = host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	// Path
	let pathRegex;
	if (pathPat === '/*') {
		pathRegex = '(/.*)?';
	} else {
		pathRegex = pathPat
			.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
			.replace(/\\\*/g, '.*');
	}

	try {
		return new RegExp(`^${schemeRegex}://${hostRegex}${pathRegex}$`, 'i');
	} catch (_) {
		return null;
	}
}

/**
 * Test a URL against a Chrome match pattern.
 */
function urlMatchesPattern(url, pattern) {
	const regex = patternToRegex(pattern);
	if (!regex) return false;
	return regex.test(url);
}

Meteor.startup(() => {
	const homeDir = process.env.HOME;

	if (!homeDir) {
		log.warning('[scripts] HOME not set — endpoint unavailable');
		koad.services.push({
			id: 'scripts',
			endpoint: '/api/scripts',
			method: 'GET',
			status: 'down',
			reason: 'HOME not set',
		});
		return;
	}

	WebApp.handlers.use('/api/scripts', (req, res, next) => {
		if (req.method !== 'GET') return next();

		// ── Parse url query param ──
		const parsedUrl = new URL(req.url, 'http://localhost');
		const encodedUrl = parsedUrl.searchParams.get('url');

		if (!encodedUrl) {
			res.writeHead(400, {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
			});
			res.end(JSON.stringify({
				error: 'missing url parameter',
				queried_at: new Date().toISOString(),
			}));
			return;
		}

		let targetUrl;
		try {
			targetUrl = decodeURIComponent(encodedUrl);
		} catch (_) {
			res.writeHead(400, {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*',
			});
			res.end(JSON.stringify({
				error: 'invalid url encoding',
				queried_at: new Date().toISOString(),
			}));
			return;
		}

		// ── Walk entity directories for scripts ──
		const scripts = [];

		let entries;
		try {
			entries = fs.readdirSync(homeDir);
		} catch (e) {
			// can't read home dir — return empty
			entries = [];
		}

		for (const entry of entries) {
			// Entity directories: start with '.' and contain ENTITY.md
			if (!entry.startsWith('.') || entry === '.' || entry === '..') continue;

			const entityDir = path.join(homeDir, entry);
			const entityMdPath = path.join(entityDir, 'ENTITY.md');

			let entityMdExists = false;
			try {
				entityMdExists = fs.statSync(entityMdPath).isFile();
			} catch (_) {
				// not an entity directory
			}
			if (!entityMdExists) continue;

			const scriptsDir = path.join(entityDir, 'scripts');

			let slugs;
			try {
				slugs = fs.readdirSync(scriptsDir);
			} catch (_) {
				continue; // no scripts/ dir or can't read
			}

			const entityHandle = entry.substring(1); // strip leading '.'

			for (const slug of slugs) {
				const slugDir = path.join(scriptsDir, slug);

				// Must be a directory
				let isDir = false;
				try {
					isDir = fs.statSync(slugDir).isDirectory();
				} catch (_) {
					continue;
				}
				if (!isDir) continue;

				// ── Read manifest.json ──
				const manifestPath = path.join(slugDir, 'manifest.json');
				let manifest;
				try {
					const raw = fs.readFileSync(manifestPath, 'utf8');
					manifest = JSON.parse(raw);
				} catch (_) {
					continue; // can't read or parse manifest
				}

				// ── Validate required fields ──
				if (!manifest.name || typeof manifest.name !== 'string') continue;
				if (!manifest.url_patterns || !Array.isArray(manifest.url_patterns)) continue;

				// ── Match URL against declared patterns ──
				const matches = manifest.url_patterns.some(p => urlMatchesPattern(targetUrl, p));
				if (!matches) continue;

				scripts.push({
					entity: entityHandle,
					slug,
					name: manifest.name,
					description: manifest.description || null,
					version: manifest.version || '0.0.0',
					url_patterns: manifest.url_patterns,
					permissions: manifest.permissions || [],
					script_url: `/api/scripts/${entityHandle}/${slug}/script.js`,
					signature_url: `/api/scripts/${entityHandle}/${slug}/script.js.sig`,
				});
			}
		}

		// ── Limit to 20 ──
		const limited = scripts.slice(0, 20);

		const response = {
			url: targetUrl,
			scripts: limited,
			count: limited.length,
			queried_at: new Date().toISOString(),
		};

		res.writeHead(200, {
			'Content-Type': 'application/json',
			'Cache-Control': 'public, max-age=30',
			'Access-Control-Allow-Origin': '*',
		});
		res.end(JSON.stringify(response, null, 2));
	});

	koad.services.push({
		id: 'scripts',
		endpoint: '/api/scripts',
		method: 'GET',
		status: 'up',
	});

	const entity = process.env.ENTITY || 'unknown';
	console.log(`[scripts] Endpoint registered: GET /api/scripts (entity: ${entity})`);
});
