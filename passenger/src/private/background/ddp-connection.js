import DDPClient from '../lib/ddp.js';

const defaults = { host: "127.0.0.1", port: 28282, proto: 'ws' };

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

// Function to perform the sequence of method calls
async function connectDDP() {
    try {
        await ddp.connect();
        console.log('Connected to DDP server');
        startKeepalive();
        await performPassengerChecks('dark-passenger');
    } catch (error) {
        console.error('DDP connection error:', error);
        stopKeepalive();
    }
}

async function performPassengerChecks(passengerName) {
    try {
        // Step 1: Check in the passenger
        const checkInResp = await ddp.call('passenger.check.in', passengerName);
        console.log('Passenger check-in response:', checkInResp);
        const signedId = "exampleSignedId"; // This should be replaced with actual PGP signed ID

        // Step 2: Sign in the passenger
        const signInResp = await ddp.call('passenger.sign.in', signedId, passengerName);
        console.log('Passenger sign-in response:', signInResp);

        // Step 3: Check which entity is on duty
        const dutyResp = await ddp.call('passenger.check.duty');
        console.log('On-duty entity:', dutyResp);
    } catch (error) {
        console.error('An error occurred:', error);
    }
}

connectDDP();

export { ddp };
