import os from 'os';
import { Random } from 'meteor/random';

const hostname = os.hostname();
// Generate a unique instance ID that changes on each hot reload
const instanceId = Random.id();

// Configuration constants
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 1440; // 24 hours
const MILLISECONDS_PER_MINUTE = 60 * 1000;
const MILLISECONDS_PER_SECOND = 1000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_BASE_MS = 1000; // Start with 1 second
const HEALTH_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
const STALE_WORKER_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Worker management utilities for the koad exchange rates system
 * Provides functions for worker lifecycle management, error handling, and scheduling
 */
koad.workers = koad.workers || {};
koad.workers._activeIntervals = koad.workers._activeIntervals || new Map();
koad.workers._instanceId = instanceId;
koad.workers._metrics = koad.workers._metrics || new Map();
koad.workers._healthCheckInterval = null;
koad.workers._isShuttingDown = false;

/**
 * Handles worker errors by updating the worker's state and logging the error
 * @param {string} workerId - The ID of the worker process
 * @param {Error} error - The error object to handle
 * @returns {Promise<void>}
 */
/**
 * Handles worker errors with retry logic and exponential backoff
 * @param {string} workerId - The ID of the worker process
 * @param {Error} error - The error object to handle
 * @param {number} [retryCount=0] - Current retry attempt number
 * @returns {Promise<void>}
 */
koad.workers.handleError = async function(workerId, error, retryCount = 0) {
	try {
		log.debug(`[handleError] Processing error for worker ${workerId}: ${error.message} (retry ${retryCount}/${MAX_RETRY_ATTEMPTS})`);
		
		// Update metrics
		const metrics = koad.workers._metrics.get(workerId) || { errors: 0, successes: 0 };
		metrics.errors++;
		metrics.lastError = new Date();
		koad.workers._metrics.set(workerId, metrics);
		
		const shouldMarkInsane = retryCount >= MAX_RETRY_ATTEMPTS;
		
		const result = await WorkerProcesses.updateAsync(workerId, {
			$set: {
				insane: shouldMarkInsane,
				state: shouldMarkInsane ? 'error' : 'running',
				lastError: new Date(),
				retryCount: retryCount
			},
			$push: {
				errors: {
					message: error.message.toString(),
					stack: error.stack,
					timestamp: new Date(),
					retryAttempt: retryCount
				}
			}
		});
		log.debug(`[handleError] Update result for ${workerId}: ${result} document(s) modified`);
		if (result === 0) {
			log.warning(`[handleError] Worker ${workerId} not found in database - may have been deleted`);
		}
		
		if (shouldMarkInsane) {
			log.error(`[handleError] Worker ${workerId} marked as insane after ${MAX_RETRY_ATTEMPTS} failed attempts`);
		}
	} catch (updateError) {
		log.error(`[handleError] Failed to update worker ${workerId} error state: ${updateError.message}`);
		log.error(`[handleError] Stack trace: ${updateError.stack}`);
	}
};

/**
 * Rounds up a timestamp to the nearest interval boundary
 * Useful for scheduling workers to run at consistent intervals
 * @param {Date} time - The time to round up
 * @param {number} intervalInMinutes - The interval in minutes to round to
 * @returns {Date} The rounded timestamp
 */
koad.workers.roundUpAsPerInterval = function(time, intervalInMinutes) {
	const timeToReturn = new Date(time);
	
	// Clear milliseconds (don't round up - would cause overflow to 1000ms)
	if (timeToReturn.getMilliseconds() > 0) {
		timeToReturn.setMilliseconds(0);
		timeToReturn.setSeconds(timeToReturn.getSeconds() + 1);
	}
	
	// Round up seconds to nearest minute
	if (timeToReturn.getSeconds() > 0) {
		timeToReturn.setSeconds(0);
		timeToReturn.setMinutes(timeToReturn.getMinutes() + 1);
	}
	
	// Round up minutes to nearest interval
	const currentMinutes = timeToReturn.getMinutes();
	const remainder = currentMinutes % intervalInMinutes;
	if (remainder > 0) {
		timeToReturn.setMinutes(currentMinutes + (intervalInMinutes - remainder));
	}
	
	return timeToReturn;
};

