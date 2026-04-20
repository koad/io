// Node test shim — re-exports kek-derive.js for require() in tests
'use strict';

if (typeof globalThis.btoa === 'undefined') {
  globalThis.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
  globalThis.atob = (str) => Buffer.from(str, 'base64').toString('binary');
}

module.exports = require('../client/crypto/kek-derive.js');
