// Phase 0 tests — bond type validator (VESTA-SPEC-134 §6.5.1)
// Tests: bond validator accepts sharedKnowledgeToken shape;
//        feature registry returns expected gates for mock profile_quality

// ── Helpers ────────────────────────────────────────────────────────────────────

function validSKTBond(overrides = {}) {
  return Object.assign({
    type: 'sharedKnowledgeToken',
    from: 'alice (alice@kingofalldata.com)',
    to: 'kingdom (kingofalldata.com)',
    status: 'active',
    scope: 'memory-kek-v1',
    attachment: 'base64urlEncryptedKEKBlobHere',
    metadata: {
      user_specific_salt: 'randomSaltBase64url==',
      key_version: 1,
      surfaces: ['memory', 'breadcrumb'],
      established_at: '2026-04-20T17:18:41Z',
      expires_at: null,
    },
  }, overrides);
}

function validMABond(overrides = {}) {
  return Object.assign({
    type: 'memory-access',
    from: 'alice (alice@kingofalldata.com)',
    to: 'kingdom (kingofalldata.com)',
    status: 'active',
    scope: 'memory-access',
    metadata: {
      harness_type: 'local-claude-code',
      surfaces: ['memory'],
      granted_at: '2026-04-20T17:18:41Z',
      expires_at: null,
    },
  }, overrides);
}

// ── sharedKnowledgeToken validation tests ─────────────────────────────────────

Tinytest.add('bond-types: sharedKnowledgeToken — valid bond passes', function (test) {
  const result = KoadHarnessBondTypes.validate(validSKTBond());
  test.equal(result.valid, true, 'valid SKT bond should pass');
  test.equal(result.errors.length, 0, 'no errors for valid bond');
});

Tinytest.add('bond-types: sharedKnowledgeToken — rejects missing attachment', function (test) {
  const bond = validSKTBond();
  delete bond.attachment;
  const result = KoadHarnessBondTypes.validate(bond);
  test.equal(result.valid, false);
  test.isTrue(result.errors.some(e => e.includes('attachment')), 'should mention attachment');
});

Tinytest.add('bond-types: sharedKnowledgeToken — rejects invalid scope format', function (test) {
  const bond = validSKTBond({ scope: 'wrong-scope' });
  const result = KoadHarnessBondTypes.validate(bond);
  test.equal(result.valid, false);
  test.isTrue(result.errors.some(e => e.includes('scope')));
});

Tinytest.add('bond-types: sharedKnowledgeToken — rejects scope without version number', function (test) {
  const bond = validSKTBond({ scope: 'memory-kek-vX' });
  const result = KoadHarnessBondTypes.validate(bond);
  test.equal(result.valid, false);
  test.isTrue(result.errors.some(e => e.includes('scope')));
});

Tinytest.add('bond-types: sharedKnowledgeToken — accepts higher key version', function (test) {
  const bond = validSKTBond({ scope: 'memory-kek-v42' });
  bond.metadata.key_version = 42;
  const result = KoadHarnessBondTypes.validate(bond);
  test.equal(result.valid, true);
});

Tinytest.add('bond-types: sharedKnowledgeToken — rejects key_version = 0', function (test) {
  const bond = validSKTBond();
  bond.metadata.key_version = 0;
  const result = KoadHarnessBondTypes.validate(bond);
  test.equal(result.valid, false);
  test.isTrue(result.errors.some(e => e.includes('key_version')));
});

Tinytest.add('bond-types: sharedKnowledgeToken — rejects non-integer key_version', function (test) {
  const bond = validSKTBond();
  bond.metadata.key_version = 1.5;
  const result = KoadHarnessBondTypes.validate(bond);
  test.equal(result.valid, false);
  test.isTrue(result.errors.some(e => e.includes('key_version')));
});

Tinytest.add('bond-types: sharedKnowledgeToken — rejects empty surfaces array', function (test) {
  const bond = validSKTBond();
  bond.metadata.surfaces = [];
  const result = KoadHarnessBondTypes.validate(bond);
  test.equal(result.valid, false);
  test.isTrue(result.errors.some(e => e.includes('surfaces')));
});

Tinytest.add('bond-types: sharedKnowledgeToken — rejects missing established_at', function (test) {
  const bond = validSKTBond();
  delete bond.metadata.established_at;
  const result = KoadHarnessBondTypes.validate(bond);
  test.equal(result.valid, false);
  test.isTrue(result.errors.some(e => e.includes('established_at')));
});

Tinytest.add('bond-types: sharedKnowledgeToken — rejects missing metadata', function (test) {
  const bond = validSKTBond();
  delete bond.metadata;
  const result = KoadHarnessBondTypes.validate(bond);
  test.equal(result.valid, false);
  test.isTrue(result.errors.some(e => e.includes('metadata')));
});

Tinytest.add('bond-types: sharedKnowledgeToken — rejects bad expires_at type', function (test) {
  const bond = validSKTBond();
  bond.metadata.expires_at = 12345; // should be null or ISO string
  const result = KoadHarnessBondTypes.validate(bond);
  test.equal(result.valid, false);
  test.isTrue(result.errors.some(e => e.includes('expires_at')));
});

