#!/usr/bin/env node
// Bond type tests extracted for Node-runnable execution
// Run: node test/bond-types-node-test.js
// These tests mirror the Tinytest suite in bond-types-test.js

'use strict';

// Inline the bond registry (same logic as bond-types.js but without Meteor module system)
const BOND_SCOPE_REGISTRY = {
  'authorized-agent':       { required_fields: ['scope'], optional_fields: ['expires_at'] },
  'authorized-builder':     { required_fields: ['scope'], optional_fields: ['expires_at'] },
  'peer':                   { required_fields: ['scope'], optional_fields: [] },
  'sponsor':                { required_fields: [], optional_fields: ['tier', 'expires_at'] },
  'custodian':              { required_fields: ['scope'], optional_fields: ['expires_at'] },
  'sharedKnowledgeToken': {
    required_fields: ['scope', 'attachment', 'metadata'],
    validate(bond) {
      const errors = [];
      if (!bond.scope || !/^memory-kek-v\d+$/.test(bond.scope)) {
        errors.push(`scope must be "memory-kek-v<integer>", got: ${bond.scope}`);
      }
      if (!bond.attachment || typeof bond.attachment !== 'string' || !bond.attachment.trim()) {
        errors.push('attachment must be a non-empty base64url string');
      }
      if (!bond.metadata || typeof bond.metadata !== 'object') {
        errors.push('metadata must be an object');
      } else {
        const m = bond.metadata;
        if (!m.user_specific_salt || typeof m.user_specific_salt !== 'string') errors.push('metadata.user_specific_salt required');
        if (typeof m.key_version !== 'number' || !Number.isInteger(m.key_version) || m.key_version < 1) errors.push('metadata.key_version must be positive integer');
        if (!Array.isArray(m.surfaces) || m.surfaces.length === 0) errors.push('metadata.surfaces must be non-empty array');
        if (!m.established_at || typeof m.established_at !== 'string') errors.push('metadata.established_at required');
        if (m.expires_at !== undefined && m.expires_at !== null && typeof m.expires_at !== 'string') errors.push('metadata.expires_at must be null or ISO string');
      }
      return errors;
    },
  },
  'memory-access': {
    required_fields: ['scope', 'metadata'],
    validate(bond) {
      const errors = [];
      const VALID_HARNESS_TYPES = ['local-claude-code', 'local-opencode', 'other'];
      if (!bond.metadata || typeof bond.metadata !== 'object') {
        errors.push('metadata must be an object');
      } else {
        const m = bond.metadata;
        if (!m.harness_type || !VALID_HARNESS_TYPES.includes(m.harness_type)) errors.push(`metadata.harness_type must be one of: ${VALID_HARNESS_TYPES.join(', ')}`);
        if (!Array.isArray(m.surfaces) || m.surfaces.length === 0) errors.push('metadata.surfaces must be non-empty array');
        if (!m.granted_at || typeof m.granted_at !== 'string') errors.push('metadata.granted_at required');
      }
      return errors;
    },
  },
};

const KoadHarnessBondTypes = {
  SCOPES: BOND_SCOPE_REGISTRY,
  isKnownScope(scope) { return Object.prototype.hasOwnProperty.call(BOND_SCOPE_REGISTRY, scope); },
  validate(bond) {
    if (!bond || typeof bond !== 'object') return { valid: false, errors: ['bond must be an object'] };
    const typeKey = bond.type || bond.bond_type;
    if (!typeKey) return { valid: false, errors: ['bond.type is required'] };
    const entry = BOND_SCOPE_REGISTRY[typeKey];
    if (!entry) return { valid: false, errors: [`unknown bond type: "${typeKey}"`] };
    const errors = [];
    for (const field of (entry.required_fields || [])) {
      if (bond[field] === undefined || bond[field] === null) errors.push(`required field "${field}" is missing`);
    }
    if (typeof entry.validate === 'function') errors.push(...entry.validate(bond));
    return { valid: errors.length === 0, errors };
  },
};

let passed = 0; let failed = 0;

function assert(label, cond, detail) {
  if (cond) { console.log(`  PASS  ${label}`); passed++; }
  else { console.error(`  FAIL  ${label}${detail ? ': ' + detail : ''}`); failed++; }
}

