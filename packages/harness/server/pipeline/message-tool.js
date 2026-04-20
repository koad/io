// message-tool.js — harness leave_message tool
//
// Extracts <<LEAVE_MESSAGE: json>> markers from entity response text.
// Strips all markers before client delivery. For each valid marker, fires the
// registered async callback (fire-and-forget) so the hosting app can POST the
// message to the daemon inbox.
//
// The harness package does NOT know the daemon URL and does NOT post directly.
// The hosting app wires the daemon call via KoadHarnessMessageTool.register().
//
// Marker format (single-line JSON object):
//   <<LEAVE_MESSAGE: {"target":"juno","action":"note","subject":"...","body":"...","meta":{}}>>
//
// Fields:
//   target   — entity slug (required; lowercase alphanumeric + hyphens)
//   action   — request action string (required; e.g. "note", "brief", "feedback")
//   subject  — short summary string (required)
//   body     — message content (required)
//   meta     — optional object with extra context (defaults to {})
//
// If entity is not provided in the JSON, the calling entity handle is used as sender.
//
// Parallel to KoadHarnessFeedbackExtractor (VESTA-SPEC-132) and KoadHarnessMemoryParser
// (VESTA-SPEC-134) — same register/parse/strip lifecycle, same fire-and-forget guarantee.

'use strict';

// Matches <<LEAVE_MESSAGE: ...>> where ... is a JSON object (no nested >>)
// Non-greedy on content; single-line JSON only (no literal newlines inside the marker)
const LEAVE_MESSAGE_RE = /<<LEAVE_MESSAGE:\s*(\{[^>]*?\})>>/g;

// Valid entity handle: lowercase alphanumeric + hyphens only
const VALID_HANDLE_RE = /^[a-z0-9-]+$/;

// Min/max for subject and body to prevent garbage markers
const SUBJECT_MIN = 3;
const SUBJECT_MAX = 200;
const BODY_MIN    = 1;
const BODY_MAX    = 4000;

let _callback = null;