/**
 * Activates a worker process or retrieves an existing active worker
 * Creates a new worker if none exists, or validates and returns existing worker ID
 * @param {Object} options - Worker configuration options
 * @param {string} options.service - The service name for the worker
 * @param {number} options.interval - The interval in minutes for the worker
 * @returns {Promise<string|false>} Worker ID if successful, false if worker cannot be activated
 */
koad.workers.activate = async function(options) {
	// Validate options
	if (!options) {
		log.error('[activate] Malformed or missing options, cannot activate worker!');
		return false;
	}

	const { service, type, interval } = options;
	log.debug(`[activate] Attempting to activate worker: ${service} (PID: ${process.pid}, instance: ${instanceId})`);

	// Validate required parameters
	if (!service) {
		log.warning('[activate] No service specified, cannot activate worker!');
		return false;
	}
	
	// Validate service name format (alphanumeric, hyphens, underscores only)
	if (!/^[a-zA-Z0-9_-]+$/.test(service)) {
		log.error(`[activate] Invalid service name: ${service}. Must contain only alphanumeric characters, hyphens, and underscores.`);
		return false;
	}

	if (!type) {
		log.warning(`[activate] No type specified for service: ${service}`);
		return false;
	}

	if (!interval) {
		log.warning(`[activate] No interval specified for service: ${service}`);
		return false;
	}
	
	// Validate interval bounds
	if (interval < MIN_INTERVAL_MINUTES) {
		log.error(`[activate] Interval ${interval} is below minimum of ${MIN_INTERVAL_MINUTES} minute(s) for service: ${service}`);
		return false;
	}
	
	if (interval > MAX_INTERVAL_MINUTES) {
		log.error(`[activate] Interval ${interval} exceeds maximum of ${MAX_INTERVAL_MINUTES} minute(s) for service: ${service}`);
		return false;
	}

	// Check for existing active worker in database
	// This catches both different PIDs and same PID with different instance IDs (hot reload)
	log.debug(`[activate] Checking for existing active worker for ${service}`);
	const existingWorker = await WorkerProcesses.findOneAsync({
		service,
		host: hostname,
		state: { $in: ['starting', 'running'] },
		$or: [
			{ pid: { $ne: process.pid } },
			{ instanceId: { $ne: instanceId } }
		]
	});

	if (existingWorker) {
		const reason = existingWorker.pid !== process.pid
			? `different process (PID: ${existingWorker.pid})`
			: 'hot reload (same PID, different instance)';
		log.warning(`[activate] Worker ${service} is already running in ${reason}. Deactivating old worker.`);
		log.debug(`[activate] Existing worker details - ID: ${existingWorker._id}, PID: ${existingWorker.pid}, instance: ${existingWorker.instanceId}`);
		
		try {
			const updateResult = await WorkerProcesses.updateAsync(existingWorker._id, {
				$set: {
					state: 'stopped',
					stoppedAt: new Date(),
					stoppedBy: 'restart'
				}
			});
			log.debug(`[activate] Deactivation result: ${updateResult} document(s) updated`);
			if (updateResult === 0) {
				log.warning(`[activate] RACE CONDITION: Worker ${existingWorker._id} was not found - may have been stopped by another process`);
			}
		} catch (updateError) {
			log.error(`[activate] Failed to deactivate existing worker: ${updateError.message}`);
			log.error(`[activate] Stack trace: ${updateError.stack}`);
		}
	} else {
		log.debug(`[activate] No existing active worker found for ${service}`);
	}

	// Check for any worker record for this service
	log.debug(`[activate] Looking for any worker record for ${service} on ${hostname}`);
	const workerRecord = await WorkerProcesses.findOneAsync({
		service,
		host: hostname
	});

	// Create or update worker record
	if (!workerRecord) {
		log.debug(`[activate] No existing worker record found, creating new one for ${service}`);
		const newWorker = {
			created: new Date(),
			upstart: new Date(),
			host: hostname,
			pid: process.pid,
			instanceId: instanceId,
			enabled: true,
			insane: false,
			errors: [],
			type: type,
			state: 'starting',
			...options,
		};

		try {
			const insertedWorkerId = await WorkerProcesses.insertAsync(newWorker);
			log.success(`[activate] ${service} worker newly enrolled: ${insertedWorkerId}`);
			return insertedWorkerId;
		} catch (insertError) {
			log.error(`[activate] Failed to insert new worker for ${service}: ${insertError.message}`);
			log.error(`[activate] Stack trace: ${insertError.stack}`);
			return false;
		}
	}

	log.debug(`[activate] Found existing worker record for ${service}: ${workerRecord._id}`);
	log.debug(`[activate] Worker state - disabled: ${workerRecord.disabled}, enabled: ${workerRecord.enabled}, insane: ${workerRecord.insane}`);

	// Validate worker state
	if (workerRecord.disabled) {
		log.warning(`[activate] ${service} worker is disabled.`);
		return false;
	}
	
	if (!workerRecord.enabled) {
		log.warning(`[activate] ${service} worker is not enabled.`);
		return false;
	}
	
	if (workerRecord.insane) {
		log.warning(`[activate] ${service} worker is marked as insane.`);
		return false;
	}

	// Update existing worker record with new process info
	try {
		log.debug(`[activate] Updating worker record ${workerRecord._id} with new process info`);
		const updateResult = await WorkerProcesses.updateAsync(workerRecord._id, {
			$set: {
				upstart: new Date(),
				state: 'starting',
				pid: process.pid,
				instanceId: instanceId,
				insane: false,
				errors: [],
				interval
			}
		});
		log.debug(`[activate] Update result: ${updateResult} document(s) modified`);
		if (updateResult === 0) {
			log.warning(`[activate] Worker record ${workerRecord._id} was not updated - may have been deleted`);
		}
	} catch (updateError) {
		log.error(`[activate] Failed to update worker record: ${updateError.message}`);
		log.error(`[activate] Stack trace: ${updateError.stack}`);
		return false;
	}

	log.success(`[activate] ${service} worker is active and sane.`);
	return workerRecord._id;
};

