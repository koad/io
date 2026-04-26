// identity-resolver.js — Entity identity resolver (ESM)
//
// Reads from the Vesta entity registry (~/.vesta/entities/<handle>/sigchain/)
// and returns the identity state for an entity.
//
// Implements VESTA-SPEC-024 v1.3 §12.3 resolveIdentity() lookup contract.
//
// Lite mode (default): reads static state from disk —
//   masterFingerprint, masterPublicKey, sigchainHeadCID, status, created, sigchainHeadUpdated.
//
// Full mode (opts.walk = true, opts.entries provided): also walks the chain
// via verifyChain() from ./sigchain.js and returns the current authorized leaf set.
//
// The sigchain/ subdirectory is OPTIONAL (SPEC-024 §12.1). Entities without
// the master/leaf model return { resolved: false, reason: 'no-sigchain' }.
//
// This module is read-only. Writing to ~/.vesta/entities/<handle>/sigchain/
// (e.g., after a ceremony completes) is a separate concern (Flight E or later).
//   TODO: Flight E — write-back path: entity produces entry → publishes to IPFS
//         → submits signed update request to Vesta per SPEC-024 §12.5.
//
// API:
//   resolveIdentity(handle, opts?) → Promise<{...}>

import fs from 'fs';
import path from 'path';
import os from 'os';
import { verifyChain } from './sigchain.js';

/**
 * Resolve an entity's identity from the local Vesta registry.
 *
 * Lite mode (default): returns the static state from disk —
 *   masterFingerprint, masterPublicKey, sigchainHeadCID, etc.
 *
 * Full mode (walk: true + entries provided): also walks the chain
 * and returns the current authorized-leaf-set.
 *
 * @param {string} handle - Entity handle (e.g., 'koad', 'juno')
 * @param {object} [opts]
 * @param {string} [opts.vestaDir] - Override path to ~/.vesta/ (default: os.homedir()/.vesta)
 * @param {boolean} [opts.walk] - If true, walk the chain entries to compute leafSet
 * @param {Array<object>} [opts.entries] - Ordered chain entries (genesis to tip) — required if walk is true
 * @returns {Promise<{
 *   resolved: boolean,
 *   reason?: 'no-entity-record' | 'no-sigchain' | 'metadata-missing' | 'master-pubkey-missing',
 *   handle?: string,
 *   masterFingerprint?: string,
 *   masterPublicKey?: string,
 *   sigchainHeadCID?: string,
 *   status?: string,
 *   created?: string,
 *   sigchainHeadUpdated?: string,
 *   headMismatch?: string,
 *   // populated when walk: true
 *   leafSet?: Array<{ fingerprint: string, pubkey: string, device_label: string, authorized_at: string }>,
 *   chainErrors?: Array<{ index?: number, type?: string, error: string }>,
 * }>}
 */
export async function resolveIdentity(handle, opts = {}) {
  if (!handle || typeof handle !== 'string') {
    throw new Error('[identity-resolver] resolveIdentity: handle must be a non-empty string');
  }

  const vestaDir = opts.vestaDir || path.join(os.homedir(), '.vesta');
  const entityDir = path.join(vestaDir, 'entities', handle);
  const sigchainDir = path.join(entityDir, 'sigchain');

  // Step 3: check entity + sigchain existence
  if (!fs.existsSync(entityDir)) {
    return { resolved: false, reason: 'no-entity-record' };
  }

  if (!fs.existsSync(sigchainDir)) {
    return { resolved: false, reason: 'no-sigchain' };
  }

  // Step 4: read sigchain/metadata.json
  const metadataPath = path.join(sigchainDir, 'metadata.json');
  if (!fs.existsSync(metadataPath)) {
    return { resolved: false, reason: 'metadata-missing' };
  }

  let metadata;
  try {
    const raw = fs.readFileSync(metadataPath, 'utf8');
    metadata = JSON.parse(raw);
  } catch (err) {
    return { resolved: false, reason: 'metadata-missing' };
  }

  // Step 5: read sigchain/master.pub.asc
  const masterPubPath = path.join(sigchainDir, 'master.pub.asc');
  if (!fs.existsSync(masterPubPath)) {
    return { resolved: false, reason: 'master-pubkey-missing' };
  }

  let masterPublicKey;
  try {
    masterPublicKey = fs.readFileSync(masterPubPath, 'utf8').trim();
  } catch (err) {
    return { resolved: false, reason: 'master-pubkey-missing' };
  }

  // Step 6: optionally read sigchain-head.txt and cross-check with metadata
  let headMismatch;
  const headTxtPath = path.join(sigchainDir, 'sigchain-head.txt');
  if (fs.existsSync(headTxtPath)) {
    let headTxt;
    try {
      headTxt = fs.readFileSync(headTxtPath, 'utf8').trim();
    } catch (_) {
      // Non-fatal — sigchain-head.txt is a convenience file; metadata.json is authoritative
    }
    if (headTxt && metadata.sigchainHeadCID && headTxt !== metadata.sigchainHeadCID) {
      // Prefer metadata.json's value per spec — but flag the discrepancy
      headMismatch = `sigchain-head.txt CID (${headTxt}) does not match metadata.json sigchainHeadCID (${metadata.sigchainHeadCID}) — using metadata.json`;
      console.warn(`[identity-resolver] WARNING: ${headMismatch}`);
    }
  }

  // Step 7: build lite-mode response
  const result = {
    resolved: true,
    handle: metadata.handle || handle,
    masterFingerprint: metadata.masterFingerprint || null,
    masterPublicKey,
    sigchainHeadCID: metadata.sigchainHeadCID || null,
    status: metadata.status || null,
    created: metadata.created || null,
    sigchainHeadUpdated: metadata.sigchainHeadUpdated || null,
  };

  if (headMismatch) {
    result.headMismatch = headMismatch;
  }

  // Step 8: walk mode
  if (opts.walk === true) {
    if (!opts.entries || !Array.isArray(opts.entries) || opts.entries.length === 0) {
      result.chainErrors = [{ error: 'walk requested but no entries provided' }];
      return result;
    }

    const walkResult = await verifyChain(opts.entries);

    // Cross-validate masterFingerprint between metadata and chain
    const chainErrors = Array.isArray(walkResult.errors) ? [...walkResult.errors] : [];

    if (
      result.masterFingerprint &&
      walkResult.masterFingerprint &&
      result.masterFingerprint !== walkResult.masterFingerprint
    ) {
      chainErrors.push({
        type: 'master-fingerprint-mismatch',
        error: `metadata.json masterFingerprint (${result.masterFingerprint}) does not match chain genesis masterFingerprint (${walkResult.masterFingerprint})`,
      });
    }

    // Cross-validate sigchainHeadCID between metadata and chain tip
    if (
      result.sigchainHeadCID &&
      walkResult.sigchainHeadCID &&
      result.sigchainHeadCID !== walkResult.sigchainHeadCID
    ) {
      chainErrors.push({
        type: 'head-cid-mismatch',
        error: `metadata.json sigchainHeadCID (${result.sigchainHeadCID}) does not match computed chain tip CID (${walkResult.sigchainHeadCID})`,
      });
    }

    result.leafSet = walkResult.leafSet || [];
    if (chainErrors.length > 0) {
      result.chainErrors = chainErrors;
    }
  }

  return result;
}
