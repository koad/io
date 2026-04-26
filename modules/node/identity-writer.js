// identity-writer.js — Entity sigchain registry writer (ESM)
//
// Writes or updates ~/.vesta/entities/<handle>/sigchain/ after a sigchain
// ceremony or append. Implements the write-back path described in
// VESTA-SPEC-024 v1.3 §12.5.
//
// Two entry points:
//   writeIdentityRegistry(opts) — full write (first creation OR full update)
//   updateSigchainHead(opts)    — lightweight head-only update after each append
//
// Design notes:
//   - fs/promises only — no extra deps; modules/node stays thin
//   - Atomic writes: temp file → rename (avoids torn reads on interrupt)
//   - Dir modes: 0o700 (matches entity dir convention); files 0o600 for
//     non-public content; master.pub.asc is public-key material but we still
//     use 0o600 to match the surrounding dir's privacy posture
//   - `created` semantics: set on first creation; preserved on all updates
//   - `sigchainHeadUpdated` always updates to now
//
// API:
//   writeIdentityRegistry(opts) → Promise<{ written, sigchainDir, created, error? }>
//   updateSigchainHead(opts)    → Promise<{ updated, error? }>

import fs from 'fs/promises';
import { existsSync, mkdtempSync } from 'fs';
import path from 'path';
import os from 'os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Atomic write: write to a sibling .tmp file then rename into place.
 * On POSIX, rename(2) is atomic within the same filesystem.
 */
async function atomicWrite(filePath, content, mode = 0o600) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  // mkdtempSync in the same dir so rename stays same-filesystem
  let tmpPath;
  try {
    // We want a tmp in the same directory so rename stays on-fs.
    // Use a fixed suffix rather than mkdtemp (which makes dirs, not files).
    tmpPath = path.join(dir, `.${base}.tmp.${process.pid}`);
    await fs.writeFile(tmpPath, content, { encoding: 'utf8', mode });
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    // Best-effort cleanup
    if (tmpPath) {
      try { await fs.unlink(tmpPath); } catch (_) {}
    }
    throw err;
  }
}

/**
 * Read existing metadata.json from sigchainDir, returning parsed object or null.
 */
