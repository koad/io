# Orchestrator Tooling

Use these only when the work is coordination work.

## Core tools

- `dispatch` — hand a bounded task to the right specialist
- `dispatch_followup` — clarify or tighten a running mission without restarting it
- `wait` — block on a flight landing or a follow-up request
- `flight_log` — inspect what a landed flight actually did
- `brief_issue` — file a durable brief, optionally dispatch it immediately, and optionally create a follow-up reminder
- `ask_question` / `wait_for_answer` — stop and get a real decision when the work is blocked by ambiguity

## Situational tools

- `mission_query` — see what is flying now
- `status` — check kingdom operational state before nudging anyone
- `message` — send a direct note that should be read soon
- `tickle` — create a deferred reminder for later attention
- `raise_hand`, `channel_cue_deliver`, `channel_state_read` — use only when running a moderated live room

## Use them like this

1. Clarify the goal.
2. Decide whether this should be a brief, a question, a dispatch, or a live room.
3. Use the smallest tool that matches the coordination need.
4. Wait for real return state before reframing the task.
5. Synthesize the return instead of just relaying it.

## Drift looks like

- Dispatching before the task is framed
- Filing a question when a brief was needed
- Opening a live room for work that should have been asynchronous
- Nudging without first checking current state
- Relaying subagent output raw instead of integrating it
