var parser = require('ua-parser-js');
var geoip = require('geoip-lite');

/**
 * Connection Tracking & Session Management
 * 
 * This module manages ApplicationSessions for all client connections.
 * 
 * Session Lifecycle:
 * 1. Meteor.onConnection fires -> Create session immediately
 * 2. Client calls 'enable.connection' -> Mark session as enabled
 * 3. User logs in -> onLogin hook enhances session with userId/username
 * 4. connection.onClose fires -> Mark session as closed
 * 
 * Important: Sessions are created BEFORE authentication. This prevents
 * race conditions where login happens before enable.connection is called.
 * The onLogin hook (in koad-io-accounts-core) handles attaching user
 * identity to existing sessions.
 */

/**
 * Server Restart Handler
 * 
 * When the server restarts, existing connections are severed but
 * connection.onClose won't fire for them. We need to mark these
 * orphaned sessions so they don't appear as "active" forever.
 * 
 * This runs once on server startup to clean up any sessions from
 * the previous server instance.
 */
Meteor.startup(async () => {
	const serverStartTime = new Date();
	
	// Find all sessions that were open when server stopped
	// (established but not closed, older than this server instance, and from this instance)
	// IMPORTANT: Filter by instance to handle multiple koad:io apps sharing same MongoDB
	const orphanedSessions = await ApplicationSessions.find({
		closed: { $exists: false },
		established: { $lt: serverStartTime },
		instance: Meteor.instance
	}).fetchAsync();

	if (orphanedSessions.length > 0) {
		log.warning(`[startup] Found ${orphanedSessions.length} orphaned sessions from previous server instance`);
		
		for (const session of orphanedSessions) {
			await ApplicationSessions.updateAsync(
				{ _id: session._id },
				{
					$set: {
						orphanedAt: serverStartTime,
						state: 'orphaned',
						orphanReason: 'server-restart'
					}
				}
			);
		}
		
		log.success(`[startup] Marked ${orphanedSessions.length} orphaned sessions`);
	}
});

/**
 * Connection Handler
 * 
 * Fires immediately when a client connects (before any authentication).
 * Creates an ApplicationSession document that will be enhanced later by:
 * - enable.connection method (adds client metadata)
 * - onLogin hook (adds userId/username)
 * 
 * Race Condition Prevention:
 * By creating the session immediately, we ensure it exists before any
 * login attempts. The onLogin hook in koad-io-accounts-core will find
 * this session and enhance it with user identity.
 */
Meteor.onConnection(function(connection){
	const h = connection.httpHeaders;
	const r = parser(h['user-agent']);
	const proto = h['x-forwarded-proto'];
	const host = h['host'];

	// Determine IP address and geolocation
	let ip = connection.clientAddress;
	let geo;

	if (String(connection.clientAddress) === '127.0.0.1') {
		geo = { intranet: true };
		ip = '127.0.0.1';
	} else {
		// Use real IP from proxy if available
		ip = h['x-real-ip'] || connection.clientAddress;
		geo = geoip.lookup(ip);
		
		if (geo == null) {
			geo = {
				country_name: 'unknown',
				region_name: 'unknown'
			};
		} else {
			geo.country_name = CountryCodes.countryName(geo.country);
			geo.region_name = geo.region;
		}
	}

	// Create session document immediately (before authentication)
	const session = {
		_id: connection.id,
		established: new Date(),
		state: 'new', // States: new -> connected -> authenticated -> closed/orphaned
		host,
		proto,
		geo,
		instance: Meteor.instance,
		ipaddr: ip,
		userId: null, // Set by onLogin hook when user authenticates
		username: null, // Set by onLogin hook when user authenticates
		trafficSource: null, // Set by enable.connection method
		referer: h.referer,
		userAgent: {
			raw: r.ua,
			browser: r.browser,
			device: r.device,
			os: r.os,
			engine: r.engine,
			cpu: r.cpu
		},
		pageviews: 0,
		calls: 0,
		counters: {
			login: 0 // Incremented by onLogin hook
		},
		errors: {
			info: 0,
			caught: 0,
			uncaught: 0,
			warning: 0
		}
	};

	if (connection.clientAddress == null) {
		log.warning('[onConnection] New connection without clientAddress', {
			host: connection.httpHeaders.host,
			connectionId: connection.id
		});
	}

	// Insert session into database (async, doesn't block connection)
	ApplicationSessions.insertAsync(session).catch((error) => {
		log.error('[onConnection] Failed to create session', {
			connectionId: connection.id,
			error: error.message
		});
	});

	/**
	 * Connection Close Handler
	 * 
	 * Fires when the connection is closed (user navigates away, closes tab,
	 * network disconnects, etc). Marks the session as closed.
	 * 
	 * Note: This will NOT fire if the server restarts. See startup handler above.
	 */
	connection.onClose(function() {
		ApplicationSessions.updateAsync(
			{ _id: connection.id },
			{
				$set: {
					closed: new Date(),
					state: 'closed'
				}
			}
		).catch((error) => {
			log.error('[onClose] Failed to mark session as closed', {
				connectionId: connection.id,
				error: error.message
			});
		});

		if (connection.clientAddress == null) {
			log.warning('[onClose] Connection closed without clientAddress', {
				connectionId: connection.id
			});
		}
	});
});

Meteor.publish(null, function() {
	return ApplicationSessions.find({ _id: this.connection.id });
});

ApplicationSessions.allow({
  update(userId, doc, fields, modifier) {
    // Allow updates if the connection.id matches the _id of the document
    return this.connection.id === doc._id;
  },
  remove(userId, doc) {
    // Deny removal of sessions
    return false;
  },
  insert(userId, doc) {
    // Deny direct insert of sessions
    return false;
  },
});

log.success('loaded koad-io/session-manager');

