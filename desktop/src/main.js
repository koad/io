// This is main process of Electron, started as first thing when your
// app starts. It runs through entire life of your application.
// It doesn't have any windows which you can see on screen, but we can open
// window from here.

const electron = require('electron');
// const semver = require('semver');
const path = require("path");
const env = require("env");

const { systemTray } = require('./system/tray.js');
const { setupIPC, broadcastToRenderers, IPC_CHANNELS } = require('./system/inter-process-communication');
const { registerShortcuts, unregisterShortcuts } = require('./system/keyboard-shortcuts');
const {
  startWorkspaceEntitySelector,
  stopWorkspaceEntitySelector,
  onEntityChange,
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
  // When workspace changes, push the new entity name to all renderer windows
  // and update the tray tooltip.
  startWorkspaceEntitySelector();
  onEntityChange((entityName, workspaceStr) => {
    // Push to renderers
    broadcastToRenderers(IPC_CHANNELS.ACTIVE_ENTITY_CHANGED, { entity: entityName, workspace: workspaceStr });
    // Update tray tooltip — Application.tray is set by systemTray()
    if (Application.tray) {
      Application.tray.setToolTip(`koad:io — ${entityName}`);
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