KoadHarnessMessageTool = {

  // Register the hosting app's message dispatch callback.
  //
  // callback(payload) where payload = {
  //   entity,      — the entity that emitted the marker (sender)
  //   sessionId,   — harness session ID
  //   userId,      — Meteor users._id of the sponsor (null if anonymous)
  //   target,      — destination entity handle
  //   action,      — request action string
  //   subject,     — short summary
  //   body,        — message body
  //   meta,        — extra context object
  // }
  //
  // The callback may be async; message-tool does not await (fire-and-forget).
  register(callback) {
    _callback = callback;
    globalThis._koadLeaveMessageCallback = callback;
  },

  // parse(responseText, context) → cleanedText
  //
  // Extracts all <<LEAVE_MESSAGE>> markers, validates each, fires registered
  // callback for valid ones (if authenticated), strips all markers from text.
  //
  // context = { entity, sessionId, userId }
  //   entity:    entity handle (the sender)
  //   sessionId: harness session ID (for logging)
  //   userId:    Meteor users._id (null → discard; entity-to-entity messages still allowed
  //              if fired without a sponsoring user, but we log a warning)
  parse(responseText, { entity, sessionId, userId } = {}) {
    if (!responseText || typeof responseText !== 'string') return responseText;

    const sid      = sessionId || 'unknown';
    const sender   = entity   || 'unknown';
    const messages = [];

    // Collect all matches
    LEAVE_MESSAGE_RE.lastIndex = 0;
    let match;
    while ((match = LEAVE_MESSAGE_RE.exec(responseText)) !== null) {
      const rawJson = match[1];

      // Reject nested markers in the JSON string
      if (rawJson.includes('<<') || rawJson.includes('>>')) {
        console.warn(`[harness:message-tool] marker discarded — nested angle brackets session=${sid}`);
        continue;
      }

      // Parse JSON
      let data;
      try {
        data = JSON.parse(rawJson);
      } catch (e) {
        console.warn(`[harness:message-tool] marker discarded — invalid JSON session=${sid}: ${e.message}`);
        continue;
      }

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        console.warn(`[harness:message-tool] marker discarded — JSON is not an object session=${sid}`);
        continue;
      }

      // Validate target
      const target = typeof data.target === 'string' ? data.target.trim() : '';
      if (!target) {
        console.warn(`[harness:message-tool] marker discarded — missing target session=${sid}`);
        continue;
      }
      if (!VALID_HANDLE_RE.test(target)) {
        console.warn(`[harness:message-tool] marker discarded — invalid target "${target}" session=${sid}`);
        continue;
      }

      // Validate action
      const action = typeof data.action === 'string' ? data.action.trim() : '';
      if (!action) {
        console.warn(`[harness:message-tool] marker discarded — missing action session=${sid}`);
        continue;
      }
      // action: printable ASCII, no spaces, reasonable length
      if (action.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(action)) {
        console.warn(`[harness:message-tool] marker discarded — invalid action "${action}" session=${sid}`);
        continue;
      }

      // Validate subject
      const subject = typeof data.subject === 'string' ? data.subject.trim() : '';
      if (subject.length < SUBJECT_MIN || subject.length > SUBJECT_MAX) {
        console.warn(`[harness:message-tool] marker discarded — subject length ${subject.length} out of range [${SUBJECT_MIN},${SUBJECT_MAX}] session=${sid}`);
        continue;
      }

      // Validate body
      const body = typeof data.body === 'string' ? data.body.trim() : '';
      if (body.length < BODY_MIN || body.length > BODY_MAX) {
        console.warn(`[harness:message-tool] marker discarded — body length ${body.length} out of range [${BODY_MIN},${BODY_MAX}] session=${sid}`);
        continue;
      }

      // meta is optional; must be plain object if present
      let meta = {};
      if (data.meta !== undefined && data.meta !== null) {
        if (typeof data.meta === 'object' && !Array.isArray(data.meta)) {
          meta = data.meta;
        } else {
          console.warn(`[harness:message-tool] meta ignored — not a plain object session=${sid}`);
        }
      }

      messages.push({ target, action, subject, body, meta });
    }

    // Strip ALL markers (valid and invalid alike).
    // First pass: strip well-formed <<LEAVE_MESSAGE: {...}>> markers.
    // Second pass: strip any remaining <<LEAVE_MESSAGE: ...>> forms that didn't
    // match the JSON object pattern (e.g. malformed JSON, plain text content).
    // This ensures <<LEAVE_MESSAGE: never leaks to the client.
    LEAVE_MESSAGE_RE.lastIndex = 0;
    let cleanedText = responseText.replace(LEAVE_MESSAGE_RE, '');
    // Second pass: catch any <<LEAVE_MESSAGE: ...>> not caught by the main regex
    cleanedText = cleanedText
      .replace(/<<LEAVE_MESSAGE:[^>]*>>/g, '')
      .trimEnd();

    // Fire callback for each valid message
    if (messages.length > 0) {
      if (!_callback) {
        console.warn(`[harness:message-tool] ${messages.length} message(s) captured but no callback registered — dropping`);
      } else {
        for (const msg of messages) {
          // Fire-and-forget — must not block response delivery
          const payload = {
            entity:    sender,
            sessionId: sid,
            userId,
            target:    msg.target,
            action:    msg.action,
            subject:   msg.subject,
            body:      msg.body,
            meta:      msg.meta,
          };

          if (typeof Meteor !== 'undefined' && Meteor.defer) {
            Meteor.defer(() => {
              try {
                const result = _callback(payload);
                if (result && typeof result.catch === 'function') {
                  result.catch(err => console.error('[harness:message-tool] callback error:', err.message));
                }
              } catch (err) {
                console.error('[harness:message-tool] callback threw:', err.message);
              }
            });
          } else {
            // Outside Meteor context (tests) — call directly
            try {
              const result = _callback(payload);
              if (result && typeof result.catch === 'function') {
                result.catch(err => console.error('[harness:message-tool] callback error:', err.message));
              }
            } catch (err) {
              console.error('[harness:message-tool] callback threw:', err.message);
            }
          }
        }
      }
    }

    return cleanedText;
  },
};
