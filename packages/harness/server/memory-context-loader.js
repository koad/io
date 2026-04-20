// Layer 4a context loader — VESTA-SPEC-134 §8 — Phase 4
//
// Assembles the per-user memory block injected into the system prompt
// at Layer 4a (between entity-local per-user notes and the PRIMER).
//
// Session-start flow (§8.2):
//   1. Authenticate → KEK already derived by caller and passed in.
//   2. Fetch active CID index for (user_id, entity) from UserMemories.
//   3. Fetch + decrypt blobs via MemoryStore.read().
//   4. Sort by captured_at DESC.
//   5. Take first N_MAX_MEMORIES (env KOAD_IO_MEMORY_MAX_N, default 50).
//   6. Assemble Layer 4a text.
//
// Silent omission conditions (§8.1 + flight plan):
//   - User not authenticated (no user_id)
//   - sharedKnowledgeToken bond missing or revoked
//   - profile_quality < basic
//   - KEK derivation failed (kek is null/undefined)
//   - N_MAX_MEMORIES = 0
//   - UserMemories fetch returns empty
//
// On any of these: returns '' (empty string). The entity proceeds without Layer 4a.
//
// API:
//   KoadHarnessMemoryContextLoader.load(opts) → Promise<String>
//
// opts = {
//   userId:          String | null,     — Meteor user _id; null → silent omit
//   entity:          String,            — entity handle e.g. "alice"
//   kek:             CryptoKey | null,  — user's current KEK; null → silent omit
//   profileQuality:  String | null,     — "none" | "basic" | "full"; < basic → omit
//   bondActive:      Boolean,           — false → silent omit
//   maxMemories:     Number?,           — per-call override (else env default)
// }

'use strict';

const DEFAULT_MAX = 50;

function getMaxMemories(overrideN) {
  if (typeof overrideN === 'number') return overrideN;
  const envVal = parseInt(
    (typeof process !== 'undefined' && process.env && process.env.KOAD_IO_MEMORY_MAX_N) || '',
    10
  );
  return isNaN(envVal) ? DEFAULT_MAX : envVal;
}

function profileQualityMeetsBasic(pq) {
  return pq === 'basic' || pq === 'full';
}

KoadHarnessMemoryContextLoader = {

  // registerKekProvider(fn)
  //
  // Hosting app registers a function that takes a userId and returns a Promise<CryptoKey|null>.
  // Called per-request at chat time to provide the KEK for the authenticated user.
  // If null is returned, Layer 4a is silently omitted for that session.
  //
  // Example registration in the hosting app:
  //   KoadHarnessMemoryContextLoader.registerKekProvider(async (userId) => {
  //     // ... return user's KEK (from session, IndexedDB proxy, or test stub) ...
  //   });
  registerKekProvider(fn) {
    globalThis.KoadHarnessMemoryKekProvider = fn;
  },

  // load(opts) → Promise<String>
  // Returns the Layer 4a block text, or '' if any silent-omission condition applies.
  async load({ userId, entity, kek, profileQuality, bondActive, maxMemories } = {}) {
    // ── Silent omission checks (SPEC-134 §8.1) ─────────────────────────────────

    if (!userId) return '';
    if (!bondActive) return '';
    if (!profileQualityMeetsBasic(profileQuality)) return '';
    if (!kek) return '';

    const N = getMaxMemories(maxMemories);
    if (N === 0) return '';

    const col   = globalThis.UserMemoriesCollection;
    const store = globalThis.KoadMemoryStore;

    if (!col || !store) {
      // Infrastructure not ready — silent omit
      return '';
    }

    // ── Fetch active CID index ──────────────────────────────────────────────────
    let activeDocs;
    try {
      activeDocs = await col.find({
        user_id:       userId,
        entity,
        superseded_at: null,
        forgotten_at:  null,
      }).fetchAsync();
    } catch (err) {
      // Fetch failure → silent omit; log at debug
      (console.debug || console.log)(
        `[harness:memory-context] fetch failed for user=${userId} entity=${entity}: ${err.message}`
      );
      return '';
    }

    if (!activeDocs || activeDocs.length === 0) return '';

    // ── Fetch + decrypt blobs ───────────────────────────────────────────────────
    // Sort by captured_at DESC first, then take N, then decrypt.
    // This avoids fetching + decrypting blobs we'll discard.
    activeDocs.sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
    const toLoad = activeDocs.slice(0, N);

    const fragments = [];
    for (const doc of toLoad) {
      try {
        const plaintextBytes = await store.read(doc.cid, doc.wrapped_dek, kek);
        const plaintext = new TextDecoder().decode(plaintextBytes);
        fragments.push({
          topic:       doc.topic || null,
          captured_at: doc.captured_at,
          content:     plaintext,
        });
      } catch (err) {
        if (err.code === 'KEY_ROTATION_REQUIRED') {
          // Stale key — skip this fragment silently (caller handles rotation UX)
          (console.debug || console.log)(
            `[harness:memory-context] KEY_ROTATION_REQUIRED for cid=${doc.cid} — skipping fragment`
          );
        } else {
          (console.debug || console.log)(
            `[harness:memory-context] decrypt failed for cid=${doc.cid}: ${err.message}`
          );
        }
        // Either way: skip fragment, continue
      }
    }

    if (fragments.length === 0) return '';

    // ── Assemble Layer 4a block (SPEC-134 §8.2) ────────────────────────────────
    // ## What I remember about you
    // - [topic or timestamp]: <content>
    // - ...
    //
    // topic prefix: if memory has `topic`, use topic. Else use captured_at ISO date (YYYY-MM-DD).

    const lines = ['## What I remember about you', ''];
    for (const { topic, captured_at, content } of fragments) {
      const prefix = topic
        ? topic
        : (captured_at instanceof Date ? captured_at : new Date(captured_at))
            .toISOString().slice(0, 10);
      lines.push(`- [${prefix}]: ${content}`);
    }

    return lines.join('\n');
  },
};
