const os = Npm.require('os'); 
const fs = Npm.require('fs'); 
const si = Npm.require('systeminformation');
const nmi  = Npm.require('node-machine-id');

const machineID = nmi.machineIdSync();
const DEVICE_UPDATE_INTERVAL = 6 * MINUTES;
const PROCESS_UPDATE_INTERVAL = 1 * MINUTES;
const UPDATE_INTERVAL_TIMEOUT = 6 * SECONDS;

let DEVICE_TIMER;
let PROCESS_TIMER;

// Takes an amount of milliseconds, and returns the time at which the process should be declared dead.
// Uses UPDATE_INTERVAL_TIMEOUT as a slush, to subsidize db read+write and method calls.
var timeOfDeath = function (interval) {
	var now = new Date();
	return new Date(now.getTime() - ( interval + UPDATE_INTERVAL_TIMEOUT ) );
};

// If our program is within a repo, we save the repo's last commit hash with our process.
let revision  = 'ungit';
const isGitRepo = false;
// const isGitRepo = Npm.require('child_process').execSync(`cd ${process.env.CWD} && git rev-parse --is-inside-work-tree 2>/dev/null`, {encoding: 'utf8'});
if(isGitRepo == 'true\n') revision = Npm.require('child_process')
  .execSync(`cd ${process.env.CWD} && git rev-parse HEAD`)
  .toString().trim()


async function updateDeviceInformation() {

  try {

		let device = ApplicationDevices.findOne(koad.device);
		if(!device){
			log.error('hardware information lost!');
			process.exit(1);
		}; 

		// TODO: cleanup 
		// Different process on this hardware is doing the reporting, but lets also make sure here that each process is still alive.
		let aliveDevices = ApplicationDevices.find({
			complete: {$exists: 0},
			stranded: {$exists: 0},
			orphaned: {$exists: 0}
		});

		aliveDevices.forEach((d)=>{
			if(!d.reporter){
				// there is no reporter, we take over in next function
			}else if(d.asof < timeOfDeath(d.reporter.interval)) ApplicationDevices.update({ _id: d._id }, { $set: {
				state: 'stranded', 
				stranded: new Date(),
			}, $unset: { reporter: 1 }});
		});

		if(device.reporter && device.reporter.process != koad.process) return; // log.debug('different process is reporting, and is alive...');
		
		if(!device.reporter){
			log.success('hardware reporter not on duty!  taking over job.');
			ApplicationDevices.update({_id: koad.device}, {
				$set: {
					state: 'online',
					reporter: {
						process: koad.process,
						interval: DEVICE_UPDATE_INTERVAL,
						asof: new Date()
					}
				}, 
				$unset: { stranded: 1 },
			});
		};

		// todo: make this work > >alpha alert!
		// todo: make this work > >alpha alert!
		// todo: make this work > >alpha alert!
		
		let devInfo = {};
		// devInfo.baseboard = await si.baseboard();
		// devInfo.chassis = await si.chassis();
		// devInfo.bios = await si.bios();
		// devInfo.system = await si.system();
		// devInfo.graphics = await si.graphics();
		// devInfo.interfaces = await si.networkInterfaces();
		// devInfo.version = await si.version();
		// devInfo.currentLoad = await si.currentLoad();
		// devInfo.time = await si.time();

		// const docker = {
		// 	... await si.dockerInfo(),
		// 	containers: await si.dockerContainers(),
		// 	volumes: await si.dockerVolumes(),
		// }

		ApplicationDevices.update({_id: koad.device}, {$set: {
			// hostname: os.hostname(),
			asof: new Date(),
			system: {
		...devInfo
			}
		}});

  } catch (error) {
    log.error("An error occurred wile updating device information");
    console.error({error});
    // Cancel the next scheduled update
    Meteor.clearTimeout(DEVICE_TIMER);
  }
};


async function updateProcessInformation() {

  try {
		let instance = ApplicationProcesses.findOne(koad.process);
		if(!instance) {
			log.error('process instance not found!');
			process.exit(1);
		};
		
		if(instance.killed) {
			log.error('process kill signal!');
			process.exit(1);
		};


		// Any old process record from before,. lets complete it.
		ApplicationProcesses.update({ 
			_id: {$ne: koad.process},
			device: koad.device, 
			entity: process.env.ENTITY, 
			description: process.env.KOAD_IO_APP_NAME || Meteor.settings.public?.application?.name,
			hostname: os.hostname(),
			completed: {$exists: 0},
		}, {$set: {state: 'complete', completed: new Date(), nextProcess: koad.process} }, {multi: true});

		// Different process on this hardware is doing the reporting, but lets also make sure here that each process is still alive.
		let runningProcesses = ApplicationProcesses.find({
			_id: {$ne: koad.process},
			state: 'running'
		});

		runningProcesses.forEach((proc)=>{
			if(proc.asof < timeOfDeath(proc.interval)) ApplicationProcesses.update({ _id: proc._id }, { $set: {state: 'orphaned', orphaned: new Date()} });
		});

		const used = process.memoryUsage().heapUsed / 1024 / 1024;
		ApplicationProcesses.update(koad.process, {$set: {
			asof: new Date(),
			state: 'running',
			"system.memory": process.memoryUsage(),
		}});

  } catch (error) {
    log.error("An error occurred wile updating process information");
    console.error({error});
    // Cancel the next scheduled update
    Meteor.clearTimeout(PROCESS_TIMER);
  };

};


