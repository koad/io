var parser = require('ua-parser-js');
var geoip = require('geoip-lite');

// TODO: if the server restarts -- it wont fire the onclose function..

Meteor.onConnection(function(connection){
	var h, r, ip, geo, id, more, session, spiderCount;
	h = connection.httpHeaders;
	r = parser(h['user-agent']);
	// console.log({r})
	var proto = h['x-forwarded-proto'];
	var host = h['host'];

	// console.log({h})
	// console.log(`h['x-forwarded-for']: ${h['x-forwarded-for']}`);
	// console.log(`h['host']: ${h['host']}`);

	ip = connection.clientAddress;
	if(String(connection.clientAddress) == '127.0.0.1'){
		geo={ intranet: true };
		ip='127.0.0.1';
	} else {
		// Lookup IP and handle errors. 
		ip=h['x-real-ip'];
		geo = geoip.lookup(ip);
		if (geo == null){
			geo = new Object;
			geo.country_name = 'unknown';
			geo.region_name = 'unknown';
		} else {
			geo.country_name = CountryCodes.countryName(geo.country);
			geo.region_name = geo.region;
		}
	}

	session = {
		_id: connection.id, 
		established: new Date(),
		state: 'new',
		host, proto, geo, more, 
		instance: Meteor.instance,
		ipaddr: ip,
		userId: null,
		username: null,
		trafficSource: null,
		referer: h.referer,
		userAgent:  { raw: r.string, browser: r.browser, device: r.device, os: r.os , engine: r.engine , cpu: r.cpu },
		pageviews: 0,
		calls: 0,
		errors: { info: 0, caught: 0, uncaught: 0, warning: 0 }
	};

	// console.log(session);
	if(connection.clientAddress == null){
		log.warning("SERVER::ONCONNECTION", "An new connection, but 'connection.clientAddress' not found! > on ["+connection.httpHeaders.host+"]", ip );
	} else {
		// if (r.device == 'Spider') log.info("SERVER::ONCONNECTION", "A SPIDER connection on ["+connection.httpHeaders.host+"]", ip );
		// else log.info("SERVER::ONCONNECTION", "An new client connection on ["+connection.httpHeaders.host+"]", ip );
	}

	//Finnished combing the data, throw it in database and pick it back up when client sumbits visitLog;
	ApplicationSessions.insert(session);

	// when this connection closes, process and orphan the session.
	connection.onClose(function() {
		ApplicationSessions.update({_id: connection.id}, {$set: {
			closed: new Date(),
			state: 'closed'
		}});

		if(connection.clientAddress == null){
			log.warning("SERVER::ONCONNECTION", "UNKNOWN client connection closed! [connection.clientAddress is null]", false, "ERR:NOT KNOWN");
		// } else {
			// if (r.device == 'Spider') log.info("SERVER::ONCONNECTION", "SPIDER connection closed! ["+connection.httpHeaders.host+"]", false, visit.ipAddress);
			// else log.info("SERVER::ONCONNECTION", "Client connection closed! ["+connection.httpHeaders.host+"]", false, visit.ipAddress);
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

