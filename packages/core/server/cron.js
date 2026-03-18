/**
 * Cron Job Management
 * 
 * Provides access to the cron package for scheduled tasks.
 * 
 * Documentation:
 * - NPM: https://www.npmjs.com/package/cron
 * - Cron Syntax: https://crontab.guru/
 * 
 * Cron Syntax Quick Reference:
 * - * * * * * * - Every second
 * - 0 * * * * * - Every minute
 * - 0 0 * * * * - Every hour
 * - 0 0 0 * * * - Every day at midnight
 * - 0 0 * * 0   - Every Sunday
 * 
 * Usage Examples:
 * 
 * @example Basic job
 * const job = new koad.crontab.CronJob('0 * * * * *', function() {
 *   console.log('This runs every minute');
 * });
 * job.start();
 * 
 * @example With timezone
 * const job = new koad.crontab.CronJob(
 *   '0 0 * * *',
 *   function() { console.log('Midnight in LA'); },
 *   null,
 *   true, // start immediately
 *   'America/Los_Angeles'
 * );
 * 
 * @example Full configuration
 * const job = new koad.crontab.CronJob({
 *   cronTime: '0 0 * * *',
 *   onTick: function() {
 *     console.log('Daily cleanup task');
 *   },
 *   onComplete: function() {
 *     console.log('Job stopped');
 *   },
 *   start: true,
 *   timezone: 'America/New_York',
 *   runOnInit: false
 * });
 * 
 * Job Methods:
 * - job.start()      - Start the job
 * - job.stop()       - Stop the job
 * - job.setTime()    - Change the schedule
 * - job.lastDate()   - Last execution time
 * - job.nextDates()  - Next scheduled times
 * - job.addCallback()- Add additional callbacks
 */

koad.crontab = Npm.require('cron');

/**
 * Helper: Create Simple Cron Job
 * 
 * Convenience wrapper for creating basic cron jobs.
 * 
 * @param {String} schedule - Cron schedule expression
 * @param {Function} callback - Function to execute
 * @param {Object} options - Optional configuration
 * @returns {CronJob} Started cron job
 * 
 * @example
 * koad.cron.create('0 * * * * *', () => {
 *   console.log('Every minute');
 * });
 */
koad.cron = {
	create: (schedule, callback, options = {}) => {
		const job = new koad.crontab.CronJob({
			cronTime: schedule,
			onTick: callback,
			timezone: options.timezone || 'UTC',
			start: options.start !== false, // Default to true
			runOnInit: options.runOnInit || false,
			...options
		});

		if (options.start !== false) {
			job.start();
		}

		return job;
	},

	/**
	 * Validate Cron Expression
	 * 
	 * @param {String} expression - Cron expression to validate
	 * @returns {Boolean} True if valid
	 */
	validate: (expression) => {
		try {
			new koad.crontab.CronTime(expression);
			return true;
		} catch (error) {
			return false;
		}
	}
};

log.success('loaded koad-io-core/cron');