async function processUpstart() {

	let hardware = ApplicationDevices.findOne({uuid: machineID});
	if(!hardware) {
		koad.device = ApplicationDevices.insert({
				hostname: os.hostname(),
				discovered: new Date(),
				description: process.env.HARDWARE_DESCRIPTION,
				uuid: machineID, 
				arch: process.arch,
				platform: process.platform,
				root: false,
				versions: process.versions,
				os: {
				 type: os.type(),
				 release: os.release(),
				}
			});
	} else {
		koad.device = hardware._id
	};

	let database = {
		user: process.env.DB_USER_NAME,
		database: process.env.DB_NAME,
		host: process.env.DB_HOST,
		port: process.env.DB_PORT,
	};

	let entity = {
		name: process.env.ENTITY,
		commands: process.env.ENTITY_COMMANDS_DIR,
	};

	let meteor = {
		APP_ID: process.env.APP_ID,
		METEOR_PACKAGE_DIRS: process.env.METEOR_PACKAGE_DIRS,
		MOBILE_DDP_URL: process.env.MOBILE_DDP_URL,
		MOBILE_ROOT_URL: process.env.MOBILE_ROOT_URL,
		METEOR_AUTO_RESTART: process.env.METEOR_AUTO_RESTART,
		METEOR_SHELL_DIR: process.env.METEOR_SHELL_DIR,
		METEOR_REIFY_CACHE_DIR: process.env.METEOR_REIFY_CACHE_DIR,
		METEOR_PARENT_PID: process.env.METEOR_PARENT_PID,
		METEOR_PRINT_ON_LISTEN: process.env.METEOR_PRINT_ON_LISTEN,
	};

	let user = {
		SHELL: process.env.SHELL,
		USERNAME: process.env.USERNAME,
		USER: process.env.USER,
		HOME: process.env.HOME,
	};

	// TODO : make this into a sanity checker.  If any of these settings are not set, make the user aware and exit.
	let settings = {
		CWD: process.env.CWD,
		PWD: process.env.PWD,
		ROOT_URL: process.env.ROOT_URL,
		PORT: process.env.PORT,
		HTTP_FORWARDED_COUNT: process.env.HTTP_FORWARDED_COUNT,
		KOAD_IO_DOMAIN_WILDCARD: process.env.KOAD_IO_DOMAIN_WILDCARD,
		KOAD_IO_HOST: process.env.KOAD_IO_HOST,
		KOAD_IO_APP_NAME: process.env.KOAD_IO_APP_NAME,
		KOAD_IO_BEACON: process.env.KOAD_IO_BEACON,
		KOAD_IO_DOMAIN: process.env.KOAD_IO_DOMAIN,
		KOAD_IO_COMMANDS_DIR: process.env.KOAD_IO_COMMANDS_DIR,
		KOAD_IO_PORT: process.env.KOAD_IO_PORT,
		KOAD_IO_INSTANCE: process.env.KOAD_IO_INSTANCE,
		KOAD_IO_EXIT_PORT_PREFIX: process.env.KOAD_IO_EXIT_PORT_PREFIX,
		KOAD_IO_WEBAPP: process.env.KOAD_IO_WEBAPP,
		KOAD_IO_BIND_IP: process.env.KOAD_IO_BIND_IP,
		KOAD_IO_USER: process.env.KOAD_IO_USER,
		KOAD_IO_TYPE: process.env.KOAD_IO_TYPE,
		KOAD_IO_EXIT: process.env.KOAD_IO_EXIT,
		KOAD_IO_NETWORK: process.env.KOAD_IO_NETWORK,
		KOAD_IO_LIGHTHOUSE: process.env.KOAD_IO_LIGHTHOUSE,
		KOAD_IO_TYPE: process.env.KOAD_IO_TYPE,
		KOAD_IO_BUILDDIR: process.env.KOAD_IO_BUILDDIR,
		KOAD_IO_DATADIR: process.env.KOAD_IO_DATADIR,
		XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE,
	};

	koad.env = process.env.NODE_ENV;
	let proc = {
		device: koad.device,
		pid: Number(process.pid),
		hostname: os.hostname(),
		entity: process.env.ENTITY,
		user: process.env.USERNAME || process.env.USER,
		description: process.env.KOAD_IO_APP_NAME || Meteor.settings.public?.application?.name,
		started: new Date(),
		state: 'starting',
		interval: PROCESS_UPDATE_INTERVAL,
		revision,
		database,
		settings,
		meteor,
	};

	// then start a new record.
	koad.process = ApplicationProcesses.insert(proc);
  
  // Scheduling
  DEVICE_TIMER = Meteor.setInterval(updateDeviceInformation, DEVICE_UPDATE_INTERVAL);
  PROCESS_TIMER = Meteor.setInterval(updateProcessInformation, PROCESS_UPDATE_INTERVAL);

};

// Main startup
Meteor.startup(function () {
  // Initialization
	log.start('entity coordination started for process', koad.internals);
  processUpstart();
});

log.success('loaded koad-io/system-information-scraper.js');