Tinytest.add('bond-types: sharedKnowledgeToken — accepts expires_at as ISO string', function (test) {
  const bond = validSKTBond();
  bond.metadata.expires_at = '2027-04-20T00:00:00Z';
  const result = KoadHarnessBondTypes.validate(bond);
  test.equal(result.valid, true);
});

// ── memory-access bond tests ──────────────────────────────────────────────────

Tinytest.add('bond-types: memory-access — valid bond passes', function (test) {
  const result = KoadHarnessBondTypes.validate(validMABond());
  test.equal(result.valid, true);
  test.equal(result.errors.length, 0);
});

Tinytest.add('bond-types: memory-access — rejects invalid harness_type', function (test) {
  const bond = validMABond();
  bond.metadata.harness_type = 'web-browser'; // not a valid local harness type
  const result = KoadHarnessBondTypes.validate(bond);
  test.equal(result.valid, false);
  test.isTrue(result.errors.some(e => e.includes('harness_type')));
});

Tinytest.add('bond-types: memory-access — accepts all valid harness_types', function (test) {
  for (const ht of ['local-claude-code', 'local-opencode', 'other']) {
    const bond = validMABond();
    bond.metadata.harness_type = ht;
    const result = KoadHarnessBondTypes.validate(bond);
    test.equal(result.valid, true, `harness_type "${ht}" should be valid`);
  }
});

Tinytest.add('bond-types: memory-access — rejects missing granted_at', function (test) {
  const bond = validMABond();
  delete bond.metadata.granted_at;
  const result = KoadHarnessBondTypes.validate(bond);
  test.equal(result.valid, false);
  test.isTrue(result.errors.some(e => e.includes('granted_at')));
});

// ── General registry tests ────────────────────────────────────────────────────

Tinytest.add('bond-types: isKnownScope returns true for registered types', function (test) {
  test.equal(KoadHarnessBondTypes.isKnownScope('sharedKnowledgeToken'), true);
  test.equal(KoadHarnessBondTypes.isKnownScope('memory-access'), true);
  test.equal(KoadHarnessBondTypes.isKnownScope('authorized-agent'), true);
});

Tinytest.add('bond-types: isKnownScope returns false for unknown types', function (test) {
  test.equal(KoadHarnessBondTypes.isKnownScope('unknown-type'), false);
  test.equal(KoadHarnessBondTypes.isKnownScope(''), false);
  test.equal(KoadHarnessBondTypes.isKnownScope('SHAREDKNOWLEDGETOKEN'), false);
});

Tinytest.add('bond-types: validate rejects null/non-object input', function (test) {
  test.equal(KoadHarnessBondTypes.validate(null).valid, false);
  test.equal(KoadHarnessBondTypes.validate(undefined).valid, false);
  test.equal(KoadHarnessBondTypes.validate('string').valid, false);
  test.equal(KoadHarnessBondTypes.validate(42).valid, false);
});

Tinytest.add('bond-types: validate rejects missing type field', function (test) {
  const result = KoadHarnessBondTypes.validate({ scope: 'foo' });
  test.equal(result.valid, false);
  test.isTrue(result.errors.some(e => e.includes('type')));
});

Tinytest.add('bond-types: validate rejects unknown bond type', function (test) {
  const result = KoadHarnessBondTypes.validate({ type: 'nonexistent' });
  test.equal(result.valid, false);
  test.isTrue(result.errors.some(e => e.includes('unknown bond type')));
});

// ── Feature registry gate tests (SPEC-134 §7) ─────────────────────────────────
// These test the expected profile_quality gate semantics directly against the
// SPEC-134 §7 feature capability matrix, using inline evaluation logic.
// The full runtime evaluator integration is in kingofalldata.com's test suite.

const MEMORY_FEATURES = {
  'memory.capture':     'basic',
  'memory.sync':        'full',
  'memory.export':      'basic',
  'memory.delete':      'basic',
  'memory.consolidate': 'full',
  'memory.forget':      'full',
};

const QUALITY_RANK = { none: 0, basic: 1, full: 2 };

function gateAllows(featureKey, profile_quality) {
  const required = MEMORY_FEATURES[featureKey];
  return QUALITY_RANK[profile_quality] >= QUALITY_RANK[required];
}

Tinytest.add('memory-features: profile_quality=none blocks all 6 features', function (test) {
  for (const key of Object.keys(MEMORY_FEATURES)) {
    test.equal(gateAllows(key, 'none'), false, `${key} should be blocked at none`);
  }
});

Tinytest.add('memory-features: profile_quality=basic allows capture/export/delete, blocks sync/consolidate/forget', function (test) {
  test.equal(gateAllows('memory.capture',     'basic'), true);
  test.equal(gateAllows('memory.export',      'basic'), true);
  test.equal(gateAllows('memory.delete',      'basic'), true);
  test.equal(gateAllows('memory.sync',        'basic'), false);
  test.equal(gateAllows('memory.consolidate', 'basic'), false);
  test.equal(gateAllows('memory.forget',      'basic'), false);
});

Tinytest.add('memory-features: profile_quality=full allows all 6 features', function (test) {
  for (const key of Object.keys(MEMORY_FEATURES)) {
    test.equal(gateAllows(key, 'full'), true, `${key} should be allowed at full`);
  }
});