/**
 * Updates worker status to indicate it's running
 * @param {string} service - The service name
 * @returns {Promise<void>}
 */
koad.workers.updateStatus = async function(service) {
	try {
		log.debug(`[updateStatus] Updating status for ${service} (PID: ${process.pid}, instance: ${instanceId})`);
		const result = await WorkerProcesses.updateAsync(
			{
				service,
				host: hostname,
				pid: process.pid,
				instanceId: instanceId, // CRITICAL: Prevent hot-reload zombie processes from updating
				state: { $in: ['starting', 'running'] }
			},
			{
				$set: {
					asof: new Date(),
					state: 'running'
				}
			}
		);
		log.debug(`[updateStatus] Update result for ${service}: ${result} document(s) modified`);
		if (result === 0) {
			log.warning(`[updateStatus] CRITICAL: No worker found to update for ${service} - worker may have been stopped, deleted, or taken over by another instance`);
		}
	} catch (error) {
		log.error(`[updateStatus] Failed to update status for ${service}: ${error.message}`);
		log.error(`[updateStatus] Stack trace: ${error.stack}`);
		throw error; // Re-throw to let caller handle
	}
};

/**
 * Get diagnostic information about workers
 * @returns {Promise<Object>} Worker status information
 */
koad.workers.getDiagnostics = async function() {
	try {
		log.debug('[getDiagnostics] Fetching worker diagnostics');
		// Use async query to avoid blocking event loop
		const workers = await WorkerProcesses.find({
			host: hostname
		}).fetchAsync();

		const activeWorkers = workers.filter(w =>
			w.state === 'running' &&
			w.pid === process.pid &&
			w.instanceId === instanceId
		);

		const staleWorkers = workers.filter(w =>
			w.state !== 'stopped' &&
			(w.pid !== process.pid || w.instanceId !== instanceId)
		);

		const diagnostics = {
			currentPid: process.pid,
			currentInstanceId: instanceId,
			activeWorkers: activeWorkers.map(w => ({
				service: w.service,
				state: w.state,
				lastRun: w.asof,
				uptime: w.upstart ? Math.floor((Date.now() - w.upstart) / 1000) : 0
			})),
			staleWorkers: staleWorkers.map(w => ({
				service: w.service,
				state: w.state,
				pid: w.pid,
				instanceId: w.instanceId,
				lastSeen: w.asof
			})),
			intervalHandles: Array.from(koad.workers._activeIntervals.entries()).map(([service, data]) => ({
				service,
				createdAt: data.createdAt
			}))
		};
		
		log.debug(`[getDiagnostics] Found ${activeWorkers.length} active, ${staleWorkers.length} stale workers`);
		return diagnostics;
	} catch (error) {
		log.error(`[getDiagnostics] Failed to get diagnostics: ${error.message}`);
		return {
			error: error.message,
			currentPid: process.pid,
			currentInstanceId: instanceId
		};
	}
};

