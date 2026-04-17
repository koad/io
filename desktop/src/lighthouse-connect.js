
/**
 * File Description: Makes available a koad:io lighthouse, functions to connect to an instance as well as subscribes to chores.
 * Author: koad
 * License: MIT
 * Latest Version: https://gist.github.com/johndoe/12345
 * Setup: npm install simpleddp isomorphic-ws
 */

const DEBUG = process.env.DEBUG || false;
const os = require('os'); 
const si = require('systeminformation'); 
const fs = require('fs');


const simpleDDP = require("simpleddp");
const ws = require("isomorphic-ws");

const { log, chuck, clearConsole } = require("./library/logger");
const { SECONDS, MINUTES, HOURS, DAYS } = require("./library/helpers");

let koad = {
  failure: true
}


log.info('This platform is ' + process.platform);

koad.platform = process.platform;

if (process.pid) log.info('This process is your pid ' + process.pid);
koad.process = process.pid;



const BEACON_VERSION = 'kMDZiR';
let LoggedIn = false;
let upstart = false;
let reconnects = 0;
let failures = 0;


const ENTITY_TOKEN = process.env.LIGHTHOUSE_LOGIN_TOKEN;
if (!ENTITY_TOKEN) {
  log.fatal('LIGHTHOUSE_LOGIN_TOKEN is not set — cannot connect. Set the env var and restart.');
  // Do not fall back to a hardcoded token. The token was rotated 2026-04-16.
}
// const endpoint = process.env.KOAD_IO_LIGHTHOUSE;
const endpoint = '127.0.0.1:28282'

const { app, BrowserWindow, screen } = require("electron");
const jetpack = require("fs-jetpack");


const Lighthouse = new simpleDDP({
  endpoint: `ws://${endpoint}/websocket`,
  SocketConstructor: ws,
  reconnectInterval: 5 * SECONDS
});

module.exports =  { Lighthouse }

const connect = async function(){
  log.debug('attempting to connect to', endpoint);
  let action = 'failed'
  try{
    const wasReconnect = await Lighthouse.connect()
    if (wasReconnect){
      reconnects++;
      upstart = new Date();
      log.debug('reconnecting auth')
      action = 'reconnected'
      await authenticate();
    } else action = 'connected';
    console.log(action)
  } catch(e) { log.info('DDP connection error!', e) };
  return log.debug(`${action} to server`);
};

const authenticate = async function(){
  log.info('Starting authenticate.');
  try{
    const loginResult = await Lighthouse.call("login", { "resume": ENTITY_TOKEN });
    Lighthouse.userId = loginResult.id;
    Lighthouse.expires = loginResult.expires;
  } catch(e){ 
    log.fatal('Unable to log in!!', e);
    // process.exit(1);
  };
  return `logged in as ${Lighthouse.userId}`
};

let utilities = [];
const dowork = async function(){


  const datadir = process.env.PWD;
  if(!datadir) return log.error('no datadir found... hmm..')

  if(!Lighthouse.connected) return log.fatal('Lighthouse not connected!');
  if(!Lighthouse.userId) return log.fatal('Lighthouse not authenticate!');
  // Load the utilities from files.
  var totalUtilities = 0;

  log.info(`Attempting to load utilities directory found at "${datadir}/utilities/"`);
  fs.readdir(datadir+'/utilities/', (err, files) => {
      if(err) return log.info(`No utilities directory found at "${datadir}/utilities/"`);

      let jsfile = files.filter(f=> f.split(".").pop() === "js")
      if(jsfile.length <= 0) return log.info(`No utilities found in "${datadir}/utilities/"`);

      jsfile.forEach((file, i) => {
          let props = require(`${datadir}/utilities/${file}`)
          if(props.meta.disabled) return log.info(`utility is disabled: ${datadir}/utilities/${file}`)
          log.info(`${datadir}/utilities/${file} is loaded`);
          utilities.push(props);
          totalUtilities++;
      });
      if(DEBUG) log.info(`Total utilities read from disk: ${totalUtilities}`);
      
      // Load the utilities that have the init event set to true in their metadata
    if(DEBUG) log.info('initalizing utilities');
    utilities.forEach(function(utility) {
      if(utility.meta.init) {
        if(DEBUG) log.info('util-init:', utility.meta.name);
          utility.run();
      };
    });
  });
};

const subscribeToChores = async function(publication){
    try{
        const choresSubscription = await Lighthouse.subscribe(publication);
        if(DEBUG) log.info(`subscribed to ${publication} publication`); 
        await choresSubscription.ready();
        if(DEBUG) log.success(`${publication} publication ready`); 
        return choresSubscription; 
    } catch(e){ 
        log.info('DDP connection error!', e)
        chuck(e);
    };
};

