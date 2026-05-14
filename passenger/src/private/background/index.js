
import { ddp } from './ddp-connection.js';
import './panel.js';
import './settings-daemon.js';
import './settings-subscription.js';
import './external-messages.js';

globalThis.koad = { asof: new Date(), daemon: ddp}

// This function is called when the button is clicked
function copyTabs() {
  // Query all tabs in the current window
  chrome.tabs.query({currentWindow: true}, function(tabs) {
    // Map tabs to a JSON array
    let tabsInfo = tabs.map(tab => {
      return {tab: tab.id, url: tab.url, title: tab.title};
    });

    // Copy the JSON array to the clipboard
    console.log(`list has ${tabsInfo.length} items in it.`);
    console.log({tabsInfo})
    copyToClipboard(JSON.stringify(tabsInfo));
  });
}

// To be injected to the active tab
function contentCopy(text) {
  navigator.clipboard.writeText(text);
}

async function copyToClipboard(content, tab) {
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: contentCopy,
    args: [content],
  });
}

function uuidv4() {
  return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
    (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}

function sendRequestToDaemon(data) {
  // Example: Send a request to the daemon's HTTP endpoint
  fetch('http://localhost:28282/passenger/post', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  })
  .then(response => response.json())
  .then(data => console.log('Daemon response:', data))
  .catch((error) => {
    console.error('Error communicating with daemon:', error);
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getTabs") {
    chrome.tabs.query({currentWindow: true}, (tabs) => {
      let tabsInfo = tabs.map(tab => {
        return {tab: tab.id, url: tab.url, title: tab.title};
      });
      sendResponse(tabsInfo);
    });
    return true; // Indicates that the response is asynchronous
  }

  if (request.action === "getCurrentTab") {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0]) {
        sendResponse({url: tabs[0].url, title: tabs[0].title});
      }
    });
    return true; // Indicates that the response is asynchronous
  }

  if (request.action === "discardTabs") {
    chrome.tabs.query({currentWindow: true}, async (tabs) => {
      let count = 0;
      for (const tab of tabs) {
        try {
          await chrome.tabs.discard(tab.id);
          count++;
        } catch (e) {
          console.log('Could not discard tab:', tab.id, e.message);
        }
      }
      sendResponse({count: count});
    });
    return true;
  }

  if (request.action === "showOptions") {
    console.log('showing page options');
    chrome.runtime.openOptionsPage();
  } else if (request.action === "sendToDaemon") {
    console.log("Button clicked in content script");

    // Implement logic to handle the click here.
    // For example, communicate with the koad:io daemon if necessary.
    // This might involve sending a message to the daemon via WebSocket, HTTP request, or any other protocol your daemon supports.

    // Placeholder for sending a request to the daemon
    if(request.videoId) sendRequestToDaemon({youtube: request.videoId});

    // Optionally, send a response back to the content script
    sendResponse({status: "received"});
  }
});

chrome.contextMenus.onClicked.addListener((item, tab) => {
  console.log('context menu item clicked')
  console.log({item, tab});
});



console.log('koad:io dark passenger - background worker now running')
