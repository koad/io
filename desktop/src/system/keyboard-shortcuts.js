// keyboard-shortcuts.js
const { globalShortcut } = require('electron');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const { logger } = require('../library/logger.js');
const { IPC_CHANNELS, sendToMainProcess } = require('./inter-process-communication.js');
const basin = require("../groove-basin/index.js");

const shortcutsDirectory = path.join(process.env.HOME, '.koad-io', 'shortcuts');

function compareSortKeyThenId(a, b) {
  if (a.sortKey < b.sortKey) {
    return -1;
  } else if (a.sortKey > b.sortKey) {
    return 1;
  } else if (a.id < b.id) {
    return -1;
  } else if (a.id > b.id) {
    return 1;
  } else {
    return 0;
  }
}

const groove = new basin();
groove.on('connect', function () {
  logger.info('Connected to groove');
  groove.send('subscribe', { name: 'streamEndpoint' });
  groove.send('subscribe', { name: 'libraryQueue' });
  groove.send('subscribe', { name: 'currentTrack' });
  groove.send('subscribe', { name: 'queue' });
});

const skipToNextTrack = () => {
  try {
    const { queue, currentTrack } = groove;
    const queueItems = Object.entries(queue).map(([id, item]) => ({ ...item, id }));

    queueItems.sort(compareSortKeyThenId);

    const currentIndex = queueItems.findIndex(item => item.id === currentTrack.currentItemId) || 0;
    const newIndex = Math.max(0, Math.min(currentIndex + 1, queueItems.length - 1));

    if (!queueItems[newIndex]) {
      throw new Error('Error finding next track!');
    }

    groove.send('seek', {
      id: queueItems[newIndex].id,
      pos: 0,
    });

    logger.info('Skipping to the next track...');
  } catch (error) {
    logger.error(`Error while skipping to the next track: ${error.message}`);
  }
};

const registerShortcutFiles = () => {
  try {
    const shortcutFiles = fs.readdirSync(shortcutsDirectory);

    shortcutFiles.forEach(shortcutFile => {
      const shortcutPath = path.join(shortcutsDirectory, shortcutFile);
      const shortcutKey = path.parse(shortcutFile).name.replace(/-/g, '+');

      console.log(`Registering shortcut: ${shortcutKey}`);
      const ret = globalShortcut.register(shortcutKey, () => {
        console.log(`${shortcutKey} is pressed, executing ${shortcutPath}`);
        const scriptExtension = path.extname(shortcutFile).toLowerCase();

        try {
          switch (scriptExtension) {
            case '.sh':
              console.log(`Executing Bash script: ${shortcutPath}`);
              execSync(`bash ${shortcutPath}`, { stdio: 'inherit' });
              break;
            case '.js':
              console.log(`Executing JavaScript script: ${shortcutPath}`);
              require(shortcutPath);
              break;
            case '.py':
              console.log(`Executing Python script: ${shortcutPath}`);
              execSync(`python ${shortcutPath}`, { stdio: 'inherit' });
              break;
            // Add more cases for other script types if needed
            default:
              console.warn(`Unsupported script type: ${shortcutPath}`);
          }
        } catch (error) {
          console.error(`Error executing script: ${error.message}`);
        }
      });

      if (!ret) {
        console.warn(`Registration failed for ${shortcutKey}; another process may have it.`);
      }
    });

    console.log('All shortcuts registered successfully.');
  } catch (error) {
    console.error(`Error registering shortcuts: ${error.message}`);
  }
};

const registerShortcuts = () => {
  logger.info('Setting keyboard shortcut listeners');

  

  const ret = globalShortcut.register('CommandOrControl+Shift+N', skipToNextTrack);
  if (!ret) logger.warn('Registration failed for CommandOrControl+Shift+N; another process may have it.');


  globalShortcut.register('CommandOrControl+Shift+E', () => {
    sendToMainProcess(IPC_CHANNELS.EXAMPLE_CHANNEL, 'Global shortcut activated!');
  });

  // globalShortcut.register('Escape', () => { console.log('keypress: Escape') });
  // globalShortcut.register('Tab', () => { console.log('keypress: Tab') });
  // globalShortcut.register('Plus', () => { console.log('keypress: Plus') });
  // globalShortcut.register('Insert', () => { console.log('keypress: Insert') });

  // These dont work as currently understood, likely upstart order is an issue
  // globalShortcut.register('MediaNextTrack', () => { console.log('keypress: MediaNextTrack') });
  // globalShortcut.register('MediaPreviousTrack', () => { console.log('keypress: MediaPreviousTrack') });
  // globalShortcut.register('MediaStop', () => { console.log('keypress: MediaStop') });
  // globalShortcut.register('MediaPlayPause', () => { console.log('keypress: MediaPlayPause') });
  // globalShortcut.register('VolumeUp', () => { console.log('keypress: VolumeUp') });
  // globalShortcut.register('VolumeDown', () => { console.log('keypress: VolumeDown') });
  // globalShortcut.register('VolumeMute', () => { console.log('keypress: VolumeMute') });

  registerShortcutFiles();
};

const unregisterShortcuts = () => {
  globalShortcut.unregisterAll();
  logger.info('All keyboard shortcuts unregistered.');
};

module.exports = {
  registerShortcuts,
  unregisterShortcuts,
};