/**
 * Comprehensive worker startup function that handles activation, scheduling, and interval management
 * This is the recommended way to start a worker process
 * @param {Object} config - Worker configuration
 * @param {string} config.service - The service name for the worker
 * @param {number} config.interval - The interval in minutes between worker runs
 * @param {number} [config.delay=0] - Delay in minutes after the interval boundary before starting
 * @param {Function} config.task - The async function to execute on each interval
 * @param {boolean} [config.runImmediately=true] - Whether to run the task immediately after the initial delay
 * @returns {Promise<Object|false>} Object with workerId and control functions, or false if activation failed
 */
koad.workers.start = async function(config) {
	const { service, interval, delay = 0, task, runImmediately = false } = config;

	// Validate configuration
	if (!service) {
		log.error('Worker start failed: service name is required');
		return false;
	}

	if (!interval || interval <= 0) {
		log.error(`Worker start failed for ${service}: valid interval is required`);
		return false;
	}

	if (typeof task !== 'function') {
		log.error(`Worker start failed for ${service}: task must be a function`);
		return false;
	}

	// Activate the worker
	const workerId = await koad.workers.activate({ service, interval, ...config });
	
	if (!workerId) {
		log.error(`Worker start failed for ${service}: could not activate worker`);
		return false;
	}

	// Check if worker should run immediately due to missed interval
	const workerDoc = await WorkerProcesses.findOneAsync({ _id: workerId });
	
	if (!workerDoc) {
		log.error(`[start] CRITICAL: Worker ${workerId} not found after activation - may have been deleted`);
		return false;
	}
	
	const now = new Date();
	const timeSinceLastRun = workerDoc.asof ? now - workerDoc.asof : Infinity;
	const shouldRunImmediately = timeSinceLastRun >= (interval * 60 * 1000);
	
	log.debug(`[start] Worker ${service} last run: ${workerDoc.asof || 'never'}, time since: ${timeSinceLastRun === Infinity ? 'Infinity' : timeSinceLastRun + 'ms'}`);

	// Calculate next run time aligned to interval
	const nextRun = koad.workers.roundUpAsPerInterval(new Date(), interval);
	const delayMs = (nextRun - new Date()) + (delay * 60 * 1000);

	log.worker(service, `Worker initialized, will start in ${(delayMs / 1000).toFixed(0)} seconds`);
	log.worker(service, `Running every ${interval} minute(s) with ${delay} minute(s) delay`);

	// Wrapper function that handles errors, retries, and status updates
	let retryCount = 0;
	const wrappedTask = async () => {
		// Check if shutting down
		if (koad.workers._isShuttingDown) {
			log.debug(`[wrappedTask] Skipping ${service} execution - system is shutting down`);
			return;
		}
		
		try {
			log.debug(`[wrappedTask] Starting task execution for ${service}`);
			// Verify this process is still the assigned worker
			const currentWorker = await WorkerProcesses.findOneAsync({
				service,
				host: hostname,
				pid: process.pid,
				instanceId: instanceId,
				state: { $in: ['starting', 'running'] }
			});

			if (!currentWorker) {
				log.warning(`[wrappedTask] Worker ${service} (PID ${process.pid}, instance ${instanceId}) is no longer assigned. Stopping execution.`);
				// Stop this worker's intervals
				const stored = koad.workers._activeIntervals.get(service);
				if (stored) {
					log.debug(`[wrappedTask] Clearing interval for ${service}`);
					if (stored.recurringHandle) {
						Meteor.clearInterval(stored.recurringHandle);
					}
					koad.workers._activeIntervals.delete(service);
				}
				return;
			}

			log.worker(service, 'Executing task');
			const taskStartTime = Date.now();
			
			try {
				await task();
				const taskDuration = Date.now() - taskStartTime;
				log.debug(`[wrappedTask] Task completed for ${service} in ${taskDuration}ms`);
				
				// Update metrics on success
				const metrics = koad.workers._metrics.get(workerId) || { errors: 0, successes: 0, totalDuration: 0, executions: 0 };
				metrics.successes++;
				metrics.executions++;
				metrics.totalDuration += taskDuration;
				metrics.avgDuration = metrics.totalDuration / metrics.executions;
				metrics.lastSuccess = new Date();
				metrics.lastDuration = taskDuration;
				koad.workers._metrics.set(workerId, metrics);
				
				// Reset retry count on success
				retryCount = 0;
				
				await koad.workers.updateStatus(service);
			} catch (taskError) {
				// Task execution failed - implement retry logic
				retryCount++;
				log.error(`[wrappedTask] Worker ${service} task failed (attempt ${retryCount}/${MAX_RETRY_ATTEMPTS}): ${taskError.message}`);
				log.error(`[wrappedTask] Stack trace: ${taskError.stack}`);
				
				if (retryCount < MAX_RETRY_ATTEMPTS) {
					// Calculate exponential backoff
					const backoffMs = RETRY_BACKOFF_BASE_MS * Math.pow(2, retryCount - 1);
					log.warning(`[wrappedTask] Retrying ${service} in ${backoffMs}ms`);
					
					// Schedule retry
					Meteor.setTimeout(async () => {
						await wrappedTask();
					}, backoffMs);
				} else {
					// Max retries exceeded
					await koad.workers.handleError(workerId, taskError, retryCount);
					retryCount = 0; // Reset for next interval
				}
			}
		} catch (error) {
			log.error(`[wrappedTask] Worker ${service} wrapper failed: ${error.message}`);
			log.error(`[wrappedTask] Stack trace: ${error.stack}`);
			await koad.workers.handleError(workerId, error, retryCount);
		}
	};

	// Run immediately if configured or if missed last interval
	if (runImmediately || shouldRunImmediately) {
		log.debug(`[start] Running ${service} immediately (runImmediately: ${runImmediately}, shouldRunImmediately: ${shouldRunImmediately})`);
		await wrappedTask();
	}

	log.debug(`[start] Scheduling worker ${service} with delay of ${delayMs}ms`);
	
	// Store timeout handle immediately so it can be cleared if stop() is called during startup
	const timeoutHandle = Meteor.setTimeout(() => {
		log.worker(service, `Worker started, running every ${interval} minute(s)`);
		log.debug(`[start] Initial delay completed for ${service}, setting up recurring interval`);
		
		// Update worker state to running
		WorkerProcesses.updateAsync({ _id: workerId }, {
			$set: {
				state: 'running',
				lastStarted: new Date()
			}
		}).then(result => {
			log.debug(`[start] Worker state updated to running: ${result} document(s) modified`);
			if (result === 0) {
				log.warning(`[start] Worker ${workerId} not found when updating to running state`);
			}
		}).catch(error => {
			log.error(`[start] Failed to update worker state: ${error.message}`);
			log.error(`[start] Stack trace: ${error.stack}`);
		});
		
		// Set up recurring interval
		const recurringHandle = Meteor.setInterval(wrappedTask, interval * 60 * 1000);
		log.debug(`[start] Recurring interval set up for ${service} (interval: ${interval * 60 * 1000}ms)`);
		
		// Update stored handles with recurring handle
		const stored = koad.workers._activeIntervals.get(service);
		if (stored) {
			stored.recurringHandle = recurringHandle;
			log.debug(`[start] Updated interval handles for ${service}`);
		} else {
			log.warning(`[start] No stored interval found for ${service} when adding recurring handle`);
		}
		
		return recurringHandle;
	}, delayMs);
	
	// Store timeout handle immediately so stop() can clear it during startup delay
	koad.workers._activeIntervals.set(service, {
		timeoutHandle,
		recurringHandle: null, // Will be set when timeout fires
		workerId,
		createdAt: new Date()
	});
	log.debug(`[start] Timeout handle stored for ${service}`);

	// Return control object with enhanced stop function
	return {
		workerId,
		service,
		interval,
		delay,
		stop: async () => {
			try {
				log.debug(`[stop] Stopping worker ${service}`);
				const stored = koad.workers._activeIntervals.get(service);
				
				if (stored) {
					// Clear timeout if still in startup delay
					if (stored.timeoutHandle) {
						log.debug(`[stop] Clearing timeout handle for ${service}`);
						Meteor.clearTimeout(stored.timeoutHandle);
					}
					
					// Clear recurring interval if it was set
					if (stored.recurringHandle) {
						log.debug(`[stop] Clearing recurring interval for ${service}`);
						Meteor.clearInterval(stored.recurringHandle);
					}
					
					koad.workers._activeIntervals.delete(service);
				} else {
					log.warning(`[stop] No stored interval found for ${service}`);
				}

				// Update worker state in database
				log.debug(`[stop] Updating worker ${workerId} state to stopped`);
				const result = await WorkerProcesses.updateAsync({ _id: workerId }, {
					$set: {
						state: 'stopped',
						stoppedAt: new Date(),
						stoppedBy: 'manual'
					}
				});
				log.debug(`[stop] Update result: ${result} document(s) modified`);
				if (result === 0) {
					log.warning(`[stop] Worker ${workerId} not found when stopping - may have been deleted`);
				}

				log.worker(service, 'Worker stopped');
			} catch (error) {
				log.error(`[stop] Error stopping worker ${service}: ${error.message}`);
				log.error(`[stop] Stack trace: ${error.stack}`);
			}
		}
	};
};

