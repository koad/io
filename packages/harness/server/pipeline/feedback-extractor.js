// Feedback signal extractor — VESTA-SPEC-132 §3.1
//
// Extracts <<CAPTURE_FEEDBACK: summary_text>> markers from entity responses.
// Strips all markers before client delivery. Fires the registered callback
// (registered by the hosting app) for each valid feedback item.
//
// The harness package does NOT write to any Mongo collection directly.
// The hosting app registers a callback via KoadHarnessFeedbackExtractor.register()
// to handle the write. This keeps the harness package portable.
//
// Parallel to the LEVEL_COMPLETE marker pattern (see prompt-assembler.js).

// VESTA-SPEC-132 §3.1.1 — regex matches <<CAPTURE_FEEDBACK: summary_text>>
// Non-greedy match on summary; no nested << or >> allowed (checked post-match)
const CAPTURE_FEEDBACK_RE = /<<CAPTURE_FEEDBACK:\s+(.+?)>>/g;

const SUMMARY_MIN = 10;   // SPEC-132 §3.1.2
const SUMMARY_MAX = 280;  // SPEC-132 §3.1.2

let _callback = null; // registered by hosting app

KoadHarnessFeedbackExtractor = {
  // Register the hosting app's feedback sink.
  // callback(payload) where payload = { entity, sessionId, userId, summary, sessionHistory }
  // Returns void. The callback may be async; extractor does not await it (fire-and-forget).
  register(callback) {
    _callback = callback;
  },

  // Extract all <<CAPTURE_FEEDBACK>> markers from responseText.
  // Validates each; fires registered callback for valid items (if userId present).
  // Returns the cleaned text (markers stripped in all cases).
  //
  // Params:
  //   responseText   — the full response string from the provider
  //   { entity, sessionId, userId, sessionHistory }
  //     entity        — entity handle (e.g. "alice")
  //     sessionId     — harness session ID
  //     userId        — Meteor users._id of the sponsor (null if anonymous)
  //     sessionHistory — last 10 messages as [{ role, content, at }]
  extract(responseText, { entity, sessionId, userId, sessionHistory }) {
    if (!responseText || typeof responseText !== 'string') return responseText;

    const captures = [];
    let match;

    // Reset regex state (global flag)
    CAPTURE_FEEDBACK_RE.lastIndex = 0;

    while ((match = CAPTURE_FEEDBACK_RE.exec(responseText)) !== null) {
      const raw = match[1]; // summary text before validation

      // SPEC-132 §3.1.2 and §3.1.6 validation
      if (typeof raw !== 'string') continue;

      // Reject nested << or >> inside summary
      if (raw.includes('<<') || raw.includes('>>')) {
        console.warn('[harness:feedback] marker discarded — nested angle brackets in summary');
        continue;
      }

      const trimmed = raw.trim();

      // Too short
      if (trimmed.length < SUMMARY_MIN) {
        console.warn(`[harness:feedback] marker discarded — summary too short (${trimmed.length} chars)`);
        continue;
      }

      let summary = trimmed;
      let truncated = false;

      // Too long — truncate, set flag, log
      if (summary.length > SUMMARY_MAX) {
        console.warn(`[harness:feedback] summary truncated from ${summary.length} to ${SUMMARY_MAX} chars`);
        summary = summary.slice(0, SUMMARY_MAX);
        truncated = true;
      }

      captures.push({ summary, truncated });
    }

    // Strip ALL markers from the text (valid and invalid alike — SPEC-132 §3.1.5)
    const cleanedText = responseText.replace(CAPTURE_FEEDBACK_RE, '').trimEnd();

    // Fire callback for each valid capture
    if (captures.length > 0) {
      if (!userId) {
        // Anonymous session — discard, do not write (SPEC-132 §3.1.4)
        console.warn(`[harness:feedback] ${captures.length} marker(s) discarded — no authenticated sponsor`);
      } else if (!_callback) {
        console.warn('[harness:feedback] markers captured but no callback registered — skipping write');
      } else {
        for (const { summary, truncated } of captures) {
          // Fire-and-forget per SPEC-132 §7 (must not block response delivery)
          Meteor.defer(() => {
            try {
              const result = _callback({ entity, sessionId, userId, summary, truncated, sessionHistory: sessionHistory || [] });
              // Support async callbacks silently
              if (result && typeof result.catch === 'function') {
                result.catch(err => console.error('[harness:feedback] callback error:', err.message));
              }
            } catch (err) {
              console.error('[harness:feedback] callback threw:', err.message);
            }
          });
        }
      }
    }

    return cleanedText;
  },
};
