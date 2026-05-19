// fetchSettings.js
import { ddp } from './ddp-connection.js';

export function fetchSettings() {
  if (ddp && ddp.isConnected()) {
    ddp.call('getSettings', [], (err, result) => {
      if (err) {
        console.error('Error fetching settings:', err);
      } else {
        console.log('Fetched settings:', result);
      }
    });
  }
}