async function readExistingMetadata(sigchainDir) {
  const metaPath = path.join(sigchainDir, 'metadata.json');
  try {
    const raw = await fs.readFile(metaPath, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write or update the entity's sigchain registry entry.
 *
 * Creates ~/.vesta/entities/<handle>/sigchain/ if it does not exist (and the
 * parent ~/.vesta/entities/<handle>/ if needed).
 *
 * @param {object} opts
 * @param {string} opts.handle - Entity handle
 * @param {string} opts.masterFingerprint - 40-hex master PGP fingerprint
 * @param {string} opts.masterPublicKey - PGP-armored master public key
 * @param {string} opts.sigchainHeadCID - Current sigchain tip CID
 * @param {string} [opts.status] - "active" | "pruned" | "succeeded" (default "active")
 * @param {string} [opts.created] - ISO 8601 (default: now if creating; preserved if updating)
 * @param {string} [opts.vestaDir] - Override path to ~/.vesta/
 * @returns {Promise<{
 *   written: boolean,
 *   sigchainDir: string,
 *   created: boolean,  // true if new record, false if updated
 *   error?: string
 * }>}
 */
export async function writeIdentityRegistry(opts = {}) {
  const { handle, masterFingerprint, masterPublicKey, sigchainHeadCID } = opts;

  // Validate required fields
  if (!handle || typeof handle !== 'string') {
    return { written: false, sigchainDir: null, created: false, error: 'handle is required' };
  }
  if (!masterFingerprint || typeof masterFingerprint !== 'string') {
    return { written: false, sigchainDir: null, created: false, error: 'masterFingerprint is required' };
  }
  if (!masterPublicKey || typeof masterPublicKey !== 'string') {
    return { written: false, sigchainDir: null, created: false, error: 'masterPublicKey is required' };
  }
  if (!sigchainHeadCID || typeof sigchainHeadCID !== 'string') {
    return { written: false, sigchainDir: null, created: false, error: 'sigchainHeadCID is required' };
  }

  const vestaDir = opts.vestaDir || path.join(os.homedir(), '.vesta');
  const entityDir = path.join(vestaDir, 'entities', handle);
  const sigchainDir = path.join(entityDir, 'sigchain');

  try {
    // Determine if this is a first creation or an update
    const isNew = !existsSync(sigchainDir);

    // Ensure directories exist
    await fs.mkdir(sigchainDir, { recursive: true, mode: 0o700 });

    // Preserve `created` from existing record if updating
    let createdAt;
    if (opts.created) {
      createdAt = opts.created;
    } else if (!isNew) {
      const existing = await readExistingMetadata(sigchainDir);
      createdAt = (existing && existing.created) || new Date().toISOString();
    } else {
      createdAt = new Date().toISOString();
    }

    const now = new Date().toISOString();
    const status = opts.status || 'active';

    // --- Write master.pub.asc ---
    const masterPubPath = path.join(sigchainDir, 'master.pub.asc');
    await atomicWrite(masterPubPath, masterPublicKey, 0o600);

    // --- Write metadata.json ---
    const metadata = {
      handle,
      masterFingerprint,
      sigchainHeadCID,
      status,
      created: createdAt,
      sigchainHeadUpdated: now,
    };
    const metaPath = path.join(sigchainDir, 'metadata.json');
    await atomicWrite(metaPath, JSON.stringify(metadata, null, 2) + '\n', 0o600);

    // --- Write sigchain-head.txt ---
    const headPath = path.join(sigchainDir, 'sigchain-head.txt');
    await atomicWrite(headPath, sigchainHeadCID + '\n', 0o600);

    return { written: true, sigchainDir, created: isNew };

  } catch (err) {
    return {
      written: false,
      sigchainDir,
      created: false,
      error: err.message || String(err),
    };
  }
}

/**
 * Update the sigchain head only — for use after appending a new entry.
 * Lighter-weight than writeIdentityRegistry; just updates sigchain-head.txt
 * and metadata.json's sigchainHeadCID + sigchainHeadUpdated fields.
 *
 * Requires that the record was previously created by writeIdentityRegistry.
 *
 * @param {object} opts
 * @param {string} opts.handle
 * @param {string} opts.sigchainHeadCID
 * @param {string} [opts.vestaDir]
 * @returns {Promise<{ updated: boolean, error?: string }>}
 */
export async function updateSigchainHead(opts = {}) {
  const { handle, sigchainHeadCID } = opts;

  if (!handle || typeof handle !== 'string') {
    return { updated: false, error: 'handle is required' };
  }
  if (!sigchainHeadCID || typeof sigchainHeadCID !== 'string') {
    return { updated: false, error: 'sigchainHeadCID is required' };
  }

  const vestaDir = opts.vestaDir || path.join(os.homedir(), '.vesta');
  const sigchainDir = path.join(vestaDir, 'entities', handle, 'sigchain');

  if (!existsSync(sigchainDir)) {
    return { updated: false, error: `sigchain directory not found: ${sigchainDir} — call writeIdentityRegistry first` };
  }

  try {
    // Read existing metadata to preserve all other fields
    const existing = await readExistingMetadata(sigchainDir);
    if (!existing) {
      return { updated: false, error: 'metadata.json missing or unreadable — cannot perform head update' };
    }

    const now = new Date().toISOString();

    // Patch only the two head fields; preserve everything else
    const updated = {
      ...existing,
      sigchainHeadCID,
      sigchainHeadUpdated: now,
    };

    // --- Update metadata.json ---
    const metaPath = path.join(sigchainDir, 'metadata.json');
    await atomicWrite(metaPath, JSON.stringify(updated, null, 2) + '\n', 0o600);

    // --- Update sigchain-head.txt ---
    const headPath = path.join(sigchainDir, 'sigchain-head.txt');
    await atomicWrite(headPath, sigchainHeadCID + '\n', 0o600);

    return { updated: true };

  } catch (err) {
    return { updated: false, error: err.message || String(err) };
  }
}