const refreshVersions = async function(){
  if(!Lighthouse.connected) return log.info('[system-information.js] Connection to Lighthouse no longer present!');
  let payload = {};
  payload.system = {};
  //only one time needed for theeeeese,...
  payload.system.versions = await si.versions();
  payload.system.users = await si.users();

  Lighthouse.call('system.information.report', payload)
  .then((res, err) => {
    if(err) return log.error("system.information.report:", err);
    if(DEBUG) log.success("system.information.report:", res);
  })
  .catch(err => {
    log.fatal("error returned from report", err);
  });
};

const refreshSystemInformation = async function(){
  if(!Lighthouse.connected) return log.info('[system-information.js] Connection to Lighthouse no longer present!');
  let payload = {};
  payload.loadavg = os.loadavg();

  payload.temperature = await si.cpuTemperature();
  payload.speed = await si.cpuCurrentspeed();
  payload.network = await si.networkStats();
  payload.load = await si.currentLoad();
  payload.storage = await si.fsSize();

  payload =  {...koad, metrics: {...payload}};
  Lighthouse.call('system.metrics.report', payload)
  .then((res, err) => {
    if(err) return log.error("system.metrics.report:", err);
    if(DEBUG) log.success("system.metrics.report:", res);
  })
  .catch(err => {
    log.fatal("error returned from report", err);
  });
};




const start = async function(){
  log.start('Starting application');
  log.info('Connecting to the DDP services...');
  await connect();
  if(Lighthouse.userId) {
    log.debug('Subscribing to our chores publication');
    const chores = await subscribeToChores('worker.chores')
    log.debug('Subscribed to our chores publication');
    await chores.ready();
    log.debug('chores publication is ready');

    log.info('dowork...');
    log.info(await dowork());
  } else return log.debug('Lighthouse connected, but not authenticated!');
  log.complete('Application startup has ended succesfully.\n');

}; 

Lighthouse.on('disconnected', (code, message) => {
  log.info(`disconnected from ${endpoint}`);
  Lighthouse.connected = null;
});

Lighthouse.on('connected', async (handshake) => {
  log.info(`connected to ${endpoint}`);
  Lighthouse.connected = handshake.session;

  if(DEBUG) log.info('Authenticate ourselves...');
  log.info(await authenticate());

  if(!Lighthouse.userId) return log.error('DDP login failed.');
  log.success('Service is alive, connected, authenticated.\n');

  let uptime = os.uptime();
  koad.upstart = new Date() - ( uptime * 1000 );

  let trigger = new Date();

  Lighthouse.call('ioHandshake', koad)
  .then((res, err) => {
    if(err) return log.error("ioHandshake:", err);
    koad.rtt = new Date() - trigger;
    if(DEBUG) log.success(`[rtt: ${koad.rtt}]`, res);
    if (res !== BEACON_VERSION) log.fatal("VERSION MISMATCH!  UPGRADE NOW!");
  })
  .catch(err => {
    log.fatal("error returned from ioHandshake", err);
  });
});



// todo :; do these oens even do anything?

Lighthouse.on('error', (e) => {
    // global errors from server
});

/* Useful for debugging and learning the ddp protocol */
Lighthouse.on('message', function (msg) {
  log.info("[ddp] message: " + msg);
});
 
Lighthouse.on('socket-close', function(code, message) {
  log.info("[ddp] Close: %s %s", code, message);
});
 
Lighthouse.on('socket-error', function(error) {
  log.info("[ddp] Error: %j", error);
});



Lighthouse.start = async ()=>{

  if (!ENTITY_TOKEN) {
    log.fatal('LIGHTHOUSE_LOGIN_TOKEN not set — aborting Lighthouse connection.');
    return;
  }

  koad.ident = os.hostname();
  koad.device = os.hostname();

  koad.version = BEACON_VERSION;
  let baseboard = await si.baseboard();
  let osInfo = await si.osInfo();

  koad.serial = osInfo.serial;

  koad.system = {
    baseboard: await si.baseboard(),
    versions: await si.versions(),
    osInfo: await si.osInfo(),
    users: await si.users()
  }

  // Connect, authenticate, subscribe to chores, and run utilities.
  await start();

  // Wire metric reporting after start() resolves and auth is confirmed.
  // These were previously dead-coded after `return start()` — now wired.
  // refreshVersions fires once immediately, then every 15 minutes.
  // refreshSystemInformation fires once immediately, then every 15 seconds.
  const versionsTimer = 15 * MINUTES;
  const loadsTimer = 15 * SECONDS;

  setInterval(async function() {
    refreshVersions();
  }, versionsTimer);
  refreshVersions();

  setInterval(async function() {
    refreshSystemInformation();
  }, loadsTimer);
  refreshSystemInformation();

};



