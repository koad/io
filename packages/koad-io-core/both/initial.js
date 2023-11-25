console.log('koad:io - loading has begun');

koad = {
	maintenance: true,
	lighthouse: null,
	extention: null,
	instance: null,
	gateway: null,
	session: null,
	internals: 'unset',
	identity: {},
	generate: {},
	storage: {},
	library: {},
	format: {
		timestamp: function(d) {
		if(!d) d = new Date();	
		  const date = new Date(d);
		  const year = date.getFullYear();
		  const month = String(date.getMonth() + 1).padStart(2, '0');
		  const day = String(date.getDate()).padStart(2, '0');
		  const hours = String(date.getHours()).padStart(2, '0');
		  const minutes = String(date.getMinutes()).padStart(2, '0');
		  const seconds = String(date.getSeconds()).padStart(2, '0');
		  return `${year}:${month}:${day}:${hours}:${minutes}:${seconds}`;
		}
	},
	seeders: [],
	emitters: [],
	trackers: []
};
