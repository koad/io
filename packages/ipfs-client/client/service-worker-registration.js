/**
 * koad:io-ipfs-client — client/service-worker-registration.js
 *
 * Service worker registration helper.
 *
 * Registers a service worker that intercepts `/ipfs/<cid>` and `/ipns/<name>`
 * requests and serves them from the local Helia blockstore (OPFS cache) first,
 * falling back to the IPFS network via verified-fetch.
 *
 * The service worker file itself (ipfs-sw.js) must be served from the app's
 * root scope. For Meteor apps this means placing it in the /public/ directory
 * of the host app. This package provides the registration helper and the
 * service worker source as a reference — the host app wires them together.
 *
 * Why not auto-register?
 *   Service workers require scope control. Auto-registration from a package
 *   would claim the root scope without the app's consent. This helper gives
 *   the app explicit control over when and whether to register.
 *
 * Usage (in your app's client startup):
 *
 *   import { registerIPFSServiceWorker } from 'meteor/koad:io-ipfs-client';
 *   // or via koad global:
 *   koad.ipfs.registerServiceWorker();
 *
 * Reference: ipfs/service-worker-gateway v3.1.7 (inbrowser.link, April 2026)
 */

const SW_PATH = '/ipfs-sw.js';
const SW_SCOPE = '/';

let _swRegistration = null;
let _swRegPromise = null;

/**
 * registerIPFSServiceWorker([options]) — register the IPFS service worker.
 *
 * Options:
 *   path  {string}  Path to the service worker file. Default: '/ipfs-sw.js'
 *   scope {string}  Service worker scope. Default: '/'
 *
 * Returns a Promise that resolves to the ServiceWorkerRegistration, or null
 * if service workers are not supported in this context.
 *
 * @param {{ path?: string, scope?: string }} [options]
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
async function registerIPFSServiceWorker(options = {}) {
  if (!('serviceWorker' in navigator)) {
    console.warn('[koad:io-ipfs-client] Service workers not supported. IPFS SW not registered.');
    return null;
  }

  // Deduplicate concurrent registration calls
  if (_swRegPromise) return _swRegPromise;

  const swPath = options.path || SW_PATH;
  const swScope = options.scope || SW_SCOPE;

  _swRegPromise = (async () => {
    try {
      _swRegistration = await navigator.serviceWorker.register(swPath, {
        scope: swScope,
        type: 'module'
      });

      _swRegistration.addEventListener('updatefound', () => {
        const installing = _swRegistration.installing;
        if (installing) {
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed') {
              console.log('[koad:io-ipfs-client] Service worker updated — reload to activate.');
            }
          });
        }
      });

      console.log('[koad:io-ipfs-client] IPFS service worker registered at scope:', swScope);
      return _swRegistration;

    } catch (err) {
      console.error('[koad:io-ipfs-client] Service worker registration failed:', err);
      _swRegPromise = null; // allow retry on next call
      return null;
    }
  })();

  return _swRegPromise;
}

/**
 * swStatus() — returns the current service worker registration state.
 *
 * @returns {{ registered: boolean, state: string|null }}
 */
function swStatus() {
  if (!_swRegistration) {
    return { registered: false, state: null };
  }
  const active = _swRegistration.active;
  return {
    registered: true,
    state: active ? active.state : 'installing'
  };
}

// Attach to koad global
if (typeof koad !== 'undefined') {
  koad.ipfs = koad.ipfs || {};
  koad.ipfs.registerServiceWorker = registerIPFSServiceWorker;
  koad.ipfs.swStatus = swStatus;
}
