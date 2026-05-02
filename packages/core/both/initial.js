// both/initial.js — Initialize the koad global object.
//
// The canonical koad object shape lives in ~/.koad-io/modules/node/ for use
// by CLI tools, non-Meteor apps, and future runtimes. Inside Meteor, we
// construct the same shape inline because Meteor packages can't require()
// from the app's node_modules (they resolve against their own .npm tree).
//
// Keep this in sync with modules/node/index.js.

console.log('koad:io - loading has begun');

koad = {
	maintenance: true,
	lighthouse: null,
	extension: null,
	instance: null,
	gateway: null,
	session: null,
	internals: 'unset',
	identity: null,   // populated by both/identity-factory.js + server/identity.js or client/identity.js
	storage: {},
	library: {},
	format: {
		timestamp: function(d, s) {
		if(!d) d = new Date();
		if(!s) s = ":";
		  const date = new Date(d);
		  const year = date.getFullYear();
		  const month = String(date.getMonth() + 1).padStart(2, '0');
		  const day = String(date.getDate()).padStart(2, '0');
		  const hours = String(date.getHours()).padStart(2, '0');
		  const minutes = String(date.getMinutes()).padStart(2, '0');
		  const seconds = String(date.getSeconds()).padStart(2, '0');
		  return `${year}${s}${month}${s}${day}${s}${hours}${s}${minutes}${s}${seconds}`;
		}
	},
	seeders: [],
	emitters: [],
	trackers: []
};
