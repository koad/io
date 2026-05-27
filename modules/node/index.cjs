// index.cjs — CJS entry for @koad-io/node
//
// Builds the koad object synchronously so Meteor's Reify-based require()
// gets a real object at import time (not a promise).
//
// The crypto/IPFS deps (dag-json, multiformats, ed25519) are ESM-only and
// loaded lazily — they're not needed at koad object construction time.
// Meteor's client/deps.js (a mainModule in ESM context) imports them directly.

const { createIdentityShape } = require('./identity.cjs');
const { randomBytes } = require('crypto');

function _setBits(buf, startBit, value, numBits) {
  for (let i = 0; i < numBits; i++) {
    const bitPos = startBit + i;
    const byteIndex = bitPos >>> 3;
    const bitIndex = 7 - (bitPos & 7);
    if ((value >>> (numBits - 1 - i)) & 1) {
      buf[byteIndex] |= (1 << bitIndex);
    } else {
      buf[byteIndex] &= ~(1 << bitIndex);
    }
  }
}

// BIP39 wordlist + entropyToMnemonic are ESM-only; lazy-load once
let _bip39 = null;
function _loadBip39() {
  if (!_bip39) {
    _bip39 = Promise.all([
      import('@scure/bip39'),
      import('@scure/bip39/wordlists/english.js'),
    ]).then(([bip39, wl]) => ({ entropyToMnemonic: bip39.entropyToMnemonic, wordlist: wl.wordlist }));
  }
  return _bip39;
}

const koad = {
  maintenance: true,
  lighthouse: null,
  extension: null,
  instance: null,
  gateway: null,
  session: null,
  internals: 'unset',
  identity: createIdentityShape(),
  storage: {},
  library: {},
  format: {
    timestamp: function(d, s) {
      if (!d) d = new Date();
      if (!s) s = ':';
      const date = new Date(d);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      return `${year}${s}${month}${s}${day}${s}${hours}${s}${minutes}${s}${seconds}`;
    },
  },
  seeders: [],
  emitters: [],
  trackers: [],
  generate: {
    async mnemonic(wordCount = 24, firstWord, secondWord) {
      if (wordCount !== 12 && wordCount !== 24) {
        throw new Error('[koad/generate] mnemonic: wordCount must be 12 or 24');
      }
      const { entropyToMnemonic, wordlist } = await _loadBip39();
      const entropyBytes = wordCount === 12 ? 16 : 32;
      const entropy = randomBytes(entropyBytes);

      if (firstWord !== undefined) {
        const idx = wordlist.indexOf(firstWord);
        if (idx === -1) throw new Error(`[koad/generate] mnemonic: "${firstWord}" is not in the BIP39 wordlist`);
        _setBits(entropy, 0, idx, 11);
      }
      if (secondWord !== undefined) {
        const idx = wordlist.indexOf(secondWord);
        if (idx === -1) throw new Error(`[koad/generate] mnemonic: "${secondWord}" is not in the BIP39 wordlist`);
        _setBits(entropy, 11, idx, 11);
      }

      return entropyToMnemonic(entropy, wordlist);
    },
  },
  deps: {},
};

// Lazy-load ESM deps into koad.deps when requested
let _depsLoaded = false;
const _loadDeps = import('./deps.js').then(function(m) {
  Object.assign(koad.deps, {
    dagJsonEncode: m.dagJsonEncode,
    dagJsonDecode: m.dagJsonDecode,
    CID: m.CID,
    sha256: m.sha256,
    base64: m.base64,
    ed: m.ed,
    pgp: m.pgp,
  });
  _depsLoaded = true;
});

module.exports = { koad, createIdentityShape, depsReady: _loadDeps };
