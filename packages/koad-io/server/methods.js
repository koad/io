const BEACON_VERSION = 'kMDZiN';

// TODO: Maybe there is a race condition between 'enable.connection' and user login -- make sure we arent LoggingIn before we try to enable connection.

Meteor.methods({
    'enable.connection': function (data) {

        let ip = 'simulation'
        if (!this.isSimulation) { ip = this.connection.clientAddress; }
        let username = 'anonymous'

        var user = Meteor.users.findOne(Meteor.userId()); 
        if(user) username = user.username;

        log.debug(`connection enabled by ${username}`);

        // TODO: is this a hack?  why 
        if(this.connection.httpHeaders['x-real-ip']) ip = this.connection.httpHeaders['x-real-ip'];

        // console.debug(data)
        // console.debug(this.connection)

        // If we have an earlier connection reported, add this connection to it's blob.

        var currentVisit = ApplicationSessions.findOne({_id: this.connection.id});
        if(currentVisit == undefined) { 
            return log.error("CLIENT::CONNECTION", "Cannot locate visitor session information!");
        };

        if(data.lastSession == null){
            log.system("CLIENT::CONNECTION", "New client connection has been established.", false, ip);
        } else {
            var earlierVisit = ApplicationSessions.findOne({_id: data.lastSession});
            if(earlierVisit === undefined) {
                log.warning("CLIENT::CONNECTION", "Not able to find the reported previous connection!", false, ip);
            } else {
                log.system("CLIENT::CONNECTION", "Returning client connection has been established.", false, ip);
                ApplicationSessions.update( {_id: earlierVisit._id}, { $set: { nextConnection: this.connection.id} });
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
        ApplicationSessions.update({_id: this.connection.id}, {$set: currentVisit});
        return {_id: this.connection.id, geo: currentVisit.geo};

    },
    'update.client.subscriptions': function (data) {  // This function is called by the router any time a user engages a route

        check(data, Object);

        var earlierVisit = ApplicationSessions.findOne({ _id: this.connection.id});
        if(earlierVisit === undefined) {
            console.log('no earlier visit found,');
            Counters.update({_id: 'Errors'}, { $inc:{ noVisitRecordFound: 1 }});
            return null;
        };

        if(Meteor.userId()){
            var user = Meteor.users.findOne({_id: Meteor.userId()})
            // console.log(this.userId);
            Meteor.users.update({ _id: this.userId }, { $inc: { "counters.pageviews": 1 }});
            Meteor.users.update({ _id: user._id}, { $set: {'lastKnown': {'activity': new Date(), 'route': data}}});

            if (earlierVisit.userId == null) {
                ApplicationSessions.update({ _id: this.connection.id}, { $set: { 'userId': user._id, 'username': user.username }});
            };

            // if (user.referer) {  };

        } else {
            // Meteor.users.update({ _id: this.userId }, { $inc: { "counters.pageviews": 1 }});
        };

        ApplicationSessions.update( {_id: this.connection.id}, { $inc: { pageviews: 1 }, $set: { asof: new Date(), route: data.path}});

        if(data.route == undefined){
            console.log('no route included!!')
        } else {
            var stats = ApplicationStatistics.findOne({_id: data.route});
            if (stats == undefined) {
                stats = {
                    view_count: 0, delete_count: 0, get_count: 0, insert_count: 0,
                    list_count: 0, total_count: 1, update_count: 0
                };
                ApplicationStatistics.insert({_id: data.route}, stats);
            } else  ApplicationStatistics.update({_id: data.route},{ $inc:{ view_count: 1 }});
        }
        return;
    },
    ioHandshake: function(payload) {
        return;
        //  This is the first method called by Astro beacons, they need to provide a serial number for the other robotic methods to work.
        // console.log('method:ioHandshake');
        // console.log(payload)
        let sessionId = this.connection.id
        let sess = ApplicationSessions.findOne({_id: sessionId});


        if(sess == null) {
            log.error('Unable to find session. [invalid-session]', sess)
            throw new Meteor.Error(400, 'Unable to find session. [invalid-session]');
        }

        let devId = ""
        if(payload.serial){
            let device = ApplicationDevices.findOne({serial: payload.serial});
            if(!device){
                // console.log('Device not found!  Adding it now,...');
                let newDevice = {
                    serial: payload.serial,
                    created: new Date(), 
                    ... payload
                }
                devId = ApplicationDevices.insert(newDevice);
                // console.log(devId);
            } else {
                console.log('system.information.report:updating-device')
                ApplicationDevices.update({serial: payload.serial},{$set: {
                    system: payload.system, 
                    upstart: payload.upstart || false,
                    version: payload.version || false,
                    asof: new Date()
                }});
                devId = device._id
            }
        } else console.log('no device info!');

        if(!sess.established) ApplicationSessions.update({_id: sessionId}, {$set: {established: new Date() }});
        if(!sess.device) ApplicationSessions.update({_id: sessionId}, { $set: { robotic: true, device: devId }});

        let connected = sess.established;
        let loadTime = new Date() - connected;
        sess.ttl = log

        // if(payload.serial){
        //     console.log('payload has device!')
        //     console.log(payload.device);
        //     ApplicationDevices.update({serial: payload.serial},{$set: {
        //         asof: new Date()
        //     }});
        // } else console.log('no device datain payload!');

        ApplicationDevices.update({serial: payload.serial}, {$inc:{ calls: 1 }});
        ApplicationSessions.update({_id: sessionId},{$inc:{ calls: 1 }});
        ApplicationSessions.update({_id: sessionId},{$set: {
            ident: payload.ident || "unknown", 
            asof: new Date()
        }})
        return BEACON_VERSION;
    },
    'system.metrics.report': function(payload) {
        // console.log('payload')
        // console.log(payload)
        // console.log('payload')
        let sessionId = this.connection.id
        let sess = ApplicationSessions.findOne({_id: sessionId});
        if(sess == null || !sess.established) {
            console.log('Unable to find session. [invalid-session]', sess)
            throw new Meteor.Error(400, 'Unable to find session. [invalid-session]');
        }
        // console.log('....', sess.device)

        if(payload.metrics && sess.device){
            // console.log('session has device!')
            // console.log(sess.device);
            ApplicationDevices.update({_id: sess.device},{$set: {
                metrics: payload.metrics, 
                asof: new Date()
            }});
        };

        ApplicationSessions.update({_id: sessionId},{$inc:{ calls: 1 }});
        return "true"
    },
    'system.information.report': function(payload) {
        sessionId = this.connection.id
        // console.log('system.information.report: payload!!');
        // console.log(JSON.stringify(payload, null, 3));
        let sess = ApplicationSessions.findOne({_id: sessionId});
        if(sess == null || !sess.established) {
            console.log('Unable to find session. [invalid-session]', sess)
            // throw new Meteor.Error(400, 'Unable to find session. [invalid-session]');
            return 'failed';
        }

        if(!sess.established){
            console.log('New connection, established');
            ApplicationSessions.update({_id: session}, {$set: {established: new Date()}})
        }

        // console.log(JSON.stringify(sess, null, 3));
        // console.log(sess.device);

        if(sess.device) ApplicationDevices.update({_id: sess.device}, { $set: { ...payload }, $inc: { calls: 1 }});
        ApplicationSessions.update({_id: sessionId}, { $inc: { calls: 1 }});
        return "true"
    },
    'revokeSession': function(sessId){
        // console.log('method:revokeSession')
        let sess = ApplicationSessions.findOne({_id: sessId});
        if(sess == null) {
            throw new Meteor.Error(400, 'Unable to find session. [invalid-session]');
        } else {
            ApplicationSessions.update({_id: sessId}, {$set: {revoked: true}})
            return sessId+' revoked'
        }
    },
    'archiveSession': function(sessId){
        // console.log('method:archiveSession')
        let sess = ApplicationSessions.findOne({_id: sessId});
        if(sess == null) {
            throw new Meteor.Error(400, 'Unable to find session. [invalid-session]');
        } else {
            ApplicationSessions.update({_id: sessId}, {$set: {archived: true}})
            return sessId+' archived'
        }
    },
    'archiveOrphanSessions': function(){
        // console.log('Method Called: archiveOrphanSessions')
        var user = Meteor.users.findOne({ _id: Meteor.userId() })
        if(!user) throw new Meteor.Error(400, 'Unable to find logged in user! [invalid-user]');
        ApplicationSessions.find({userId: Meteor.userId(), orphanedAt: { $exists: true }, archived: { $exists: false }}).forEach( function(myDoc) { 
            console.log('archiving: ', myDoc._id)
            ApplicationSessions.update({_id: myDoc._id}, { $set: { archived: true }});
        });
        return true;
    },
    'revokeOrphanSessions': function(){
        // console.log('Method Called: revokeOrphanSessions')
        var user = Meteor.users.findOne({ _id: Meteor.userId() })
        if(!user) throw new Meteor.Error(400, 'Unable to find logged in user! [invalid-user]');
        ApplicationSessions.find({userId: Meteor.userId(), orphanedAt: { $exists: true }, revoked: { $exists: false }}).forEach( function(myDoc) { 
            console.log('revoking: ', myDoc._id)
            ApplicationSessions.update({_id: myDoc._id}, { $set: { revoked: true }});
        });
        return true;
    },
    'analytics.vitals': function(vitals){
        log.debug('Method Called: analytics.vitals');
        // console.log({vitals});
        return true;
    }
});

