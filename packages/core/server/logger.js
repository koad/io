const { Signale } = require('signale');

// TODO: this is a placeholder...  This logger should also log to DB or files when necessary,. 
// hopefully someone else has a nice solution to use here.  
// <3 Signale :L 

// signale: https://github.com/klaussinani/signale#api
// includes chalk: https://github.com/chalk/chalk#colors

let inProduction = false;
if(Meteor.isProduction) inProduction = true;

const logLevel = "info";
// const logLevel = "timer";
// const logLevel = "debug";
// const logLevel = "warn";
// const logLevel = "error";

logger = new Signale({ logLevel, 
	types: {

		upstart: { badge: '🟢',	color: 'red',           label: 'upstart',	logLevel: 'info' },
		starting: { badge: '🟢',color: 'green',		      label: 'starting',logLevel: 'info' },
		finished: { badge: '🏁',	color: 'green',	      label: 'finished',logLevel: 'info' },
		complete: { badge: '🏁',	color: 'green',	      label: 'complete',logLevel: 'info' },
		connect: { badge: '🟢',	color: 'blue',		      label: 'connect',	logLevel: 'info' },
		disco: { badge: '✌ ',		color: 'magenta',	      label: 'disco',	  logLevel: 'info' },
		system: { badge: '🔌',		color: 'cyan',		      label: 'system',	logLevel: 'info' },
		observe: { badge: '👁 ',	color: 'white',		      label: 'observe',	logLevel: 'info' },
		publish: 	{ badge: '⛽',color: 'redBright',     label: 'publish',	logLevel: 'info' },
		method: 	{ badge: '🧰',	color: 'greenBright',	  label: 'method',	logLevel: 'info' },
		remind: { badge: '⏲ ',		color: 'yellowBright',	label: 'remind',	logLevel: 'info' },
		todo: { badge: '⏲ ',		color: 'blueBright',	  label: 'todo',	  logLevel: 'info' },
		cron: { badge: '⏲ ',		color: 'magentaBright',	label: 'cronjob',	logLevel: 'info' },
		worker: { badge: ' ▓',		color: 'cyanBright',	  label: 'worker',	logLevel: 'info' },
		santa: 	{ badge: '🎅',	color: 'red',           label: 'santa',		logLevel: 'info' },

		pending: { badge: '🚩' },
		debug: { badge: '🚩' },

		fatal:   { badge: '⛑ ', color: 'red', label: 'fatal',  logLevel: 'error' },
		danger:  { badge: '🚑',  color: 'red', label: 'danger', logLevel: 'error' },
		
		alert: 	 { badge: '💔', color: 'red', label: 'alert',	 logLevel: 'warn' },
		warning: { badge: '💔',	color: 'red',  label: 'warning', logLevel: 'warn' },
		denied:  { badge: '🚷',	color: 'red',  label: 'denied',	 logLevel: 'warn' },

	}
});

logger.config({
  scope: 'global scope',
	displayDate: false,
	displayTimestamp: inProduction,
	displayFilename: !inProduction,
	displayScope: false,
	underlinePrefix: false,
	displayBadge: true,
	displayLabel: true,
	uppercaseLabel: true,
	underlineLabel: false,
	underlineMessage: false,
	underlineSuffix: false,
	logLevel: 'error'
});

logger._formatTimestamp = koad.format.timestamp;
logger.info('new logger: klaussinani/signale');


// TODO: using the originalLoggerError seems to make shit go funky sometimes.. learn about this,
const originalLoggerError = logger.error;
logger.error = function(...args) {
  const stack = new Error().stack;

  // Call the original logger.error function
  originalLoggerError(...args, stack);

  // Log error to ApplicationErrors collection
  koad.error(369, args.join(' '), stack);
};

const originalLoggerDenied = logger.denied;
logger.denied = function(...args) {
  const stack = new Error().stack;

  // Call the original logger.denied function
  originalLoggerDenied(...args, stack);

  // Log error to ApplicationErrors collection
  koad.error({code: 420, message: args.join(' '), stack: stack});

};

const originalLoggerAlert = logger.alert;
logger.alert = function(...args) {
  const stack = new Error().stack;

  // Call the original logger.alert function
  originalLoggerAlert(...args, stack);

  // Log error to ApplicationErrors collection
  koad.error({code: 69, message: args.join(' '), stack: stack});

};

log = logger;
log.success('loaded koad-io/logger');
