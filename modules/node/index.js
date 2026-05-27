// index.js — Core koad object (ESM)
//
// Creates and exports the koad object. This is the canonical source for the
// koad global — the Meteor package koad:io-core will import from here in
// phase 2 instead of constructing it inline in both/initial.js.
//
// In Meteor apps, `koad` is a global. Outside Meteor (CLI tools, daemon,
// tests), consumers import it:
//
//   import { koad } from '@koad-io/node';
//   // or
//   const { koad } = require('@koad-io/node');  // via index.cjs
//
// The koad object shape mirrors both/initial.js exactly so phase 2 wiring
// is a drop-in replacement.

import { dagJsonEncode, dagJsonDecode, CID, sha256, base64, ed, pgp } from './deps.js';
import { createIdentityShape } from './identity.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { randomBytes } from 'crypto';

// ── Bit manipulation for mnemonic word pinning ───────────────────────────────

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

// ── Core koad object ─────────────────────────────────────────────────────────

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
  // ── Generators ───────────────────────────────────────────────────────────
  generate: {
    /**
     * Generate a valid BIP39 mnemonic.
     *
     * @param {number} [wordCount=24]    12 or 24
     * @param {string} [firstWord]       Pin the first word (must be in BIP39 english wordlist)
     * @param {string} [secondWord]      Pin the second word (must be in BIP39 english wordlist)
     * @returns {string} Space-separated mnemonic
     */
    mnemonic(wordCount = 24, firstWord, secondWord) {
      if (wordCount !== 12 && wordCount !== 24) {
        throw new Error('[koad/generate] mnemonic: wordCount must be 12 or 24');
      }
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
  // ── Shared crypto/IPFS deps ──────────────────────────────────────────────
  // Mirrors the koad.deps shape from packages/core/client/deps.js.
  // Consumers can use koad.deps.* or import named symbols from ./deps.js.
  deps: {
    dagJsonEncode,
    dagJsonDecode,
    CID,
    sha256,
    base64,
    ed,
    pgp,
  },
};

export { koad };
export { dagJsonEncode, dagJsonDecode, CID, sha256, base64, ed, pgp } from './deps.js';
export { clearsign, verify } from './pgp.js';
export { createIdentityShape, createIdentity } from './identity.js';
