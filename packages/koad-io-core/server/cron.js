// https://www.npmjs.com/package/cron
// https://crontab.guru/

/*
	f({
		cronTime = cronTime || date, 
		onTick = function(){}, 
		onComplete = function(){}, 
		start = boolean, 
		timezone = 'America/Iqaluit', 
		context = false, 
		runOnInit = false, 
		unrefTimeout = false
	});

	var job = new koad.crontab.CronJob('* * * * * *', function() {
		log.cron('You will see this message every second');
	}, null, true, 'America/Los_Angeles');
	job.start();
	job.stop();
	job.setTime();
	job.lastDate();
	job.nextDates();
	job.fireOnTock();
	job.addCallback();
*/


koad.crontab = Npm.require('cron');

log.success('loaded koad-io/cron');
