// kbpgp-with-internals.js — browserify entry point for kbpgp with ceremony internals
//
// Produces: kbpgp.bundle.js / kbpgp.bundle.min.js
//
// Build command (run from this directory):
//   browserify -i sodium -s kbpgp ./kbpgp-with-internals.js -o kbpgp.bundle.js
//   uglifyjs kbpgp.bundle.js -o kbpgp.bundle.min.js --compress --mangle
//
// What this adds over the plain `browserify -i sodium -s kbpgp` build:
//   - kbpgp.keywrapper  — { Lifespan, Primary, Subkey }     (lib/keywrapper)
//   - kbpgp.userid      — { UserID }                         (lib/openpgp/packet/userid)
//   - kbpgp.ecc.ecdh    — { ECDH }                           (lib/ecc/ecdh — alias for Pair)
//
// These are required by ceremony-browser.js to construct a deterministic Ed25519
// KeyManager from a BIP39-derived seed (VESTA-SPEC-149).
//
// The existing kbpgp bundle already exposes:
//   kbpgp.KeyManager (with .generate_ecc, .import_from_armored_pgp)
//   kbpgp.ecc.EDDSA  — { Pair, Pub, Priv, generate }
//   kbpgp.ecc.ECDH   — already exposed at top level? Re-check after build.
//   kbpgp.nacl        — keybase-nacl (tweetnacl backend in browser)
//   kbpgp.const       — openpgp constants including key_flags
//   kbpgp.rand        — { SRF, ... }
//   kbpgp.clearsign, kbpgp.unbox, kbpgp.keyring, kbpgp.armor

var kbpgp = require('kbpgp');

// ---- Expose ceremony internals ----

kbpgp.keywrapper = require('kbpgp/lib/keywrapper');
kbpgp.userid     = require('kbpgp/lib/openpgp/packet/userid');

// ECDH is already in kbpgp.ecc via main kbpgp exports but exposed as Pair.
// Re-expose as ecdh for clarity; ceremony-browser.js can use either.
if (!kbpgp.ecc) kbpgp.ecc = {};
if (!kbpgp.ecc.ecdh) {
  kbpgp.ecc.ecdh = require('kbpgp/lib/ecc/ecdh');
}

// keybase-nacl — needed for kbnacl.alloc({}).genFromSeed({seed}) in ceremony.
// In browser, sodium is absent; keybase-nacl falls back to tweetnacl automatically.
// This is the same library used internally by kbpgp; -i sodium already handles the ignore.
kbpgp.kbnacl = require('keybase-nacl');

module.exports = kbpgp;
