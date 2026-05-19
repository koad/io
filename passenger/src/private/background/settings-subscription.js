// subscribeSettings.js
import { ddp } from './ddp-connection.js';

export function subscribeToSettings() {
  if (ddp && ddp.isConnected()) {
    ddp.subscribe('settings', [], {
      onReady: () => console.log('Subscribed to settings updates'),
      // Add handlers for added/changed/removed as needed
    });
  }
}
