
let selectedEntity = 'Astro'; // Default selected entity
let selectedBrowser = 'Brave'; // Default selected browser
let passengers = []; // Dynamic passenger list

/**
 * File Description: Makes available a koad:io daemon, which is a bus for each entity to become as one.
 * Author: koad
 * License: MIT
 * Latest Version: https://gist.github.com/johndoe/12345
 * Setup: npm install ws simpleddp signale
 *
 * DDP connection: shared with lighthouse-connect.js via the Lighthouse instance.
 * Do not open a second simpleDDP connection here — use the shared one.
 */


const { app, Menu, Tray } = require('electron');
const { logger } = require('../library/logger.js');

// Shared DDP connection — single instance for the whole desktop process.
// lighthouse-connect.js owns the connection lifecycle (connect, auth, reconnect).
const { Lighthouse: Daemon } = require('../lighthouse-connect.js');

const DEBUG = true;

Daemon.on('connected', async (handshake) => {
  logger.info(`[tray] connected to daemon`);

  if (!Daemon.userId) {
    logger.error('[tray] DDP not yet authenticated — waiting for lighthouse auth.');
  } else {
    logger.success('[tray] Service is alive, connected, authenticated.\n');
  }

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
    if (err) return logger.error("passenger.check.in:", err);
    const rtt = new Date() - trigger;
    if (DEBUG) logger.success(`passenger.check.in [rtt: ${rtt}]: `, res);
    Daemon.passenger = res;
  })
  .catch(err => {
    logger.fatal("error returned from ioHandshake", err);
  });
});

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
    if (err) return logger.error("passenger.check.in:", err);
    const rtt = new Date() - trigger;
    if (DEBUG) logger.success(`passenger.check.in [rtt: ${rtt}]: `, res);
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
