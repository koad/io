import DDPClient from '../lib/ddp.js';

// Default to the kingdom's ZeroTier lighthouse address (10.10.10.10).
// Operator can override via chrome.storage.local.set({ lighthouse: { host, port, proto } }).
// Per SPEC-196 §3, the SW probes Tier 1 (ZeroTier daemon) before any fallback.
const defaults = { host: "10.10.10.10", port: 28282, proto: 'ws' };

async function getLighthouse() {
    const stored = await chrome.storage.local.get('lighthouse');
    return Object.assign({}, defaults, stored.lighthouse);
}

const lighthouse = await getLighthouse();
let ddp = new DDPClient(`${lighthouse.proto}://${lighthouse.host}:${lighthouse.port}/websocket`);

// --- Change 1: DDP keepalive ping ---
// Sends a DDP-level ping every 20s to prevent Chrome MV3 service worker
// from killing the WebSocket after 30 idle seconds (Chrome 116+ behavior).
let _keepaliveInterval = null;

function startKeepalive() {
    stopKeepalive();
    _keepaliveInterval = setInterval(() => {
        if (ddp.sock && ddp.sock.readyState === WebSocket.OPEN) {
            ddp.sock.send('{"msg":"ping"}');
        } else {
            stopKeepalive();
        }
    }, 20 * 1000);
}

function stopKeepalive() {
    if (_keepaliveInterval !== null) {
        clearInterval(_keepaliveInterval);
        _keepaliveInterval = null;
    }
}

// --- Change 2: Reconnect-on-wake alarm handler ---
// chrome.alarms fires even after service worker suspension, waking it back up.
// On each tick we check the socket state and reconnect if the connection dropped.
chrome.alarms.create('ddp-keepalive', { periodInMinutes: 0.4 }); // ~24 seconds

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== 'ddp-keepalive') return;
    if (!ddp.sock || ddp.sock.readyState !== WebSocket.OPEN) {
        console.log('ddp-keepalive: connection lost, reconnecting');
        stopKeepalive();
        const lh = await getLighthouse();
        ddp = new DDPClient(`${lh.proto}://${lh.host}:${lh.port}/websocket`);
        await connectDDP();
    }
});

async function connectDDP() {
    try {
        await ddp.connect();
        console.log('Connected to DDP server');
        startKeepalive();
        // SPEC-196 §4 — auth handshake (MCP session token exchange) is wired
        // here once Vulcan implements the extension-context token lifecycle.
        // The prior `passenger.check.in / sign.in / check.duty` flow used a
        // placeholder "exampleSignedId" and is removed pending the real flow.
    } catch (error) {
        console.error('DDP connection error:', error);
        stopKeepalive();
    }
}

connectDDP();

export { ddp };
