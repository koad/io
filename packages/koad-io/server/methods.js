const BEACON_VERSION = 'kMDZiN';

/**
 * Client Session & Analytics Methods
 * 
 * These methods are called by the client to report session state,
 * page views, and analytics data.
 */

Meteor.methods({
	/**
	 * Enable Connection
	 * 
	 * Called by client after connection is established to provide additional
	 * client-side context (app version, traffic source, previous session, etc).
	 * 
	 * Race Condition Handling:
	 * - Session is created immediately in Meteor.onConnection
	 * - This method can be called before OR after login
	 * - If login happened first, userId/username are already set by onLogin hook
	 * - If login happens later, onLogin hook will set userId/username
	 * - Either order is safe!
	 * 
	 * @param {Object} data - Client metadata
	 * @param {String} data.lastSession - Previous session ID (for returning users)
	 * @param {String} data.application - Application name/version
	 * @param {String} data.version - Client version
	 * @param {Boolean} data.aff - Is this an affiliate link?
	 * @param {String} data.sid - Source ID for affiliate tracking
	 */
	'enable.connection': async function (data) {
		// Determine IP address (simulation vs real connection)
		let ip = this.isSimulation ? 'simulation' : this.connection.clientAddress;
		
		// Use x-real-ip header if available (behind proxy)
		if (this.connection.httpHeaders?.['x-real-ip']) {
			ip = this.connection.httpHeaders['x-real-ip'];
		}

		// Check if user is already authenticated
		// (login may have happened before enable.connection was called)
		let username = 'anonymous';
		const user = await Meteor.users.findOneAsync(Meteor.userId());
		if (user) {
			username = user.username;
		}

		log.debug(`[enable.connection] Connection enabled by ${username} from ${ip}`);

		// Find the session created by Meteor.onConnection
		const currentVisit = await ApplicationSessions.findOneAsync({ _id: this.connection.id });
		
		if (!currentVisit) {
			log.error('[enable.connection] Session not found for connection', {
				connectionId: this.connection.id,
				userId: Meteor.userId(),
				username
			});
			throw new Meteor.Error('session-not-found', 'Cannot locate session for this connection');
		}

		// Handle returning visitors (link this session to previous one)
		if (data.lastSession == null) {
			log.system('[enable.connection] New client connection established', { ip });
		} else {
			const earlierVisit = await ApplicationSessions.findOneAsync({ _id: data.lastSession });
			
			if (earlierVisit === undefined) {
				log.warning('[enable.connection] Previous session not found', {
					reportedSession: data.lastSession,
					currentSession: this.connection.id,
					ip
				});
			} else {
				log.system('[enable.connection] Returning client connection established', { ip });
				
				// Link previous session to this one
				await ApplicationSessions.updateAsync(
					{ _id: earlierVisit._id },
					{ $set: { nextConnection: this.connection.id } }
				);
			}
		}

		// Validate IP consistency
		if (currentVisit?.ipaddr && currentVisit.ipaddr !== ip) {
			log.warning('[enable.connection] IP address mismatch', {
				sessionIP: currentVisit.ipaddr,
				connectionIP: ip,
				connectionId: this.connection.id
			});
		}

		// Build update object
		const updateObj = {
			enabled: true,
			previousVisit: data.earlierVisit,
			application: data.application,
			version: data.version,
			clientConnect: new Date(),
			trafficSource: data,
			state: 'connected'
		};

		// Set username if not already authenticated
		// (if user logged in before enable.connection, userId/username are already set)
		if (!currentVisit.userId) {
			if (Meteor.userId()) {
				// User authenticated between onConnection and enable.connection
				updateObj.userId = user._id;
				updateObj.username = user.username;
			} else {
				// User not authenticated yet
				updateObj.username = 'Anonymous';
			}
		}

		// Handle affiliate tracking
		if (data.aff) {
			updateObj.referer = data.sid;
		}

		// TODO: Implement campaign tracking from query string parameters
		// Future enhancement: Track campaign params (sid, cmp, s1-s5) from URL
		// This would allow attribution tracking for marketing campaigns
		// Example: ?sid=email-campaign&cmp=spring-sale&s1=variant-a

		await ApplicationSessions.updateAsync(
			{ _id: this.connection.id },
			{ $set: updateObj }
		);

		return {
			_id: this.connection.id,
			geo: currentVisit.geo
		};
	},
    'update.client.subscriptions': async function (data) {  // This function is called by the router any time a user engages a route

        check(data, Object);

        var earlierVisit = await ApplicationSessions.findOneAsync({ _id: this.connection.id});
        if(earlierVisit === undefined) {
            console.log('no earlier visit found,');
            await Counters.updateAsync({_id: 'Errors'}, { $inc:{ noVisitRecordFound: 1 }});
            return null;
        };

        if(Meteor.userId()){
            var user = await Meteor.users.findOneAsync({_id: Meteor.userId()})
            // console.log(this.userId);
            await Meteor.users.updateAsync({ _id: this.userId }, { $inc: { "counters.pageviews": 1 }});
            await Meteor.users.updateAsync({ _id: user._id}, { $set: {'lastKnown': {'activity': new Date(), 'route': data}}});

            if (earlierVisit.userId == null) {
                await ApplicationSessions.updateAsync({ _id: this.connection.id}, { $set: { 'userId': user._id, 'username': user.username }});
            };

            // if (user.referer) {  };

        } else {
            // await Meteor.users.updateAsync({ _id: this.userId }, { $inc: { "counters.pageviews": 1 }});
        };

        await ApplicationSessions.updateAsync( {_id: this.connection.id}, { $inc: { pageviews: 1 }, $set: { asof: new Date(), route: data.path}});

        if(data.route == undefined){
            console.log('no route included!!')
        } else {
            var stats = await ApplicationStatistics.findOneAsync({_id: data.route});
            if (stats == undefined) {
                stats = {
                    view_count: 0, delete_count: 0, get_count: 0, insert_count: 0,
                    list_count: 0, total_count: 1, update_count: 0
                };
                await ApplicationStatistics.insertAsync({_id: data.route}, stats);
            } else  await ApplicationStatistics.updateAsync({_id: data.route},{ $inc:{ view_count: 1 }});
        }
        return;
    },
    ioHandshake: async function(payload) {
        return;
        //  This is the first method called by Astro beacons, they need to provide a serial number for the other robotic methods to work.
        // console.log('method:ioHandshake');
        // console.log(payload)
        let sessionId = this.connection.id
        let sess = await ApplicationSessions.findOneAsync({_id: sessionId});


        if(sess == null) {
            log.error('Unable to find session. [invalid-session]', sess)
            throw new Meteor.Error(400, 'Unable to find session. [invalid-session]');
        }

        let devId = ""
        if(payload.serial){
            let device = await ApplicationDevices.findOneAsync({serial: payload.serial});
            if(!device){
                // console.log('Device not found!  Adding it now,...');
                let newDevice = {
                    serial: payload.serial,
                    created: new Date(),
                    ... payload
                }
                devId = await ApplicationDevices.insertAsync(newDevice);
                // console.log(devId);
            } else {
                console.log('system.information.report:updating-device')
                await ApplicationDevices.updateAsync({serial: payload.serial},{$set: {
                    system: payload.system,
                    upstart: payload.upstart || false,
                    version: payload.version || false,
                    asof: new Date()
                }});
                devId = device._id
            }
        } else console.log('no device info!');

        if(!sess.established) await ApplicationSessions.updateAsync({_id: sessionId}, {$set: {established: new Date() }});
        if(!sess.device) await ApplicationSessions.updateAsync({_id: sessionId}, { $set: { robotic: true, device: devId }});

        let connected = sess.established;
        let loadTime = new Date() - connected;
        sess.ttl = log

        // if(payload.serial){
        //     console.log('payload has device!')
        //     console.log(payload.device);
        //     await ApplicationDevices.updateAsync({serial: payload.serial},{$set: {
        //         asof: new Date()
        //     }});
        // } else console.log('no device datain payload!');

        await ApplicationDevices.updateAsync({serial: payload.serial}, {$inc:{ calls: 1 }});
        await ApplicationSessions.updateAsync({_id: sessionId},{$inc:{ calls: 1 }});
        await ApplicationSessions.updateAsync({_id: sessionId},{$set: {
            ident: payload.ident || "unknown",
            asof: new Date()
        }})
        return BEACON_VERSION;
    },
    'system.metrics.report': async function(payload) {
        // console.log('payload')
        // console.log(payload)
        // console.log('payload')
        let sessionId = this.connection.id
        let sess = await ApplicationSessions.findOneAsync({_id: sessionId});
        if(sess == null || !sess.established) {
            console.log('Unable to find session. [invalid-session]', sess)
            throw new Meteor.Error(400, 'Unable to find session. [invalid-session]');
        }
        // console.log('....', sess.device)

        if(payload.metrics && sess.device){
            // console.log('session has device!')
            // console.log(sess.device);
            await ApplicationDevices.updateAsync({_id: sess.device},{$set: {
                metrics: payload.metrics,
                asof: new Date()
            }});
        };

        await ApplicationSessions.updateAsync({_id: sessionId},{$inc:{ calls: 1 }});
        return "true"
    },
    'system.information.report': async function(payload) {
        sessionId = this.connection.id
        // console.log('system.information.report: payload!!');
        // console.log(JSON.stringify(payload, null, 3));
        let sess = await ApplicationSessions.findOneAsync({_id: sessionId});
        if(sess == null || !sess.established) {
            console.log('Unable to find session. [invalid-session]', sess)
            // throw new Meteor.Error(400, 'Unable to find session. [invalid-session]');
            return 'failed';
        }

        if(!sess.established){
            console.log('New connection, established');
            await ApplicationSessions.updateAsync({_id: sessionId}, {$set: {established: new Date()}})
        }

        // console.log(JSON.stringify(sess, null, 3));
        // console.log(sess.device);

        if(sess.device) await ApplicationDevices.updateAsync({_id: sess.device}, { $set: { ...payload }, $inc: { calls: 1 }});
        await ApplicationSessions.updateAsync({_id: sessionId}, { $inc: { calls: 1 }});
        return "true"
    },
    'revokeSession': async function(sessId){
        // console.log('method:revokeSession')
        let sess = await ApplicationSessions.findOneAsync({_id: sessId});
        if(sess == null) {
            throw new Meteor.Error(400, 'Unable to find session. [invalid-session]');
        } else {
            await ApplicationSessions.updateAsync({_id: sessId}, {$set: {revoked: true}})
            return sessId+' revoked'
        }
    },
    'archiveSession': async function(sessId){
        // console.log('method:archiveSession')
        let sess = await ApplicationSessions.findOneAsync({_id: sessId});
        if(sess == null) {
            throw new Meteor.Error(400, 'Unable to find session. [invalid-session]');
        } else {
            await ApplicationSessions.updateAsync({_id: sessId}, {$set: {archived: true}})
            return sessId+' archived'
        }
    },
    'archiveOrphanSessions': async function(){
        // console.log('Method Called: archiveOrphanSessions')
        var user = await Meteor.users.findOneAsync({ _id: Meteor.userId() })
        if(!user) throw new Meteor.Error(400, 'Unable to find logged in user! [invalid-user]');
        const sessions = await ApplicationSessions.find({userId: Meteor.userId(), orphanedAt: { $exists: true }, archived: { $exists: false }}).fetchAsync();
        for (const myDoc of sessions) {
            console.log('archiving: ', myDoc._id)
            await ApplicationSessions.updateAsync({_id: myDoc._id}, { $set: { archived: true }});
        }
        return true;
    },
    'revokeOrphanSessions': async function(){
        // console.log('Method Called: revokeOrphanSessions')
        var user = await Meteor.users.findOneAsync({ _id: Meteor.userId() })
        if(!user) throw new Meteor.Error(400, 'Unable to find logged in user! [invalid-user]');
        const sessions = await ApplicationSessions.find({userId: Meteor.userId(), orphanedAt: { $exists: true }, revoked: { $exists: false }}).fetchAsync();
        for (const myDoc of sessions) {
            console.log('revoking: ', myDoc._id)
            await ApplicationSessions.updateAsync({_id: myDoc._id}, { $set: { revoked: true }});
        }
        return true;
    },
    'analytics.vitals': async function(vitals){
        log.debug('Method Called: analytics.vitals');
        // console.log({vitals});
        return true;
    }
});

