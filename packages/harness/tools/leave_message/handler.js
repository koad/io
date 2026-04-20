// leave_message/handler.js — framework leave_message tool handler
//
// Called by the harness when the LLM natively invokes this tool.
// Delegates to KoadHarnessMessageTool._callback, the same callback
// the hosting app registers via KoadHarnessMessageTool.register().
// This keeps the daemon-URL knowledge in one place (the hosting app).
//
// params = { target, action, subject, body }
// context = { entity, sessionId, userId, settings }
//
// Returns { sent: true, target, action } on success.
// Throws on invalid params or missing callback — harness catches and
// returns { error: "..." } to the LLM.

'use strict';

const VALID_HANDLE_RE = /^[a-z0-9-]+$/;
const VALID_ACTION_RE = /^[a-zA-Z0-9_-]+$/;

module.exports = async function leaveMessageHandler(params, context) {
  const { target, action, subject, body } = params;

  if (!target || typeof target !== 'string' || !VALID_HANDLE_RE.test(target)) {
    throw new Error(`invalid target handle: "${target}" — must be lowercase alphanumeric + hyphens`);
  }

  if (!action || typeof action !== 'string' || action.length > 64 || !VALID_ACTION_RE.test(action)) {
    throw new Error(`invalid action: "${action}" — must be alphanumeric + underscores/hyphens, max 64 chars`);
  }

  if (!subject || typeof subject !== 'string' || subject.trim().length < 3 || subject.trim().length > 200) {
    throw new Error('subject must be 3–200 characters');
  }

  if (!body || typeof body !== 'string' || body.trim().length < 1 || body.trim().length > 4000) {
    throw new Error('body must be 1–4000 characters');
  }

  const callback = globalThis._koadLeaveMessageCallback;
  if (!callback) {
    throw new Error('leave_message: no callback registered — hosting app must call KoadHarnessMessageTool.register()');
  }

  await callback({
    entity:    context.entity,
    sessionId: context.sessionId,
    userId:    context.userId,
    target:    target.trim(),
    action:    action.trim(),
    subject:   subject.trim(),
    body:      body.trim(),
    meta:      {},
  });

  return { sent: true, target: target.trim(), action: action.trim() };
};
