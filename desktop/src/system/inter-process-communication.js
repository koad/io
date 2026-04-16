// inter-process-communication.js
// We can communicate with our window (the renderer process) via messages.

const { ipcMain, BrowserWindow } = require('electron');

// Reset position to default bottom-left corner pinning
const xOffset = 1922; // Adjust horizontal position if needed
const yOffset = 1438; // Adjust vertical position based on default height

// Define your IPC channels here
const IPC_CHANNELS = {
  EXAMPLE_CHANNEL: 'example-channel',
  // Workspace entity selection — renderer can query the daemon directly via DDP.
  // ACTIVE_ENTITY_CHANGED kept as a named constant for any legacy renderer code
  // that may still listen; the daemon's 'current' publication is the authoritative source.
  ACTIVE_ENTITY_CHANGED: 'active-entity-changed',   // kept for compat (no longer pushed from main)
};

// Broadcast a message to all renderer windows.
const broadcastToRenderers = (channel, data) => {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
};

// Functions to handle IPC events
const setupIPC = (mainWindow) => {
  // Main process listens for events
  ipcMain.on(IPC_CHANNELS.EXAMPLE_CHANNEL, (event, data) => {
    console.log('PC_CHANNELS.EXAMPLE_CHANNEL')
    // Handle the event, perform actions
    console.log('Main process received data:', data);
    
    // You can send a response back if needed
    event.sender.send(IPC_CHANNELS.EXAMPLE_CHANNEL, 'Message received in the main process');
  });

  ipcMain.on("need-app-path", (event, arg) => {
    console.log('need-app')
    event.reply("app-path", app.getAppPath());
  });
  
  ipcMain.on("open-external-link", (event, href) => {
    console.log('open-external')
    shell.openExternal(href);
  });

  ipcMain.on('minimize-window', () => {
    console.log('minimize-window')
    mainWindow.minimize();
  });

  ipcMain.on('maximize-window', () => {
    console.log('maximize-window')
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on('close-window', () => {
    console.log('close-window')
    mainWindow.close();
  });

  ipcMain.on('zoom-in', (event) => {
    const factor = event.sender.getZoomFactor()
    const newFactor = factor + 0.1;
    event.sender.setZoomFactor(newFactor);
    mainWindow.setSize(Math.floor(230 * newFactor), Math.floor(227 * newFactor));
    mainWindow.setPosition(xOffset, yOffset - Math.floor(227 * newFactor) );
  });

  ipcMain.on('zoom-out', (event) => {
    const factor = event.sender.getZoomFactor()
    const newFactor = factor - 0.1;
    event.sender.setZoomFactor(newFactor);
    mainWindow.setSize(Math.floor(230 * newFactor), Math.floor(227 * newFactor));
    mainWindow.setPosition(xOffset, yOffset - Math.floor(227 * newFactor) );
  });

  ipcMain.on('reset-zoom', (event) => {
    console.log('reset-zoom')
    mainWindow.webContents.setZoomFactor(1);
    mainWindow.setSize(260, 227);
    mainWindow.setPosition(xOffset, yOffset - 227);
  });

  // Active entity state is owned by the daemon — renderers query it via DDP
  // subscription ('current' publication on the Passengers collection).
  // No IPC handles needed here for entity state.

};

const sendToRendererProcess = (channel, data) => {
  ipcMain.on(channel, (event, data) => {
    console.log(`ipcMain.on(${channel})`);
    console.log({channel, data})
    event.sender.send(channel, data);
  });
};

// sendToMainProcess is a no-op alias kept for keyboard-shortcuts.js compatibility.
// In Electron the main process is the receiver, not a sender target via ipcMain.
// Callers that want to send to renderers should use broadcastToRenderers instead.
const sendToMainProcess = (channel, data) => {
  console.log(`sendToMainProcess(${channel}):`, data);
};

module.exports = {
  IPC_CHANNELS,
  setupIPC,
  broadcastToRenderers,
  send: sendToRendererProcess,
  sendToMainProcess,
};
