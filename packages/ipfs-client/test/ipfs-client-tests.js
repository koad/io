/**
 * koad:io-ipfs-client — test/ipfs-client-tests.js
 *
 * Unit tests for IPFSClient API surface.
 *
 * These tests verify the shape and contract of the client API without
 * requiring a live IPFS network connection. Tinytest runs in the browser
 * context, which matches how IPFSClient is used.
 *
 * Note: Full integration tests (actual CID resolution from network) require
 * a browser with OPFS support and network access. Those are manual / CI only.
 */

Tinytest.add('IPFSClient - is defined', function(test) {
  test.isNotNull(IPFSClient, 'IPFSClient should be exported');
  test.equal(typeof IPFSClient, 'object');
});

Tinytest.add('IPFSClient - has expected API methods', function(test) {
  test.equal(typeof IPFSClient.ready,   'function', 'ready() should be a function');
  test.equal(typeof IPFSClient.resolve, 'function', 'resolve() should be a function');
  test.equal(typeof IPFSClient.pin,     'function', 'pin() should be a function');
  test.equal(typeof IPFSClient.unpin,   'function', 'unpin() should be a function');
  test.equal(typeof IPFSClient.has,     'function', 'has() should be a function');
  test.equal(typeof IPFSClient.status,  'function', 'status() should be a function');
});

Tinytest.add('IPFSClient - status() returns correct shape before init', function(test) {
  const s = IPFSClient.status();
  test.equal(typeof s, 'object', 'status() should return an object');
  test.isTrue('initialized' in s, 'status should have initialized field');
  test.isTrue('backend' in s, 'status should have backend field');
  test.isTrue('error' in s, 'status should have error field');
  test.equal(s.initialized, false, 'initialized should be false before ready() is called');
  test.isNull(s.error, 'error should be null before any init attempt');
});

Tinytest.add('IPFSClient - status() initialized is boolean', function(test) {
  const s = IPFSClient.status();
  test.equal(typeof s.initialized, 'boolean');
});

Tinytest.add('IPFSClient - ready() returns a Promise', function(test) {
  // Don't await — just verify the return type
  const result = IPFSClient.ready();
  test.isNotNull(result);
  // A Promise has a .then method
  test.equal(typeof result.then, 'function', 'ready() should return a Promise');
});

Tinytest.add('IPFSClient - koad global integration', function(test) {
  if (typeof koad === 'undefined') {
    test.ok(); // koad not yet initialized in this test context — skip
    return;
  }
  test.isNotNull(koad.ipfs, 'koad.ipfs should be set');
  test.equal(typeof koad.ipfs.client, 'object', 'koad.ipfs.client should be the IPFSClient');
  test.equal(typeof koad.ipfs.registerServiceWorker, 'function', 'koad.ipfs.registerServiceWorker should be a function');
  test.equal(typeof koad.ipfs.swStatus, 'function', 'koad.ipfs.swStatus should be a function');
});

Tinytest.add('IPFSClient - swStatus() returns correct shape', function(test) {
  if (typeof koad === 'undefined' || !koad.ipfs) {
    test.ok(); // skip if koad not initialized
    return;
  }
  const s = koad.ipfs.swStatus();
  test.equal(typeof s, 'object');
  test.isTrue('registered' in s);
  test.isTrue('state' in s);
  test.equal(s.registered, false, 'SW should not be registered without explicit registration');
});
