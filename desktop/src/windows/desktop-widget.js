// This helper remembers the size and position of your windows, and restores
// them in that place after app relaunch.
// Can be used for more than one window, just construct many
// instances of it and give each different name.

const { app, BrowserWindow, screen } = require("electron");
const jetpack = require("fs-jetpack");
const url = require("url");
const env = require("env");
const { logger, chuck, clearConsole } = require("../library/logger");
const path = require('path');


module.exports = (name) => {
  const userDataDir = jetpack.cwd(app.getPath("userData"));
  const stateStoreFile = `window-state-${name}.json`;
  const defaultSize = {
    width: 620,
    height: 227,
  };
  let state = {};
  let win;

  const restore = () => {
    let restoredState = {};
    try {
      restoredState = userDataDir.read(stateStoreFile, "json");
    } catch (err) {
      // For some reason json can't be read (might be corrupted).
      // No worries, we have defaults.
    }
    return Object.assign({}, defaultSize, restoredState);
  };

  const getCurrentPosition = () => {
    const position = win.getPosition();
    const size = win.getSize();
    return {
      x: position[0],
      y: position[1],
      width: size[0],
      height: size[1]
    };
  };

  const windowWithinBounds = (windowState, bounds) => {
    return (
      windowState.x >= bounds.x &&
      windowState.y >= bounds.y &&
      windowState.x + windowState.width <= bounds.x + bounds.width &&
      windowState.y + windowState.height <= bounds.y + bounds.height
    );
  };

  const resetToDefaults = () => {
    const bounds = screen.getPrimaryDisplay().bounds;
    return Object.assign({}, defaultSize, {
      x: (bounds.width - defaultSize.width) / 2,
      y: (bounds.height - defaultSize.height) / 2
    });
  };

  const ensureVisibleOnSomeDisplay = windowState => {
    const visible = screen.getAllDisplays().some(display => {
      return windowWithinBounds(windowState, display.bounds);
    });
    if (!visible) {
      // Window is partially or fully not visible now.
      // Reset it to safe defaults.
      return resetToDefaults();
    }
    return windowState;
  };

  const saveState = () => {
    if (!win.isMinimized() && !win.isMaximized()) {
      Object.assign(state, getCurrentPosition());
    }
    userDataDir.write(stateStoreFile, state, { atomic: true });
  };

  state = ensureVisibleOnSomeDisplay(restore());

  win = new BrowserWindow(Object.assign({
    autoplayPolicy: 'no-user-gesture-required',
    frame: false,
    alwaysOnTop: false,
    autoHideMenuBar: true,
    width: 620,
    height: 227,
    x: 1920,
    y: 1220,
    resizable: false,
    transparent: true,

    // resizable: false,
    type: 'utility', // Set the window type to "utility"
    skipTaskbar: true, // Set this option to true to prevent window from appearing in the taskbar

    // icon: './resources/1up-solo.png',
    icon: './resources/logo-512x.png',
    webPreferences: {
      // properties below are security hazard. 
      // Make sure you know what you're doing in your production app.

      nodeIntegration: true,
      // nodeIntegration: false,

      // enableRemoteModule: true,
      enableRemoteModule: false,

      contextIsolation: true,
      // contextIsolation: false,

      // preload: path.join(__dirname, 'preload.js'),

      // Spectron needs access to remote module
      enableRemoteModule: env.name === "test"
    }

  }));

  win.on("close", saveState);

  app.setPath ('userData', `${process.env.HOME}/.koad-io/desktop/.local/userdata`);

  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  });

  win.loadURL(
    url.format({
      pathname: '127.0.0.1:28282',
      protocol: "http:",
      slashes: true
    }), {userAgent: 'koad:io-desktop'} // does this work?
  );

  // if (env.name === "development") {
    logger.debug('development mode')
    win.openDevTools({mode: 'undocked'});
  // }

  return win;
};
