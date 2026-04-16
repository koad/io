// This is main process of Electron, started as first thing when your
// app starts. It runs through entire life of your application.
// It doesn't have any windows which you can see on screen, but we can open
// window from here.

const electron = require('electron');
// const semver = require('semver');
const path = require("path");
const env = require("env");

const { systemTray, daemonCall } = require('./system/tray.js');
const { setupIPC, broadcastToRenderers, IPC_CHANNELS } = require('./system/inter-process-communication');
const { registerShortcuts, unregisterShortcuts } = require('./system/keyboard-shortcuts');
const {
  startWorkspaceEntitySelector,
  stopWorkspaceEntitySelector,
  onWorkspaceChange,
} = require('./system/workspace-entity-selector');
const { logger, chuck, clearConsole } = require("./library/logger");
const { SECONDS, MINUTES, HOURS, DAYS } = require("./library/helpers");
const { watchForUpdates } = require('./system/auto-updates');

const { Lighthouse } = require("./lighthouse-connect.js");

const appMenuTemplate = require("./menus/app");
const editMenuTemplate = require("./menus/edit");
const devMenuTemplate = require("./menus/development");

const mainWindowTemplate = require("./windows/desktop-widget");

const DEBUG = process.env.DEBUG || false;

const { app, Menu, ipcMain, shell, globalShortcut, BrowserWindow } = electron;
const { join } = path;

const createdWindows = [];

globalThis.Application = {
  asof: new Date()
}

// Special module holding environment variables which you declared
// in config/env_xxx.json file.

// Save userData in separate folders for each environment.
// Thanks to this you can use production and development versions of the app
// on same machine like those are two separate apps.

if (env.name !== "production") {
  const userDataPath = app.getPath("userData");
  app.setPath("userData", `${userDataPath} (${env.name})`);
}

const setApplicationMenu = () => {
  const menus = [appMenuTemplate, editMenuTemplate];
  if (env.name !== "production") {
    menus.push(devMenuTemplate);
  }
  // Menu.setApplicationMenu(null); // no menu
  Menu.setApplicationMenu(Menu.buildFromTemplate(menus));
};


// electron.protocol.registerSchemesAsPrivileged([
//     { scheme: 'koad', privileges: { standard: true, secure: true } }
// ]);


app.on("ready", () => {
  logger.debug("app signaled ready");
  systemTray();
  Lighthouse.start();
  registerShortcuts();
  setApplicationMenu();

  // Create main window and store the reference
  mainWindow = mainWindowTemplate("main");

  // Pass the mainWindow to the IPC setup function
  setupIPC(mainWindow);

  // Start per-workspace entity selection.
  // The selector polls xdotool and reports the workspace number to the daemon
  // via DDP. The daemon owns the mapping and updates the Passengers collection
  // reactively. The widget reads the active entity via DDP subscription — no
  // local state held here.
  startWorkspaceEntitySelector(daemonCall);
  onWorkspaceChange((workspaceStr, entityHandle) => {
    // Update tray tooltip from daemon-confirmed entity handle.
    if (Application.tray && entityHandle) {
      Application.tray.setToolTip(`koad:io — ${entityHandle}`);
    }
  });

  // watchForUpdates();
  logger.success("app ready");

  // electron.protocol.registerHttpProtocol('koad', (request, callback) => {
  //   // Handle the custom protocol request here
  //   const url = request.url.substr(7); // Remove 'myapp://'
  //   console.log(`Custom protocol URL: ${url}`);

  //   // Open your Electron app here
  //   createMainWindow();
  // });

});

// todo: check settings, see if it shall close if all windows are closed.
app.on("window-all-closed", () => {
  logger.debug("app window-all-closed");
  // app.quit();
});

// Unregister shortcuts and stop workspace polling when the app is quitting
app.on('will-quit', () => {
  logger.debug("app will-quit");
  unregisterShortcuts();
  stopWorkspaceEntitySelector();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindowTemplate()
  }
});
