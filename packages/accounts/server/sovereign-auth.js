// Sovereign Auth — Ed25519 challenge-response login
// Implements "Sign in with Sovereign Profile" for kingofalldata.com
// Phase 1: keygen in browser, challenge/sign/verify, Meteor user creation.
//          Device key add: VESTA-SPEC-111 §6.5 multi-device authorization.
// Phase 2: OPFS/IndexedDB key storage, sigchain publication, bond linking.
//
// Uses SovereignAuth from koad:io-sovereign-profiles (globalThis.SovereignAuth).
// Pattern follows insiders.js: Accounts._generateStampedLoginToken + _insertLoginToken.

import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import { check, Match } from 'meteor/check';

// SovereignAuth is defined in this same package (server/auth.js, loaded first)
// and attached to globalThis. In-package, no import needed.
const SovereignAuth = globalThis.SovereignAuth;

// ── Device key helpers ────────────────────────────────────────────────────────
// Reuse the noble/ed25519 stack already loaded by SovereignAuth.
// We import the same ensureEd / fromBase64Url / toBase64Url pattern from auth.js
// via globalThis.SovereignAuth (which already called ensureEd at module load).

let _ed;
async function ensureEd() {
  if (!_ed) _ed = await import('@noble/ed25519');
  return _ed;
}

