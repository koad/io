const BEACON_VERSION = 'kMDZiN';

// TODO: Maybe there is a race condition between 'enable.connection' and user login -- make sure we arent LoggingIn before we try to enable connection.

Meteor.methods({
    'enable.connection': async function (data) {

        let ip = 'simulation'
        if (!this.isSimulation) { ip = this.connection.clientAddress; }
        let username = 'anonymous'

        var user = await Meteor.users.findOneAsync(Meteor.userId());
        if(user) username = user.username;

        log.debug(`connection enabled by ${username}`);

        // TODO: is this a hack?  why 
        if(this.connection.httpHeaders['x-real-ip']) ip = this.connection.httpHeaders['x-real-ip'];

        // console.debug(data)
        // console.debug(this.connection)

        // If we have an earlier connection reported, add this connection to it's blob.

        var currentVisit = await ApplicationSessions.findOneAsync({_id: this.connection.id});
        if(currentVisit == undefined) { 
            return log.error("CLIENT::CONNECTION", "Cannot locate visitor session information!");
        };

        if(data.lastSession == null){
            log.system("CLIENT::CONNECTION", "New client connection has been established.", false, ip);
        } else {
            var earlierVisit = await ApplicationSessions.findOneAsync({_id: data.lastSession});
            if(earlierVisit === undefined) {
                log.warning("CLIENT::CONNECTION", "Not able to find the reported previous connection!", false, ip);
            } else {
                log.system("CLIENT::CONNECTION", "Returning client connection has been established.", false, ip);
                await ApplicationSessions.updateAsync( {_id: earlierVisit._id}, { $set: { nextConnection: this.connection.id} });
            }
        };


// TODO: handle the querystring
// // 
//                 // If the url has an voucher/campaign add them
//                 if (qs.sid) {
//                     session = {
//                         location: window.location,
//                         aff: true,
//                         sid: qs.sid,
//                         cmp: qs.cmp ? qs.cmp : null,
//                         s1: qs.s1 ? qs.s1 : null,
//                         s2: qs.s2 ? qs.s2 : null,
//                         s3: qs.s3 ? qs.s3 : null,
//                         s4: qs.s4 ? qs.s4 : null,
//                         s5: qs.s5 ? qs.s5 : null
//                     };
//                 } else {
//                     session = {
//                         location: window.location,
//                         aff: false,
//                         sid: 'Organic',
//                         cmp: 'None',
//                         s1: 's1',
//                         s2: 's2',
//                         s3: 's3',
//                         s4: 's4',
//                         s5: 's5'
//                     };
//                 }
                


        if(currentVisit?.ipaddr && currentVisit?.ipaddr !== ip) log.error('connection IP and logged connection IP are different!');
        // log.debug({currentVisit});

        if(currentVisit.userId == undefined) {
            if(Meteor.userId()) {
                currentVisit.userId = user._id;
                currentVisit.username = user.username;
            } else {
                currentVisit.username = "Anonymous";
            }
        }
        
        currentVisit.enabled = true;
        currentVisit.previousVisit = data.earlierVisit;
        currentVisit.application = data.application;
        currentVisit.version = data.version;
        currentVisit.clientConnect = new Date();
        currentVisit.trafficSource = data;

        currentVisit.state='connected'
        if(data.aff){
            currentVisit.referer = data.sid;
        }

        delete currentVisit._id
        await ApplicationSessions.updateAsync({_id: this.connection.id}, {$set: currentVisit});
        return {_id: this.connection.id, geo: currentVisit.geo};

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

