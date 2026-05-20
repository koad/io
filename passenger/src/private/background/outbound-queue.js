// outbound-queue.js
//
// SPEC-196 §5.3-5.4 — outbound message queue for Tier 3 fallback.
//
// When the daemon is unreachable, write operations (injectContext, signed
// emissions, etc.) are buffered to a FIFO queue in chrome.storage.local.
// When the daemon becomes reachable again, the queue flushes in order.
//
// Read operations (corpusByUrl, getPanelState, etc.) do NOT queue — they
// return offline status immediately. The current page context will likely
// have changed by the time the daemon is back, so queuing reads is pointless.
//
// Persistence rules:
//   - Stored in chrome.storage.local — survives browser restart
//   - Hard cap: MAX_QUEUE_SIZE entries; oldest dropped to keep memory bounded
//   - Each entry: { id, action, path, payload, queuedAt, attempts }
//   - After MAX_ATTEMPTS failures on flush, an entry is dead-lettered and
//     marked failed (kept for inspection but not retried again)
//
// Privacy: queued payloads sit on disk. Do not queue anything that contains
// short-lived secrets. The MCP session token is never included in the
// payload — it's attached at flush time by daemon-proxy.

import { currentTier, onTierChange } from './tier-detection.js';
import { daemonPost } from './daemon-proxy.js';

const STORAGE_KEY = 'outboundQueue';
const MAX_QUEUE_SIZE = 200;
const MAX_ATTEMPTS = 5;
const FLUSH_BACKOFF_MS = 1500;  // small gap between flush attempts to avoid hammering

let _flushing = false;

function newId() {
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readQueue() {
	const stored = await chrome.storage.local.get(STORAGE_KEY);
	return Array.isArray(stored[STORAGE_KEY]) ? stored[STORAGE_KEY] : [];
}

async function writeQueue(queue) {
	await chrome.storage.local.set({ [STORAGE_KEY]: queue });
}

// Enqueue an outbound write. Returns the queue entry id.
//
//   enqueue({ path: '/api/context/inject', payload: { ... } })
async function enqueue({ action, path, payload }) {
	const queue = await readQueue();
	const entry = {
		id: newId(),
		action: action || 'unknown',
		path,
		payload,
		queuedAt: Date.now(),
		attempts: 0,
	};
	queue.push(entry);
	// Trim from the front if we're over capacity (drop oldest, not newest).
	while (queue.length > MAX_QUEUE_SIZE) queue.shift();
	await writeQueue(queue);
	console.log('outbound-queue: enqueued', entry.id, action);
	return entry.id;
}

// Flush — attempts each entry in order. Successes get removed; failures
// increment attempts; entries past MAX_ATTEMPTS are dead-lettered.
async function flush() {
	if (_flushing) return;
	const tier = currentTier();
	if (tier !== 1 && tier !== 2) return;

	_flushing = true;
	try {
		let queue = await readQueue();
		if (queue.length === 0) return;

		console.log('outbound-queue: flushing', queue.length, 'entries');

		const survivors = [];
		for (const entry of queue) {
			if (entry.deadLettered) {
				survivors.push(entry);
				continue;
			}
			const result = await daemonPost(entry.path, entry.payload);
			if (result.status === 'ok') {
				console.log('outbound-queue: flushed', entry.id);
				// Don't keep — it's delivered.
				continue;
			}
			if (result.status === 'offline') {
				// Daemon went away mid-flush — stop and retry later.
				survivors.push(entry);
				break;
			}
			// Real error — bump attempts and keep
			entry.attempts = (entry.attempts || 0) + 1;
			if (entry.attempts >= MAX_ATTEMPTS) {
				entry.deadLettered = true;
				entry.lastError = result;
				console.warn('outbound-queue: dead-lettered', entry.id, result);
			}
			survivors.push(entry);
			await new Promise((r) => setTimeout(r, FLUSH_BACKOFF_MS));
		}

		// If we broke early on offline, copy the rest verbatim.
		const remaining = queue.slice(survivors.length);
		const next = [...survivors, ...remaining];
		await writeQueue(next);

		// Notify popup/panel — queued count just changed.
		chrome.runtime.sendMessage({ action: 'panelStateChanged', reason: 'queue' }).catch(() => {});
	} finally {
		_flushing = false;
	}
}

async function queueSize() {
	const queue = await readQueue();
	return {
		total: queue.length,
		deadLettered: queue.filter((e) => e.deadLettered).length,
	};
}

async function clearDeadLettered() {
	const queue = await readQueue();
	const next = queue.filter((e) => !e.deadLettered);
	await writeQueue(next);
}

// Flush whenever tier rises to 1 or 2.
onTierChange((tier) => {
	if (tier === 1 || tier === 2) {
		flush().catch((e) => console.warn('outbound-queue: flush failed', e));
	}
});

// Initial flush attempt if we're already online at SW boot.
const t = currentTier();
if (t === 1 || t === 2) {
	flush().catch(() => {});
}

export { enqueue, flush, queueSize, clearDeadLettered };