// // Set up graceful shutdown handlers
// const shutdownHandler = () => {
// 	log.worker('system', 'Received shutdown signal');
// 	koad.workers.shutdown().then(() => {
// 		log.worker('system', 'Shutdown complete, exiting');
// 		process.exit(0);
// 	}).catch(error => {
// 		log.error(`[shutdown] Shutdown error: ${error.message}`);
// 		process.exit(1);
// 	});
// };

// // Handle various shutdown signals
// process.on('SIGTERM', shutdownHandler);
// process.on('SIGINT', shutdownHandler);

// Handle uncaught errors
process.on('uncaughtException', (error) => {
	log.error(`[uncaughtException] ${error.message}`);
	log.error(`[uncaughtException] Stack: ${error.stack}`);
	// Don't exit immediately, let other handlers run
});

process.on('unhandledRejection', (reason, promise) => {
	log.error(`[unhandledRejection] Reason: ${reason}`);
	log.error(`[unhandledRejection] Promise: ${promise}`);
});

/**
 * USAGE EXAMPLES:
 *
 * Simple worker (new streamlined API):
 * =====================================
 * Meteor.startup(async () => {
 *   await koad.workers.start({
 *     service: 'my-service',
 *     interval: 60,           // Run every 60 minutes
 *     delay: 1,               // Start 1 minute after the hour
 *     task: async () => {
 *       // Your worker logic here
 *       const data = await fetchData();
 *       await processData(data);
 *     }
 *   });
 * });
 *
 * Advanced worker with control:
 * =============================
 * Meteor.startup(async () => {
 *   const worker = await koad.workers.start({
 *     service: 'my-service',
 *     interval: 30,
 *     delay: 0,
 *     runImmediately: false,  // Don't run on first interval
 *     task: async () => {
 *       // Your worker logic
 *     }
 *   });
 *
 *   // Later, if needed:
 *   // worker.stop();
 * });
 *
 * Legacy API (still supported):
 * =============================
 * Meteor.startup(async () => {
 *   const workerId = await activateWorker({
 *     service: 'my-service',
 *     interval: 60
 *   });
 *
 *   const nextRun = roundUpAsPerInterval(new Date(), 60);
 *   const delayMs = (nextRun - new Date()) + (1 * 60 * 1000);
 *
 *   Meteor.setTimeout(() => {
 *     Meteor.setInterval(async () => {
 *       try {
 *         await myTask();
 *       } catch (error) {
 *         await handleError(workerId, error);
 *       }
 *     }, 60 * 60 * 1000);
 *   }, delayMs);
 * });
 */

