
let selectedEntity = 'Astro'; // Default selected entity
let selectedBrowser = 'Brave'; // Default selected browser
let passengers = []; // Dynamic passenger list

const ENTITY_TOKEN = process.env.Daemon_LOGIN_TOKEN;
if (!ENTITY_TOKEN) {
  // Daemon_LOGIN_TOKEN is required. The hardcoded fallback was removed 2026-04-16
  // after token rotation. Without this token the DDP authenticate() call will fail.
  console.error('[tray] Daemon_LOGIN_TOKEN is not set — authentication will fail.');
}
const DDP_ENDPOINT = process.env.KOAD_IO_Daemon || '127.0.0.1:28282';

/**
 * File Description: Makes available a koad:io daemon, which is a bus for each entity to become as one.
 * Author: koad
 * License: MIT
 * Latest Version: https://gist.github.com/johndoe/12345
 * Setup: npm install ws simpleddp signale
 */


const { app, Menu, Tray } = require('electron');
const { logger } = require('../library/logger.js');
const simpleDDP = require("simpleddp");
const ws = require("ws");


const SECONDS = 1000;
const MINUTES = SECONDS * 60;
const HOURS = MINUTES * 60;
const DAYS = HOURS * 24;

let LoggedIn = false;
let upstart = false;
let reconnects = 0;
let failures = 0;
const DEBUG=true;


let koad = {
  failure: true,
  process: process.pid,
  platform: process.platform
}

if (koad.platform) logger.info('This platform is ' + process.platform);
if (koad.process) logger.info('This process is your pid ' + process.pid);

const Daemon = new simpleDDP({
  endpoint: `ws://${DDP_ENDPOINT}/websocket`,
  SocketConstructor: ws,
  reconnectInterval: 5 * SECONDS
});

const authenticate = async function(){
  logger.info('Starting authenticate.');
  try{
    const loginResult = await Daemon.call("login", { "resume": ENTITY_TOKEN });
    Daemon.userId = loginResult.id;
    Daemon.expires = loginResult.expires;
  } catch(e){ 
    logger.fatal('Unable to log in!!', e);
  };
  return `logged in as ${Daemon.userId}`
};

const connect = async function(){
  logger.debug('attempting to connect to', DDP_ENDPOINT);
  let action = 'failed'
  try{
    const wasReconnect = await Daemon.connect()
    if (wasReconnect){
      reconnects++;
      upstart = new Date();
      action = 'reconnected'
      await authenticate();
    } else {
      action = 'connected';
      await authenticate();
    }
  } catch(e) { logger.info('DDP connection error!', e) };
  return logger.debug(`${action} to server`);
};

Daemon.on('disconnected', (code, message) => {
  logger.info(`disconnected from ${DDP_ENDPOINT}`);
  Daemon.connected = null;
});

Daemon.on('connected', async (handshake) => {
  logger.info(`connected to ${DDP_ENDPOINT}`);
  Daemon.connected = handshake.session;

  if(!Daemon.userId){
     logger.error('DDP login failed.');
  } else logger.success('Service is alive, connected, authenticated.\n');

  // Subscribe to all passengers from the daemon
  const passengersSub = Daemon.subscribe('all');
  const passengersCollection = Daemon.collection('Passengers');
  
  passengersSub.ready().then(() => {
    passengers = passengersCollection.fetch();
    updateContextMenu();
  });

  passengersCollection.onChange(() => {
    passengers = passengersCollection.fetch();
    updateContextMenu();
  });

  let trigger = new Date();
  entitySelect(selectedEntity)

  .then((res, err) => {
    if(err) return logger.error("passenger.check.in:", err);
    const rtt = new Date() - trigger;
    if(DEBUG) logger.success(`passenger.check.in [rtt: ${rtt}]: `, res);
    Daemon.passenger = res;
  })
  .catch(err => {
    logger.fatal("error returned from ioHandshake", err);
  });
});

Daemon.start = async ()=>{
  logger.start('Starting application');
  await connect();
  if(Daemon.userId) {
    logger.debug('Daemon connected, authenticated as user', Daemon.userId);
  } else logger.debug('Daemon connected, but not authenticated!');
  logger.complete('Application startup has ended succesfully.\n');
};

function selectBrowser(browser) {
  selectedBrowser = browser;
  updateContextMenu();
  console.log('Selected browser:', browser);
  // Implement logic to handle browser selection
}

function updateContextMenu() {
  const menuItems = passengers.map(p => ({
    label: p.name,
    type: 'radio',
    checked: selectedEntity === p.name,
    click: () => { entitySelect(p.name); },
    groupName: 'entity'
  }));

  if (menuItems.length === 0) {
    menuItems.push({ label: 'No passengers found', enabled: false });
  }

  const contextMenu = Menu.buildFromTemplate([
    ...menuItems,
    { type: 'separator' },

    {
      label: `Browser: ${selectedBrowser}`,
      submenu: [
        { label: 'Brave', type: 'radio', checked: selectedBrowser === 'Brave', click: () => { selectBrowser('Brave'); } },
        { label: 'Chrome', type: 'radio', checked: selectedBrowser === 'Chrome', click: () => { selectBrowser('Chrome'); } },
        { label: 'Chromium', type: 'radio', checked: selectedBrowser === 'Chromium', click: () => { selectBrowser('Chromium'); } }
      ]
    },
    { type: 'separator' },
    { 
      label: 'settings',
      click: () => {
        logger.debug('settings is activated!') 
      }
    },
    { label: 'quit application', click: () => { app.quit(); }}
  ]);
  
  if (Application.tray) {
    Application.tray.setContextMenu(contextMenu);
  }
}


const entitySelect = async (entity) => {
  let trigger = new Date();
  Daemon.call('passenger.check.in', entity)
  .then((res, err) => {
    if(err) return logger.error("passenger.check.in:", err);
    const rtt = new Date() - trigger;
    if(DEBUG) logger.success(`passenger.check.in [rtt: ${rtt}]: `, res);
    selectedEntity = entity;
    updateContextMenu();
    Daemon.passenger = res;
  })
  .catch(err => {
    logger.fatal("error returned from passenger checkin", err);
  });
}

const systemTray = async () => {
  logger.debug('setting system tray')
  Application.tray = new Tray('./resources/logo-32x.png');
  // Tooltip reflects the active entity; workspace-entity-selector updates it
  // on each workspace change. Seed with current Application state if available,
  // otherwise a generic label until the first workspace poll fires.
  const initialEntity = (globalThis.Application && globalThis.Application.activeEntity) || 'koad:io';
  Application.tray.setToolTip(`koad:io — ${initialEntity}`);
  updateContextMenu();
  logger.info('system tray is ready');
};

/**
 * Proxy to call any Meteor method on the daemon via the shared DDP connection.
 * Returns a Promise. Resolves when the daemon acknowledges the call.
 * Safe to call before connection is established — simpleDDP queues calls.
 */
const daemonCall = (method, ...args) => Daemon.call(method, ...args);

module.exports = {
  systemTray,
  entitySelect,
  daemonCall,
};
