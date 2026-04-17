const { logger } = require('../library/logger.js');

let watchForUpdates = ( async ()=>{
	logger.start('watching for uppdates...')
	setInterval(() => {
	 logger.info('watching for updates')
	 require('simple-git')()
	 .exec(() => logger.info('Starting pull...'))
	 .pull((err, update) => {
	   if(update && update.summary.changes) {
	     logger.info('Changes have been made!')
	     logger.info(update.summary)
	     require('child_process').exec('pm2 reload ./index.js');
	   }
	 })
	 .exec(() => logger.info('pull done.'));
	}, 60000);
	// }, nconf.get('updateInterval') || random(60000, 120000));

})



module.exports = {
  watchForUpdates
};


