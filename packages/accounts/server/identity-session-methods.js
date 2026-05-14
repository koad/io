// identity-session-methods.js — SPEC-185 §8.7 third-party DDP session tag
//
// Implements:
//   identity.authorizeSession(targetSessionId)  — Device A tags Device B's session
//   identity.revokeSession(targetSessionId)      — Device A revokes Device B's observe tag
//
// Model (VESTA-SPEC-185 §8.7):
//   - Caller must have fingerprint set on their own session (authenticated)
//   - Caller must have fingerprintSource === 'self' to revoke (can't revoke from observe-mode)
//   - Target session must be live AND fingerprint === null for authorize
//   - One-shot semantics; idempotent if called twice with same already-authorized args
//
// fingerprintSource (per flight plan §Implementation 2 / Aegis refinement):
//   'self'      — fingerprint was set by the session's own challenge-response (auth.verify)
//   'delegated' — fingerprint was set by another session's identity.authorizeSession
//
// DDP session map: ApplicationSessions Mongo collection, keyed by connection.id.
// We read it to locate the calling session's fingerprint and to find the target.

Meteor.methods({

  /**
   * identity.authorizeSession
   *
   * Tags a pending (fingerprint=null) DDP session with the calling connection's fingerprint.
   * Device A (sign-mode, already authenticated) authorizes Device B (new device, /me cold state).
   *
   * @param {string} targetSessionId — the target DDP session ID (from Device B's QR code)
   * @returns {{ ok: true }}
   * @throws Meteor.Error on any validation failure
   */
  'identity.authorizeSession': async function ({ targetSessionId } = {}) {
    check(targetSessionId, String);
    this.unblock();

    const callerSessionId = this.connection && this.connection.id;
    if (!callerSessionId) {
      throw new Meteor.Error('no-session', 'No DDP session for this connection');
    }

    // Load caller's session to confirm they have a fingerprint
    const callerSession = await ApplicationSessions.findOneAsync({ _id: callerSessionId });
    if (!callerSession || !callerSession.fingerprint) {
      throw new Meteor.Error('unauthorized', 'Caller must be authenticated (fingerprint required)');
    }
    const callerFingerprint = callerSession.fingerprint;

    // Prevent self-authorization (no-op but also semantically wrong)
    if (targetSessionId === callerSessionId) {
      throw new Meteor.Error('invalid', 'Cannot authorize your own session');
    }

    // Load target session
    const targetSession = await ApplicationSessions.findOneAsync({ _id: targetSessionId });
    if (!targetSession) {
      throw new Meteor.Error('session-not-found', 'Target session not found or has expired');
    }

    // Idempotent: if target is already tagged with the same fingerprint, return ok
    if (targetSession.fingerprint === callerFingerprint) {
      log.debug(`[identity.authorizeSession] idempotent — ${targetSessionId.slice(0, 8)} already tagged`);
      return { ok: true };
    }

    // Target must not already be tagged (no silent identity hijack)
    if (targetSession.fingerprint !== null && targetSession.fingerprint !== undefined) {
      throw new Meteor.Error('session-already-tagged', 'Target session already has a fingerprint — cannot re-tag');
    }

    // Tag the target session with this connection's fingerprint
    await ApplicationSessions.updateAsync(
      { _id: targetSessionId },
      {
        $set: {
          fingerprint: callerFingerprint,
          fingerprintSource: 'delegated',
          fingerprintDelegatedBy: callerSessionId,
          fingerprintDelegatedAt: new Date(),
        }
      }
    );

    // Mark calling session's source as 'self' if not already set
    if (!callerSession.fingerprintSource) {
      await ApplicationSessions.updateAsync(
        { _id: callerSessionId },
        { $set: { fingerprintSource: 'self' } }
      );
    }

    log.system(`[identity.authorizeSession] ${callerSessionId.slice(0, 8)} tagged ${targetSessionId.slice(0, 8)} as ${callerFingerprint.slice(0, 8)}`);
    return { ok: true };
  },

  /**
   * identity.revokeSession
   *
   * Clears the fingerprint from a target DDP session.
   * Caller must have fingerprintSource === 'self' (cannot revoke from observe-mode device).
   * Caller's fingerprint must match the target session's fingerprint.
   *
   * @param {string} targetSessionId — the target DDP session ID to revoke
   * @returns {{ ok: true }}
   * @throws Meteor.Error on any validation failure
   */
  'identity.revokeSession': async function ({ targetSessionId } = {}) {
    check(targetSessionId, String);
    this.unblock();

    const callerSessionId = this.connection && this.connection.id;
    if (!callerSessionId) {
      throw new Meteor.Error('no-session', 'No DDP session for this connection');
    }

    const callerSession = await ApplicationSessions.findOneAsync({ _id: callerSessionId });
    if (!callerSession || !callerSession.fingerprint) {
      throw new Meteor.Error('unauthorized', 'Caller must be authenticated');
    }

    // Only sign-mode (self-identified) sessions can revoke
    // An observe-mode device (fingerprintSource:'delegated') cannot revoke another device
    if (callerSession.fingerprintSource === 'delegated') {
      throw new Meteor.Error('unauthorized', 'Observe-mode sessions cannot revoke other sessions');
    }

    const targetSession = await ApplicationSessions.findOneAsync({ _id: targetSessionId });
    if (!targetSession) {
      // Session already gone — treat as success (idempotent)
      log.debug(`[identity.revokeSession] target ${targetSessionId.slice(0, 8)} not found — already expired`);
      return { ok: true };
    }

    // Caller's fingerprint must match target's fingerprint (only revoke your own delegated sessions)
    if (targetSession.fingerprint !== callerSession.fingerprint) {
      throw new Meteor.Error('unauthorized', 'Can only revoke sessions tagged with your own fingerprint');
    }

    await ApplicationSessions.updateAsync(
      { _id: targetSessionId },
      {
        $set: {
          fingerprint: null,
          fingerprintSource: null,
          fingerprintRevokedAt: new Date(),
          fingerprintRevokedBy: callerSessionId,
        }
      }
    );

    log.system(`[identity.revokeSession] ${callerSessionId.slice(0, 8)} revoked tag from ${targetSessionId.slice(0, 8)}`);
    return { ok: true };
  },

});

log.success('loaded koad:io-accounts/identity-session-methods (VESTA-SPEC-185 §8.7)');