function fromBase64Url(str) {
  return new Uint8Array(Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Canonical JSON serialization for device-key-add entry verification.
 * Per SPEC-111 §3.1: keys sorted lexicographically, no whitespace.
 *
 * We use sorted JSON.stringify (not dag-json) for server-side device-key-add
 * verification because @ipld/dag-json is not in sovereign-profiles' server
 * Npm.depends. This is identical to the client-side canonical pre-image as
 * long as both sides use the same sorted-key JSON approach. Document the
 * canonical form: sorted JSON.stringify with no replacer gaps.
 *
 * Both client and server MUST use this same helper for reverse_sig pre-image
 * and entry signature pre-image.
 *
 * @param {object} obj — plain JSON-serialisable object
 * @returns {Uint8Array} — UTF-8 bytes of sorted canonical JSON
 */
function sortedJsonBytes(obj) {
  const canon = sortedJson(obj);
  return new Uint8Array(Buffer.from(canon, 'utf8'));
}

function sortedJson(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const sorted = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = obj[k];
  }
  // Recursively sort nested objects
  return '{' + Object.keys(sorted).map(k => {
    return JSON.stringify(k) + ':' + sortedJson(sorted[k]);
  }).join(',') + '}';
}

/**
 * Produce the canonical pre-image of a device-key-add entry for verification.
 * Mirrors canonicalPreImage() in profile-builder.js: top-level fields sorted
 * lexicographically, signature field absent.
 *
 * @param {object} entry — full entry object (signature may or may not be present)
 * @returns {Uint8Array} — bytes to verify against
 */
function entryPreImageBytes(entry) {
  const obj = {
    entity:    entry.entity,
    payload:   entry.payload,
    previous:  entry.previous,
    timestamp: entry.timestamp,
    type:      entry.type,
    version:   entry.version,
  };
  return sortedJsonBytes(obj);
}

/**
 * Produce the reverse_sig pre-image: same as entryPreImageBytes but with
 * `reverse_sig` absent from the payload sub-object.
 * Per SPEC-111 §5.4.1: the device key signs the entry with reverse_sig absent.
 *
 * @param {object} entry — full entry object including payload with reverse_sig
 * @returns {Uint8Array}
 */
function reverseSigPreImageBytes(entry) {
  // Clone payload, omit reverse_sig
  const payloadNoSig = {};
  for (const k of Object.keys(entry.payload).sort()) {
    if (k === 'reverse_sig') continue;
    payloadNoSig[k] = entry.payload[k];
  }
  const obj = {
    entity:    entry.entity,
    payload:   payloadNoSig,
    previous:  entry.previous,
    timestamp: entry.timestamp,
    type:      entry.type,
    version:   entry.version,
  };
  return sortedJsonBytes(obj);
}

/**
 * Verify an Ed25519 signature (base64url) over bytes with a pubkey (base64url).
 *
 * @param {Uint8Array} msgBytes
 * @param {string} sigB64
 * @param {string} pubB64
 * @returns {Promise<boolean>}
 */
async function ed25519Verify(msgBytes, sigB64, pubB64) {
  const ed = await ensureEd();
  const sig = fromBase64Url(sigB64);
  const pub = fromBase64Url(pubB64);
  return ed.verifyAsync(sig, msgBytes, pub);
}

// ── Pending device request store ──────────────────────────────────────────────
// In-memory; keyed by pendingId (first 16 chars of device_pubkey base64url).
// Value: { userId, device_pubkey, reverse_sig, requestedAt, expiresAt }
// TTL: 5 minutes per flight plan spec.

const DEVICE_REQUEST_TTL_MS = 5 * 60 * 1000;
const pendingDeviceRequests = new Map();

// Sweep expired pending device requests every 60 seconds
Meteor.setInterval(function () {
  const now = Date.now();
  for (const [id, req] of pendingDeviceRequests.entries()) {
    if (req.expiresAt <= now) pendingDeviceRequests.delete(id);
  }
}, 60 * 1000);

/**
 * Compute a pendingId from a device_pubkey (first 16 chars of base64url).
 * Stable, unambiguous within the 5-minute TTL window.
 */
function pendingId(device_pubkey) {
  return device_pubkey.slice(0, 16);
}

// ── Authorized-key-set helpers ────────────────────────────────────────────────

/**
 * Return all authorized pubkeys for a user (root + non-revoked device keys).
 * Performs on-the-fly schema migration: if deviceKeys is absent, backfills it
 * from the root pubkey.
 *
 * @param {object} user — full Meteor user record
 * @returns {string[]} — array of base64url pubkey strings
 */
function authorizedPubkeys(user) {
  const sov = (user.services && user.services.sovereign) || {};
  const rootPubkey = sov.pubkey;
  const deviceKeys = sov.deviceKeys || [];

  const keys = new Set();
  if (rootPubkey) keys.add(rootPubkey);
  for (const dk of deviceKeys) {
    keys.add(dk.pubkey);
  }
  return Array.from(keys);
}

/**
 * Ensure the user record has the deviceKeys array (on-the-fly migration).
 * If deviceKeys is absent, write it now with the root key as role:'root'.
 *
 * @param {string} userId
 * @param {object} sov — services.sovereign
 */
async function migrateDeviceKeys(userId, sov) {
  if (sov.deviceKeys) return; // already migrated
  const rootKey = {
    pubkey:   sov.pubkey,
    role:     'root',
    addedAt:  sov.createdAt || new Date(),
    addedBy:  sov.pubkey,
    reverseSig: null,
  };
  await Meteor.users.updateAsync(
    { _id: userId },
    { $set: { 'services.sovereign.deviceKeys': [rootKey] } }
  );
}

Meteor.methods({

  // Issue a fresh nonce challenge. No auth required.
  // Returns { nonce, expires } — nonce is a 64-char hex string, expires is Unix ms.
  async 'sovereign.auth.challenge'() {
    this.unblock();
    if (!SovereignAuth) throw new Meteor.Error('internal', 'SovereignAuth not available');
    return SovereignAuth.challenge();
  },

  // Verify a signed challenge and log in (or create) a sovereign user.
  //
  // @param {object} opts
  //   pubkey    {string} — base64url Ed25519 public key (32 bytes)
  //   challenge {string} — hex nonce from sovereign.auth.challenge
  //   signature {string} — base64url Ed25519 signature over "koad-io:auth:v1:<nonce>"
  //   profile   {object} — { name: string } (name used for username on first login)
  //
  // Extended (SPEC-111 §6.5): lookup also checks services.sovereign.deviceKeys[].pubkey.
  // On-the-fly schema migration: if deviceKeys absent, backfills from root pubkey.
  //
  // Returns { loginToken, userId } on success.
  // Throws Meteor.Error on invalid signature or bad input.
  async 'sovereign.auth.login'({ pubkey, challenge, signature, profile }) {
    check(pubkey, String);
    check(challenge, String);
    check(signature, String);
    check(profile, Object);

    this.unblock();

    if (!SovereignAuth) throw new Meteor.Error('internal', 'SovereignAuth not available');

    // Verify challenge signature
    const { valid, error } = await SovereignAuth.verify(challenge, signature, pubkey);
    if (!valid) {
      throw new Meteor.Error('invalid-signature', error || 'Signature verification failed');
    }

    // Find or create user — check root pubkey OR any authorized device key
    let userId;
    const existing = await Meteor.users.findOneAsync(
      {
        $or: [
          { 'services.sovereign.pubkey': pubkey },
          { 'services.sovereign.deviceKeys.pubkey': pubkey },
        ],
      },
      { fields: { _id: 1, services: 1 } }
    );

    if (existing) {
      userId = existing._id;
      // On-the-fly migration: ensure deviceKeys array exists
      const sov = (existing.services && existing.services.sovereign) || {};
      await migrateDeviceKeys(userId, sov);
    } else {
      // New user — derive username from profile.name or pubkey prefix
      const rawName = (profile && typeof profile.name === 'string' && profile.name.trim())
        ? profile.name.trim()
        : null;

      let username = rawName
        ? rawName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
        : '';

      if (username.length < 5) {
        username = (username + pubkey.replace(/[^a-z0-9]/gi, '').toLowerCase()).slice(0, 24);
      }
      username = username.slice(0, 24);

      let finalUsername = username;
      let attempt = 0;
      while (true) {
        const taken = await Meteor.users.findOneAsync(
          { username: finalUsername },
          { fields: { _id: 1 } }
        );
        if (!taken) break;
        attempt++;
        finalUsername = `${username.slice(0, 20)}-${attempt}`;
      }

      const now = new Date();
      userId = await Meteor.users.insertAsync({
        username: finalUsername,
        services: {
          sovereign: {
            pubkey,
            createdAt: now,
            profile: {
              name: (rawName || finalUsername),
            },
            deviceKeys: [
              {
                pubkey,
                role:      'root',
                addedAt:   now,
                addedBy:   pubkey,
                reverseSig: null,
              },
            ],
          },
        },
        createdAt: now,
      });

      console.log(`[sovereign-auth] new user created: ${finalUsername} (${userId.slice(0, 8)}…)`);
    }

    const stampedToken = Accounts._generateStampedLoginToken();
    await Accounts._insertLoginToken(userId, stampedToken);

    return { loginToken: stampedToken.token, userId };
  },

  // ── Device key pairing — Phase 1: Browser B initiates ────────────────────
  //
  // Browser B calls this to register a pending device authorization request.
  // The server verifies the reverse_sig (proof that Browser B holds the privkey)
  // and stores a 5-minute pending request.
  //
  // @param {object} opts
  //   username       {string} — the account username to join (e.g. "koad4o1vi4zmtrmrw8wvkaeb")
  //   device_pubkey  {string} — base64url Ed25519 public key generated by Browser B
  //   reverse_sig    {string} — base64url signature produced by Browser B's privkey over
  //                             the message "koad-io:device-key-request:v1:<username>:<device_pubkey>"
  //
  // Returns { pendingId, expiresAt } on success.
  async 'sovereign.auth.requestDevice'({ username, device_pubkey, reverse_sig }) {
    check(username, String);
    check(device_pubkey, String);
    check(reverse_sig, String);

    this.unblock();

    // Look up the target account
    const user = await Meteor.users.findOneAsync(
      { username },
      { fields: { _id: 1 } }
    );
    if (!user) throw new Meteor.Error('not-found', 'No account with that username');

    // Verify reverse_sig: Browser B signed "koad-io:device-key-request:v1:<username>:<device_pubkey>"
    const msgBytes = new Uint8Array(
      Buffer.from(`koad-io:device-key-request:v1:${username}:${device_pubkey}`, 'utf8')
    );
    let ok;
    try {
      ok = await ed25519Verify(msgBytes, reverse_sig, device_pubkey);
    } catch (e) {
      throw new Meteor.Error('invalid-sig', `reverse_sig verification error: ${e.message}`);
    }
    if (!ok) throw new Meteor.Error('invalid-sig', 'reverse_sig did not verify — bad device key or signature');

    // Check for duplicate device key (already authorized)
    const fullUser = await Meteor.users.findOneAsync(
      { _id: user._id },
      { fields: { services: 1 } }
    );
    const sov = (fullUser && fullUser.services && fullUser.services.sovereign) || {};
    const existingKeys = (sov.deviceKeys || []).map(dk => dk.pubkey);
    if (existingKeys.includes(device_pubkey) || sov.pubkey === device_pubkey) {
      throw new Meteor.Error('duplicate', 'This device key is already authorized on this account');
    }

    const id = pendingId(device_pubkey);
    const now = Date.now();
    const expiresAt = now + DEVICE_REQUEST_TTL_MS;

    pendingDeviceRequests.set(id, {
      userId:       user._id,
      username,
      device_pubkey,
      reverse_sig,
      requestedAt:  now,
      expiresAt,
    });

    console.log(`[sovereign-auth] device request pending: ${id} for user ${user._id.slice(0, 8)}…`);
    return { pendingId: id, expiresAt };
  },

  // ── Device key status polling — Browser B polls this ─────────────────────
  //
  // @param {{ pendingId: string }}
  // Returns { status: 'pending'|'approved'|'expired' }
  async 'sovereign.auth.deviceStatus'({ pendingId: id }) {
    check(id, String);
    this.unblock();

    const req = pendingDeviceRequests.get(id);
    if (!req) return { status: 'approved' }; // not pending = approved (or expired but we can't tell)
    if (req.expiresAt <= Date.now()) {
      pendingDeviceRequests.delete(id);
      return { status: 'expired' };
    }
    return { status: 'pending' };
  },

  // ── Pending device requests — Browser A queries this ─────────────────────
  //
  // Returns list of pending device requests for the logged-in user.
  // Browser A polls this (or subscribes — we use polling for simplicity).
  //
  // Returns [{ pendingId, device_pubkey_prefix, requestedAt, expiresAt }]
  async 'sovereign.auth.pendingDevices'() {
    if (!this.userId) throw new Meteor.Error('not-authorized', 'Must be logged in');
    this.unblock();

    const now = Date.now();
    const result = [];
    for (const [id, req] of pendingDeviceRequests.entries()) {
      if (req.userId !== this.userId) continue;
      if (req.expiresAt <= now) {
        pendingDeviceRequests.delete(id);
        continue;
      }
      result.push({
        pendingId:            id,
        device_pubkey:        req.device_pubkey,
        device_pubkey_prefix: req.device_pubkey.slice(0, 12) + '…' + req.device_pubkey.slice(-4),
        // reverse_sig is returned to the authenticated account owner so they can
        // build and sign the koad.device-key-add entry (SPEC-111 §5.4).
        // This is safe: the value was submitted by Browser B and is transient (5-min TTL).
        reverse_sig:          req.reverse_sig,
        requestedAt:          req.requestedAt,
        expiresAt:            req.expiresAt,
      });
    }
    return result;
  },

  // ── Approve a device key — Browser A calls this ───────────────────────────
  //
  // Browser A constructs a SPEC-111 §5.4 koad.device-key-add entry, signs it
  // with its own privkey, and sends it here for server-side verification.
  //
  // The entry must conform to SPEC-111 §2 schema (type: 'koad.device-key-add').
  // The server verifies:
  //   1. Entry is well-formed (version:1, correct type, required payload fields)
  //   2. authorized_by is in the caller's authorized-key set (root or existing device key)
  //   3. Entry signature verifies against authorized_by
  //   4. reverse_sig verifies against device_pubkey
  //   5. The pending device request exists and matches
  //
  // On success: adds device_pubkey to services.sovereign.deviceKeys, removes pending request.
  //
  // @param {{ deviceKeyAddEntry: object }}
  // Returns { approved: true }
  async 'sovereign.auth.approveDevice'({ deviceKeyAddEntry: entry }) {
    check(entry, Object);

    if (!this.userId) throw new Meteor.Error('not-authorized', 'Must be logged in');
    this.unblock();

    // ── 1. Well-formedness check ──────────────────────────────────────────
    if (entry.version !== 1)
      throw new Meteor.Error('invalid', 'entry.version must be 1');
    if (entry.type !== 'koad.device-key-add')
      throw new Meteor.Error('invalid', 'entry.type must be koad.device-key-add');
    if (!entry.payload || typeof entry.payload !== 'object')
      throw new Meteor.Error('invalid', 'entry.payload missing');

    const {
      device_pubkey,
      authorized_by,
      reverse_sig,
      device_id,
      key_type,
    } = entry.payload;

    for (const [field, val] of [
      ['device_pubkey', device_pubkey],
      ['authorized_by', authorized_by],
      ['reverse_sig',   reverse_sig],
      ['device_id',     device_id],
      ['key_type',      key_type],
    ]) {
      if (typeof val !== 'string' || !val)
        throw new Meteor.Error('invalid', `entry.payload.${field} missing or not a string`);
    }
    if (key_type !== 'ed25519')
      throw new Meteor.Error('invalid', 'entry.payload.key_type must be ed25519');
    if (typeof entry.signature !== 'string' || !entry.signature)
      throw new Meteor.Error('invalid', 'entry.signature missing');

    // ── 2. Check authorized_by is in caller's authorized-key set ─────────
    const fullUser = await Meteor.users.findOneAsync(
      { _id: this.userId },
      { fields: { services: 1 } }
    );
    if (!fullUser) throw new Meteor.Error('not-found', 'User not found');

    const sov = (fullUser.services && fullUser.services.sovereign) || {};
    const callerKeys = authorizedPubkeys(fullUser);

    if (!callerKeys.includes(authorized_by)) {
      throw new Meteor.Error('invalid', 'authorized_by is not in your authorized-key set');
    }

    // ── 3. Verify entry signature against authorized_by ───────────────────
    const entryPreImage = entryPreImageBytes(entry);
    let sigOk;
    try {
      sigOk = await ed25519Verify(entryPreImage, entry.signature, authorized_by);
    } catch (e) {
      throw new Meteor.Error('invalid', `entry signature error: ${e.message}`);
    }
    if (!sigOk) throw new Meteor.Error('invalid', 'entry signature verification failed');

    // ── 4. Verify reverse_sig against device_pubkey ───────────────────────
    // Per SPEC-111 §5.4.1: reverse_sig was computed over the entry pre-image
    // with reverse_sig absent from the payload.
    const rsPreImage = reverseSigPreImageBytes(entry);
    let rsOk;
    try {
      rsOk = await ed25519Verify(rsPreImage, reverse_sig, device_pubkey);
    } catch (e) {
      throw new Meteor.Error('invalid', `reverse_sig error: ${e.message}`);
    }
    if (!rsOk) throw new Meteor.Error('invalid', 'reverse_sig verification failed');

    // ── 5. Pending request must exist and match ───────────────────────────
    const id = pendingId(device_pubkey);
    const req = pendingDeviceRequests.get(id);
    if (!req) throw new Meteor.Error('not-found', 'No pending device request for this pubkey (expired or not found)');
    if (req.userId !== this.userId) throw new Meteor.Error('not-authorized', 'Pending request belongs to a different account');
    if (req.expiresAt <= Date.now()) {
      pendingDeviceRequests.delete(id);
      throw new Meteor.Error('expired', 'Device request expired — have Browser B start over');
    }
    if (req.device_pubkey !== device_pubkey)
      throw new Meteor.Error('invalid', 'device_pubkey mismatch with pending request');
    if (req.reverse_sig !== reverse_sig)
      throw new Meteor.Error('invalid', 'reverse_sig mismatch with pending request');

    // ── On success: write device key, remove pending request ─────────────
    // Ensure deviceKeys array exists first (migration)
    await migrateDeviceKeys(this.userId, sov);

    const newDeviceKey = {
      pubkey:    device_pubkey,
      role:      'device',
      addedAt:   new Date(),
      addedBy:   authorized_by,
      reverseSig: reverse_sig,
      deviceId:  device_id,
    };

    await Meteor.users.updateAsync(
      { _id: this.userId },
      { $push: { 'services.sovereign.deviceKeys': newDeviceKey } }
    );

    pendingDeviceRequests.delete(id);

    console.log(`[sovereign-auth] device key approved: ${device_pubkey.slice(0, 12)}… for user ${this.userId.slice(0, 8)}…`);
    return { approved: true };
  },

  // ── Deny / cancel a pending device request — Browser A calls this ────────
  //
  // @param {{ pendingId: string }}
  // Returns { denied: true }
  async 'sovereign.auth.denyDevice'({ pendingId: id }) {
    check(id, String);
    if (!this.userId) throw new Meteor.Error('not-authorized', 'Must be logged in');
    this.unblock();

    const req = pendingDeviceRequests.get(id);
    if (!req) return { denied: true }; // already gone
    if (req.userId !== this.userId)
      throw new Meteor.Error('not-authorized', 'This request belongs to a different account');

    pendingDeviceRequests.delete(id);
    return { denied: true };
  },

  // ── Revoke an authorized device key — Browser A calls this ───────────────
  //
  // Removes a device key from services.sovereign.deviceKeys.
  // The root key (role:'root') cannot be removed via this method.
  //
  // @param {{ device_pubkey: string }}
  // Returns { revoked: true }
  async 'sovereign.auth.revokeDevice'({ device_pubkey }) {
    check(device_pubkey, String);
    if (!this.userId) throw new Meteor.Error('not-authorized', 'Must be logged in');
    this.unblock();

    const fullUser = await Meteor.users.findOneAsync(
      { _id: this.userId },
      { fields: { services: 1 } }
    );
    if (!fullUser) throw new Meteor.Error('not-found', 'User not found');

    const sov = (fullUser.services && fullUser.services.sovereign) || {};
    const deviceKeys = sov.deviceKeys || [];
    const target = deviceKeys.find(dk => dk.pubkey === device_pubkey);
    if (!target) throw new Meteor.Error('not-found', 'Device key not found');
    if (target.role === 'root') throw new Meteor.Error('invalid', 'Cannot remove the root key via revokeDevice');

    await Meteor.users.updateAsync(
      { _id: this.userId },
      { $pull: { 'services.sovereign.deviceKeys': { pubkey: device_pubkey } } }
    );

    console.log(`[sovereign-auth] device key revoked: ${device_pubkey.slice(0, 12)}… by user ${this.userId.slice(0, 8)}…`);
    return { revoked: true };
  },

  // ── Return the authorized devices list ────────────────────────────────────
  //
  // Returns [{ pubkey_prefix, role, addedAt, deviceId }]
  async 'sovereign.auth.authorizedDevices'() {
    if (!this.userId) throw new Meteor.Error('not-authorized', 'Must be logged in');
    this.unblock();

    const user = await Meteor.users.findOneAsync(
      { _id: this.userId },
      { fields: { services: 1 } }
    );
    if (!user) throw new Meteor.Error('not-found', 'User not found');

    const sov = (user.services && user.services.sovereign) || {};
    const deviceKeys = sov.deviceKeys || [];

    return deviceKeys.map(dk => ({
      pubkey:        dk.pubkey,
      pubkey_prefix: dk.pubkey.slice(0, 12) + '…' + dk.pubkey.slice(-4),
      role:          dk.role,
      addedAt:       dk.addedAt,
      deviceId:      dk.deviceId || null,
    }));
  },

  // ── Sovereign status for the logged-in user ───────────────────────────────
  //
  // Returns a lightweight status object so the client can show "Link sovereign key"
  // or "Sovereign key linked" without needing access to services.* fields.
  //
  // Returns { hasSovereign: boolean, pubkey?: string, deviceKeys: [{ pubkey, role, addedAt }] }
  async 'sovereign.auth.mySovereignStatus'() {
    if (!this.userId) return { hasSovereign: false, pubkey: null, deviceKeys: [] };
    this.unblock();

    const user = await Meteor.users.findOneAsync(
      { _id: this.userId },
      { fields: { services: 1 } }
    );
    if (!user) return { hasSovereign: false, pubkey: null, deviceKeys: [] };

    const sov = (user.services && user.services.sovereign) || {};
    if (!sov.pubkey) return { hasSovereign: false, pubkey: null, deviceKeys: [] };

    const deviceKeys = (sov.deviceKeys || []).map(dk => ({
      pubkey:  dk.pubkey,
      role:    dk.role,
      addedAt: dk.addedAt,
    }));

    return { hasSovereign: true, pubkey: sov.pubkey, deviceKeys };
  },

  // ── Link a sovereign key to the currently-logged-in user ─────────────────
  //
  // Attaches a fresh Ed25519 keypair as an additional auth channel on the
  // currently-authenticated Meteor user (GitHub OAuth or other).
  //
  // @param {object} opts
  //   pubkey    {string} — base64url Ed25519 public key the client just generated
  //   challenge {string} — hex nonce from sovereign.auth.challenge()
  //   signature {string} — base64url signature over
  //                        "koad-io:link-key:v1:<username>:<pubkey>" by the new privkey
  //
  // Returns { linked: true, role: 'root' | 'device' }
  async 'sovereign.auth.linkKey'({ pubkey, challenge, signature }) {
    check(pubkey, String);
    check(challenge, String);
    check(signature, String);

    if (!this.userId) throw new Meteor.Error('not-authorized', 'Must be logged in to link a sovereign key');
    this.unblock();

    // Load the current user to get their username
    const user = await Meteor.users.findOneAsync(
      { _id: this.userId },
      { fields: { username: 1, services: 1 } }
    );
    if (!user) throw new Meteor.Error('not-found', 'User not found');

    const username = user.username || '';

    // The link-key message uses a distinct domain separator from the auth flow
    // ("koad-io:link-key:v1:..." vs "koad-io:auth:v1:..."). We verify the signature
    // directly with ed25519Verify. The nonce is accepted as proof the client
    // called challenge() recently (64-char hex, 5-min TTL). Single-use replay
    // is prevented by the pubkey conflict check below — a replayed linkKey for
    // the same pubkey on the same user fails as 'duplicate'; on a different user
    // it fails because the message is bound to the username.
    if (!SovereignAuth) throw new Meteor.Error('internal', 'SovereignAuth not available');
    if (!challenge || challenge.length < 32) {
      throw new Meteor.Error('invalid', 'challenge nonce is missing or too short');
    }

    // Build the link-key pre-image: "koad-io:link-key:v1:<username>:<pubkey>"
    const linkMsg = `koad-io:link-key:v1:${username}:${pubkey}`;
    const msgBytes = new Uint8Array(Buffer.from(linkMsg, 'utf8'));

    let sigOk;
    try {
      sigOk = await ed25519Verify(msgBytes, signature, pubkey);
    } catch (e) {
      throw new Meteor.Error('invalid-signature', `Signature verification error: ${e.message}`);
    }
    if (!sigOk) {
      throw new Meteor.Error('invalid-signature', 'Signature did not verify — key mismatch');
    }

    // Check the pubkey is not already claimed by ANOTHER user
    const conflict = await Meteor.users.findOneAsync(
      {
        _id: { $ne: this.userId },
        $or: [
          { 'services.sovereign.pubkey': pubkey },
          { 'services.sovereign.deviceKeys.pubkey': pubkey },
        ],
      },
      { fields: { _id: 1 } }
    );
    if (conflict) {
      return { error: 'pubkey-conflict', linked: false };
    }

    const sov = (user.services && user.services.sovereign) || {};
    const now = new Date();

    if (!sov.pubkey) {
      // No sovereign key yet — this key becomes the ROOT
      await Meteor.users.updateAsync(
        { _id: this.userId },
        {
          $set: {
            'services.sovereign': {
              pubkey:    pubkey,
              createdAt: now,
              profile:   {},
              deviceKeys: [
                {
                  pubkey,
                  role:      'root',
                  addedAt:   now,
                  addedBy:   pubkey,
                  reverseSig: null,
                },
              ],
            },
          },
        }
      );
      console.log(`[sovereign-auth] linkKey: root key linked for user ${this.userId.slice(0, 8)}…`);
      return { linked: true, role: 'root' };
    } else {
      // Already has sovereign key — check if this pubkey is already on this user
      const existingKeys = [sov.pubkey, ...(sov.deviceKeys || []).map(dk => dk.pubkey)];
      if (existingKeys.includes(pubkey)) {
        throw new Meteor.Error('duplicate', 'This public key is already linked to your account');
      }

      // Add as a device key (self-approved — user is already authenticated)
      await migrateDeviceKeys(this.userId, sov);
      const newDeviceKey = {
        pubkey,
        role:    'device',
        addedAt: now,
        addedBy: sov.pubkey,
        reverseSig: null,
        deviceId:   pubkey.slice(0, 8),
      };
      await Meteor.users.updateAsync(
        { _id: this.userId },
        { $push: { 'services.sovereign.deviceKeys': newDeviceKey } }
      );
      console.log(`[sovereign-auth] linkKey: device key linked for user ${this.userId.slice(0, 8)}…`);
      return { linked: true, role: 'device' };
    }
  },

  // ── Sessions (unchanged) ──────────────────────────────────────────────────

  async 'sovereign.auth.sessions'() {
    if (!this.userId) throw new Meteor.Error('not-authorized', 'Must be logged in');
    this.unblock();

    const user = await Meteor.users.findOneAsync(
      { _id: this.userId },
      { fields: { 'services.resume.loginTokens': 1, username: 1 } }
    );

    if (!user) throw new Meteor.Error('not-found', 'User not found');

    const tokens = (user.services && user.services.resume && user.services.resume.loginTokens) || [];
    return tokens.map(t => ({
      fingerprint: t.hashedToken.slice(0, 8) + '…' + t.hashedToken.slice(-4),
      prefix:      t.hashedToken.slice(0, 8),
      suffix:      t.hashedToken.slice(-4),
      when:        t.when,
    }));
  },

  async 'sovereign.auth.revoke'({ prefix, suffix }) {
    check(prefix, String);
    check(suffix, String);

    if (!this.userId) throw new Meteor.Error('not-authorized', 'Must be logged in');
    if (prefix.length !== 8) throw new Meteor.Error('invalid', 'prefix must be 8 chars');
    if (suffix.length !== 4) throw new Meteor.Error('invalid', 'suffix must be 4 chars');

    this.unblock();

    const user = await Meteor.users.findOneAsync(
      { _id: this.userId },
      { fields: { 'services.resume.loginTokens': 1 } }
    );

    if (!user) throw new Meteor.Error('not-found', 'User not found');

    const tokens = (user.services && user.services.resume && user.services.resume.loginTokens) || [];
    const match = tokens.find(t => t.hashedToken.startsWith(prefix) && t.hashedToken.endsWith(suffix));

    if (!match) throw new Meteor.Error('not-found', 'Token not found — already expired?');

    await Meteor.users.updateAsync(
      { _id: this.userId },
      { $pull: { 'services.resume.loginTokens': { hashedToken: match.hashedToken } } }
    );

    let self = false;
    try {
      const currentToken = Accounts._getLoginToken(this.connection.id);
      if (currentToken) {
        const hashed = Accounts._hashLoginToken(currentToken);
        self = (hashed === match.hashedToken);
      }
    } catch (e) {
      // fall back: client compares fingerprint
    }

    return { revoked: true, self, prefix, suffix };
  },

});
