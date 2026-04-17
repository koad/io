/*

	https://github.com/klaussinani/signale

	:just-a-thought:
	We could be doing more in here,.  as errors pass thru here we could
	be cateloging performance data.. 



	log.success('Operation successful');
	log.pending('Write release notes for %s', '1.2.0');
	log.fatal(new Error('Unable to acquire lock'));
	log.watch('Recursively watching build directory...');
	log.complete({prefix: '[task]', message: 'Fix issue #59', suffix: '(@klauscfhq)'});


*/

const {Signale} = require('signale');
const logger = new Signale({
	types: {
		remind: {
			badge: '**',
			color: 'yellow',
			label: 'reminder',
			logLevel: 'info'
		},
		santa: {
			badge: '🎅',
			color: 'red',
			label: 'santa',
			logLevel: 'info'
		}
	}
});

logger.config({
	displayFilename: process.env.LOGGER_DISPLAY_FILENAME || false,
	displayTimestamp: process.env.LOGGER_DISPLAY_TIMESTAMPS || false,
	displayDate: process.env.LOGGER_DISPLAY_TIMESTAMPS || false,
});

const chuck = (error)=>{
	logger.fatal(error);
	process.exit(1)
}

function clearConsole() {
	process.stdout.write("\u001b[3J\u001b[2J\u001b[1J");
	console.clear();
	console.log('-cleared-')
	console.log()
}

module.exports = {
	logger,
	log: logger,
	chuck,
	clearConsole
}
