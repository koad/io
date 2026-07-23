// sovereign-resolve.js — sovereign.resolve Meteor method (VESTA-SPEC-185 v2.0 §4.4)
//
// Pure sovereign identity resolution — NO Meteor.users dependency.
//
// `sovereign.resolve` reads the current session's fingerprint, looks up the
// principal in FingerprintEntityIndex (koad.indexes.fingerprints), resolves
// the CID, and returns bonds. It NEVER creates or references Meteor.users.
//
// This is the primary identity resolution method for sovereign sessions
// authenticated via auth.challenge + auth.verify.
//
// VESTA-SPEC-185 v2.0 §4.4:
//   "This method MUST NOT create or reference Meteor.users. It is the pure
//    sovereign identity resolution path."

import { scanBondsForPrincipal } from './authorization-bridge.js';

Meteor.methods({
  /**
   * sovereign.resolve — Resolve current session's sovereign principal.
   *
   * Returns identity information for the current session's fingerprint
   * without touching Meteor.users. Pure filesystem-native identity.
   *
   * Auth: Observe-mode OK — requires fingerprint on session, but does not
   * require sign-mode proof. Read-only identity resolution.
   *
   * @returns {object}
   *   { fingerprint, handle, cid, kind, canonicalFingerprint, bonds, deviceHost }
   *   Returns minimal identity for unrecognized fingerprints (handle: null, kind: 'visitor').
   * @throws {Meteor.Error} if session has no fingerprint set
   */
  'sovereign.resolve': async function () {
    // Read session from database to get fingerprint
    // (fingerprint lives on ApplicationSessions document, not on this.connection)
    const sessionId = this.connection && this.connection.id;
    if (!sessionId) {
      throw new Meteor.Error('no-session', 'No DDP session found for this connection');
    }

    const session = await ApplicationSessions.findOneAsync({ _id: sessionId });
    const fp = session && session.fingerprint;
    if (!fp) {
      throw new Meteor.Error('unauthorized', 'Not authenticated — no fingerprint on session');
    }

    // Resolve principal via FingerprintEntityIndex (prefer koad.indexes)
    const index = koad.indexes.fingerprints || globalThis.FingerprintEntityIndex;
    const entry = index && typeof index.lookup === 'function'
      ? index.lookup(fp)
      : null;

    if (!entry) {
      // Unknown fingerprint — return minimal visitor identity
      // VESTA-SPEC-185 v2.0 §10.1: This is correct behavior during startup
      // before the index has finished its initial refresh.
      return {
        fingerprint: fp,
        handle: null,
        cid: null,
        kind: 'visitor',
        canonicalFingerprint: null,
        bonds: [],
        deviceHost: null,
      };
    }

    // Resolve CID from handle (koad.generate.cid is a deterministic hash)
    const handle = entry.handle || null;
    const cid = handle ? koad.generate.cid(handle) : null;

    // Resolve trust bonds for this principal
    // Prefer koad.indexes.bonds if populated, otherwise scan filesystem
    let bonds = [];
    if (koad.indexes.bonds && typeof koad.indexes.bonds.bondsForPrincipal === 'function') {
      bonds = koad.indexes.bonds.bondsForPrincipal(fp);
      if (bonds.length === 0 && handle) {
        bonds = koad.indexes.bonds.bondsForPrincipal(handle);
      }
    } else {
      // Filesystem fallback using authorization-bridge scanner
      bonds = await scanBondsForPrincipal(entry.basedir, handle);
    }

    return {
      fingerprint: fp,
      handle,
      cid,
      kind: entry.kind || 'visitor',          // 'entity' | 'sovereign' | 'device' | 'visitor'
      canonicalFingerprint: entry.canonicalFingerprint || null,
      bonds: bonds.map(b => ({
        type: b.bondType,
        source: b.sourceHandle,
        target: b.targetHandle,
        validAt: b.validAt,
      })),
      deviceHost: entry.deviceHost || null,
    };
  },
});

log.success('loaded koad:io-accounts/sovereign-resolve (VESTA-SPEC-185 v2.0 §4.4)');
