/**
 * Sovereign Profile Endpoint
 * 
 * GET /api/sovereign-profile — public entity profile for Dark Passenger Tier 3 fallback.
 * 
 * Returns a read-only, public-safe profile sourced from the entity's ENTITY.md
 * frontmatter, id/ key files, and trust/bonds/ directory. No private keys,
 * no credentials, no internal config.
 * 
 * SPEC-196 §5, mission: dark-passenger-daemon-endpoint-api-sovereign-pro
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns { frontmatter: {}, body: string } or null if no frontmatter.
 */
function parseFrontmatter(content) {
	if (!content || !content.startsWith('---')) return null;

	const secondDelim = content.indexOf('---', 3);
	if (secondDelim === -1) return null;

	const fmBlock = content.substring(3, secondDelim).trim();
	const body = content.substring(secondDelim + 3).trim();

	// Simple YAML frontmatter parser — handles string, list, and scalar values.
	// Sufficient for entity ENTITY.md frontmatter shapes in use.
	const fm = {};
	const lines = fmBlock.split('\n');
	let currentKey = null;
	let currentList = null;

	for (const line of lines) {
		const listMatch = line.match(/^\s{2}-\s+(.+)$/);
		if (listMatch && currentKey) {
			if (!currentList) {
				currentList = [];
				fm[currentKey] = currentList;
			}
			currentList.push(listMatch[1].trim());
			continue;
		}

		// New key
		currentList = null;
		const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
		if (keyMatch) {
			currentKey = keyMatch[1];
			const value = keyMatch[2].trim();
			if (value === '') {
				// Value on next lines (list)
				fm[currentKey] = undefined;
			} else {
				fm[currentKey] = value;
			}
		}
	}

	// Clean up undefined list placeholders
	for (const [k, v] of Object.entries(fm)) {
		if (v === undefined) fm[k] = [];
	}

	return { frontmatter: fm, body };
}

/**
 * Extract display name from ENTITY.md content.
 * Priority: frontmatter.name → H1 heading → entity handle
 */
function extractDisplayName(parsed, entityName) {
	if (parsed?.frontmatter?.name) return parsed.frontmatter.name;

	const content = parsed?.body || '';
	const h1Match = content.match(/^# (.+)$/m);
	if (h1Match) return h1Match[1].trim();

	return entityName;
}

/**
 * Extract one-line role description from ENTITY.md content.
 * Priority: frontmatter.role → "I am..." pattern → "Role:" line → default
 */
function extractRole(parsed, entityName, displayName) {
	if (parsed?.frontmatter?.role) return parsed.frontmatter.role;

	const content = parsed?.body || '';

	// Pattern: "I am X, product-builder for Y." — first sentence after "I am"
	const iAmMatch = content.match(/(?:^|\n)\*?I am ([^.]+\.)/);
	if (iAmMatch) return iAmMatch[1].trim();

	// Pattern: "**Role:** X" or "- **Role:** X"
	const roleLine = content.match(/^\*?\*?Role:?\*?\*?\s*(.+)$/m);
	if (roleLine) return roleLine[1].trim();

	return `${displayName} — koad:io entity`;
}

Meteor.startup(() => {
	const entityName = process.env.ENTITY;

	if (!entityName) {
		log.warning('[sovereign-profile] ENTITY env var not set — endpoint unavailable');
		koad.services.push({
			id: 'sovereign-profile',
			endpoint: '/api/sovereign-profile',
			method: 'GET',
			status: 'down',
			reason: 'ENTITY not set'
		});
		return;
	}

	const entityDir = path.join(process.env.HOME, `.${entityName}`);
	const entityMdPath = path.join(entityDir, 'ENTITY.md');
	const idDir = path.join(entityDir, 'id');
	const bondsDir = path.join(entityDir, 'trust', 'bonds');

	WebApp.handlers.use('/api/sovereign-profile', (req, res, next) => {
		if (req.method !== 'GET') return next();

		// ── Read and hash ENTITY.md ──
		let entityMdHash = '';
		let displayName = entityName;
		let role = `${entityName} — koad:io entity`;
		let bio = null;

		try {
			const entityMdContent = fs.readFileSync(entityMdPath, 'utf8');
			entityMdHash = crypto.createHash('sha256').update(entityMdContent).digest('hex');

			const parsed = parseFrontmatter(entityMdContent);
			displayName = extractDisplayName(parsed || { body: entityMdContent }, entityName);
			role = extractRole(parsed || { body: entityMdContent }, entityName, displayName);

			// Extract first substantive paragraph for bio (skip headings, badges, metadata lines)
			const bodyContent = parsed?.body || (parsed === null ? entityMdContent : '');
			if (bodyContent) {
				const lines = bodyContent.split('\n');
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					if (trimmed.startsWith('#') || trimmed.startsWith('![') || trimmed.startsWith('>')) continue;
					if (trimmed.startsWith('**') && trimmed.endsWith('**')) continue;
					if (trimmed.startsWith('- ')) continue;
					if (trimmed.length > 10) {
						bio = trimmed;
						break;
					}
				}
			}
		} catch (e) {
			log.debug(`[sovereign-profile] Cannot read ENTITY.md from ${entityMdPath}: ${e.message}`);
		}

		// ── Read key fingerprints ──
		const publicKeys = {};
		try {
			const fingerprintPath = path.join(idDir, 'entity.fingerprint');
			if (fs.existsSync(fingerprintPath)) {
				const fp = fs.readFileSync(fingerprintPath, 'utf8').trim();
				if (fp) publicKeys.gpg = fp;
			}
		} catch (e) {
			log.debug(`[sovereign-profile] No entity.fingerprint: ${e.message}`);
		}

		// ── Count active trust bonds ──
		let bondCount = 0;
		try {
			if (fs.existsSync(bondsDir)) {
				bondCount = fs.readdirSync(bondsDir).filter(f => f.endsWith('.asc')).length;
			}
		} catch (e) {
			// bonds dir doesn't exist or can't be read — that's fine
		}

		// ── Sigchain tip ──
		// Placeholder: sigchain tip resolution requires IPFS/Merkle tree access.
		// Will be populated when sigchain indexer lands (SPEC-111 compatible).
		const sigchainTip = null;

		// ── Avatar URL ──
		// Derive from the badge endpoint pattern already used in ENTITY.md.
		// Overridable via AVATAR_URL env var.
		const avatarUrl = process.env.KOAD_IO_AVATAR_URL || null;

		// ── Build response ──
		const profile = {
			entity: entityName,
			name: displayName,
			role,
			bio,
			avatar_url: avatarUrl,
			public_keys: publicKeys,
			bond_count: bondCount,
			sigchain_tip: sigchainTip,
			entity_md_hash: entityMdHash,
			served_at: new Date().toISOString()
		};

		res.writeHead(200, {
			'Content-Type': 'application/json',
			'Cache-Control': 'public, max-age=300',
			'Access-Control-Allow-Origin': '*'
		});
		res.end(JSON.stringify(profile, null, 2));
	});

	koad.services.push({
		id: 'sovereign-profile',
		endpoint: '/api/sovereign-profile',
		method: 'GET',
		status: 'up'
	});
	log.success(`[sovereign-profile] Endpoint registered: /api/sovereign-profile (entity: ${entityName})`);
});