function validSKT(overrides = {}) {
  return Object.assign({
    type: 'sharedKnowledgeToken',
    scope: 'memory-kek-v1',
    attachment: 'base64urlEncryptedKEKBlobHere',
    metadata: { user_specific_salt: 'salt==', key_version: 1, surfaces: ['memory'], established_at: '2026-04-20T17:00:00Z', expires_at: null },
  }, overrides);
}

function validMA(overrides = {}) {
  return Object.assign({
    type: 'memory-access',
    scope: 'memory-access',
    metadata: { harness_type: 'local-claude-code', surfaces: ['memory'], granted_at: '2026-04-20T17:00:00Z' },
  }, overrides);
}

console.log('\nBond type validator tests');

// sharedKnowledgeToken valid
assert('SKT valid bond passes', KoadHarnessBondTypes.validate(validSKT()).valid === true);
assert('SKT missing attachment fails', KoadHarnessBondTypes.validate(Object.assign(validSKT(), { attachment: undefined })).valid === false);
assert('SKT bad scope fails', KoadHarnessBondTypes.validate(validSKT({ scope: 'wrong' })).valid === false);
assert('SKT scope without number fails', KoadHarnessBondTypes.validate(validSKT({ scope: 'memory-kek-vX' })).valid === false);
assert('SKT version 42 passes', (() => { const b = validSKT({ scope: 'memory-kek-v42' }); b.metadata.key_version = 42; return KoadHarnessBondTypes.validate(b).valid === true; })());
assert('SKT key_version=0 fails', (() => { const b = validSKT(); b.metadata.key_version = 0; return KoadHarnessBondTypes.validate(b).valid === false; })());
assert('SKT key_version=1.5 fails', (() => { const b = validSKT(); b.metadata.key_version = 1.5; return KoadHarnessBondTypes.validate(b).valid === false; })());
assert('SKT empty surfaces fails', (() => { const b = validSKT(); b.metadata.surfaces = []; return KoadHarnessBondTypes.validate(b).valid === false; })());
assert('SKT missing established_at fails', (() => { const b = validSKT(); delete b.metadata.established_at; return KoadHarnessBondTypes.validate(b).valid === false; })());
assert('SKT missing metadata fails', (() => { const b = validSKT(); delete b.metadata; return KoadHarnessBondTypes.validate(b).valid === false; })());
assert('SKT numeric expires_at fails', (() => { const b = validSKT(); b.metadata.expires_at = 12345; return KoadHarnessBondTypes.validate(b).valid === false; })());
assert('SKT string expires_at passes', (() => { const b = validSKT(); b.metadata.expires_at = '2027-04-20T00:00:00Z'; return KoadHarnessBondTypes.validate(b).valid === true; })());

// memory-access
assert('MA valid bond passes', KoadHarnessBondTypes.validate(validMA()).valid === true);
assert('MA invalid harness_type fails', (() => { const b = validMA(); b.metadata.harness_type = 'web'; return KoadHarnessBondTypes.validate(b).valid === false; })());
['local-claude-code', 'local-opencode', 'other'].forEach(ht => {
  assert(`MA harness_type "${ht}" passes`, (() => { const b = validMA(); b.metadata.harness_type = ht; return KoadHarnessBondTypes.validate(b).valid === true; })());
});
assert('MA missing granted_at fails', (() => { const b = validMA(); delete b.metadata.granted_at; return KoadHarnessBondTypes.validate(b).valid === false; })());

// General registry
assert('isKnownScope(sharedKnowledgeToken)', KoadHarnessBondTypes.isKnownScope('sharedKnowledgeToken'));
assert('isKnownScope(memory-access)', KoadHarnessBondTypes.isKnownScope('memory-access'));
assert('isKnownScope(authorized-agent)', KoadHarnessBondTypes.isKnownScope('authorized-agent'));
assert('isKnownScope(unknown) false', !KoadHarnessBondTypes.isKnownScope('unknown'));
assert('validate(null) fails', !KoadHarnessBondTypes.validate(null).valid);
assert('validate(no type) fails', !KoadHarnessBondTypes.validate({ scope: 'foo' }).valid);
assert('validate(bad type) fails', !KoadHarnessBondTypes.validate({ type: 'nonexistent' }).valid);

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
