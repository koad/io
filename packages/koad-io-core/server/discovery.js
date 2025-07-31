const fs = require('fs');
const { utils: { parseKey } } = require('ssh2');
const crypto = require('crypto');

// Function to read the key file and print its fingerprint
function loadEntityRSA() {
	const keyPath = `${process.env.HOME}/.${process.env.ENTITY}/id/rsa.pub`;
  fs.readFile(keyPath, (err, data) => {
    if (err) return // console.error(`Error reading key from ${keyPath}:`, err.message);

    const key = parseKey(data);
    if (key instanceof Error) return console.error('Error parsing key:', key.message);

    const fingerprint = crypto.createHash('sha256').update(key.getPublicSSH()).digest('hex');
    log.info(`Fingerprint for ${keyPath}: ${fingerprint}`);
		koad.entity = fingerprint;
  });
};

Meteor.startup(async ()=>{
	const upstart = new Date();

	const internals = await ApplicationInternals.insertAsync({
		upstart,
		entity: process.env.ENTITY,
		ident: Meteor.settings?.public?.ident,
		application: Meteor.settings?.public?.ident?.application
	});

	log.upstart('Created new instance in ApplicationInternals:', internals);
	koad.internals = internals;
	// loadEntityRSA();

	// This is app discovery;  
	// it allows your apps to recognize themselves, then they can start a conversation.

	// via JSON api/curl
	WebApp.handlers.use('/.well-known/koad-io.json', (req, res, next) => {
		res.writeHead(316, {'Content-Type': 'application/json'});
		res.end(JSON.stringify({
			upstart,
			asof: new Date(),
			entity: koad.entity,
			internals
		}, null, 3));
	});

});
