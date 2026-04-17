

function createPopoutWindow(url) {
  let popoutWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false, // Remove the window frame
    webPreferences: {
      nodeIntegration: true // Allow Node.js integration in the window
    }
  });

  popoutWindow.loadURL(url, { userAgent: 'koad:io-desktop' });

  // Handle window closed event
  popoutWindow.on('closed', () => {
    // Remove the window from the array when it's closed
    const index = createdWindows.indexOf(popoutWindow);
    if (index !== -1) {
      createdWindows.splice(index, 1);
    }
    popoutWindow = null;
  });

  createdWindows.push(popoutWindow);
};
