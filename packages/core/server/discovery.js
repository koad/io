/**
 * Instance Discovery & Identity
 * 
 * Manages instance identity and provides service discovery endpoints.
 * 
 * Key Concepts:
 * - Entity: SSH fingerprint identifying the deployment instance
 * - Internals: Unique ID for this specific server process
 * - Discovery: Well-known endpoint for service identification
 * 
 * This enables:
 * - Multi-instance deployments with shared identity
 * - Federation between different koad:io instances
 * - Service mesh discovery
 */

const fs = require('fs');
const { utils: { parseKey } } = require('ssh2');
const crypto = require('crypto');

/**
 * Load Entity RSA Identity
 * 
 * Reads the SSH public key for this deployment and calculates its fingerprint.
 * This fingerprint becomes the entity ID, ensuring consistent identity across
 * all server processes in the deployment.
 * 
 * Key Location: ~/.${ENTITY}/id/rsa.pub
 * 
 * TODO: Enable this once SSH key infrastructure is set up
 * Currently commented out as it's optional for basic deployments.
 */
function loadEntityRSA() {
	const entityName = process.env.ENTITY;
	
	if (!entityName) {
		log.warning('[discovery] ENTITY environment variable not set - skipping RSA identity');
		return;
	}

	const keyPath = `${process.env.HOME}/.${entityName}/id/rsa.pub`;

	fs.readFile(keyPath, (err, data) => {
		if (err) {
			log.debug(`[discovery] Could not read RSA key from ${keyPath}: ${err.message}`);
			return;
		}

		const key = parseKey(data);
		
		if (key instanceof Error) {
			log.error('[discovery] Error parsing SSH key:', key.message);
			return;
		}

		// Calculate SHA256 fingerprint
		const fingerprint = crypto
			.createHash('sha256')
			.update(key.getPublicSSH())
			.digest('hex');

		koad.entity = fingerprint;
		log.success(`[discovery] Entity fingerprint loaded: ${fingerprint.substring(0, 16)}...`);
	});
}

/**
 * Instance Startup & Discovery Endpoint
 * 
 * On server start:
 * 1. Creates an ApplicationInternals record (unique process ID)
 * 2. Stores instance metadata (upstart time, entity, ident, app)
 * 3. Exposes /.well-known/koad-io.json discovery endpoint
 * 
 * Discovery Endpoint Response:
 * {
 *   upstart: Date,        // When this process started
 *   asof: Date,          // Current time
 *   entity: String,      // SSH fingerprint (if configured)
 *   internals: String    // Process ID
 * }
 */
Meteor.startup(async () => {
	const upstart = new Date();

	// Create instance record in database
	const internals = await ApplicationInternals.insertAsync({
		upstart,
		entity: process.env.ENTITY || 'unknown',
		ident: Meteor.settings?.public?.ident,
		application: Meteor.settings?.public?.ident?.application || 'koad-io-app'
	});

	log.upstart('[discovery] Instance registered:', internals);
	koad.internals = internals;

	// Optional: Load SSH-based entity identity
	// Uncomment when SSH infrastructure is ready
	// loadEntityRSA();

	/**
	 * Well-Known Discovery Endpoint
	 * 
	 * Returns instance metadata for service discovery.
	 * 
	 * HTTP Status: 316 (custom, indicates instance info)
	 * Content-Type: application/json
	 * 
	 * Usage:
	 *   curl https://your-app.com/.well-known/koad-io.json
	 * 
	 * This enables:
	 * - Health checking
	 * - Instance identification
	 * - Federation discovery
	 * - Load balancer routing
	 */
	WebApp.handlers.use('/.well-known/koad-io.json', (req, res, next) => {
		res.writeHead(316, {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-cache'
		});

		const discoveryInfo = {
			upstart,
			asof: new Date(),
			entity: koad.entity || process.env.ENTITY || 'unknown',
			internals,
			version: Meteor.settings?.public?.version,
			application: Meteor.settings?.public?.ident?.application
		};

		res.end(JSON.stringify(discoveryInfo, null, 3));
	});

	log.success('[discovery] Well-known endpoint registered: /.well-known/koad-io.json');
});

log.success('loaded koad-io-core/discovery');
