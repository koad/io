// Trust Bond Type Registry — VESTA-SPEC-055 scope vocabulary extension
// Registers bond types introduced by downstream specs.
//
// SPEC-134 §6.5 adds two entries:
//   sharedKnowledgeToken — KEK relationship between user and kingdom
//   memory-access         — peer bond scope for local-harness permission delegation
//
// Usage: KoadHarnessBondTypes.validate(bondDoc) → { valid, errors[] }
//        KoadHarnessBondTypes.isKnownScope(scope) → Boolean
//        KoadHarnessBondTypes.SCOPES — registry map

// ── Bond scope registry ────────────────────────────────────────────────────────
// Each entry: { description, required_fields[], optional_fields[] }

const BOND_SCOPE_REGISTRY = Object.freeze({
  // ── Core bond types (VESTA-SPEC-055 §5) ──────────────────────────────────────
  'authorized-agent': {
    description: 'Grants an entity full operational authority within a defined scope.',
    required_fields: ['scope'],
    optional_fields: ['expires_at'],
  },
  'authorized-builder': {
    description: 'Grants build authority within a codebase or system boundary.',
    required_fields: ['scope'],
    optional_fields: ['expires_at'],
  },
  'peer': {
    description: 'Recognizes a mutual peer relationship between two entities.',
    required_fields: ['scope'],
    optional_fields: [],
  },
  'sponsor': {
    description: 'Recognizes a sponsorship relationship (financial or contributory).',
    required_fields: [],
    optional_fields: ['tier', 'expires_at'],
  },
  'custodian': {
    description: 'Grants custodianship over an entity, resource, or data set.',
    required_fields: ['scope'],
    optional_fields: ['expires_at'],
  },

  // ── SPEC-134 §6.5.1 — sharedKnowledgeToken ───────────────────────────────────
  // Bond type for the KEK relationship between a user and the kingdom.
  // Issuer: user (the sponsor). Recipient: kingdom (kingofalldata.com).
  // The bond records the key relationship; it does not grant access permissions.
  // Access permissions are granted via the separate 'memory-access' scope.
  //
  // Required shape:
  //   scope:      "memory-kek-v{key_version}"  (e.g. "memory-kek-v1")
  //   attachment: encrypted_kek_blob (base64url, opaque to server)
  //   metadata:
  //     user_specific_salt: <base64url>
  //     key_version:        <integer ≥ 1>
  //     surfaces:           Array<String>  (e.g. ["memory", "breadcrumb"])
  //     established_at:     <ISO 8601>
  //     expires_at:         null | <ISO 8601>
  'sharedKnowledgeToken': {
    description: 'Records the KEK relationship between a user and the kingdom for encrypted memory. Scope is "memory-kek-v{key_version}". Attachment holds the server-side encrypted KEK blob. Bond is user-issued; kingdom is recipient.',
    required_fields: ['scope', 'attachment', 'metadata'],
    optional_fields: [],
    metadata_required: ['user_specific_salt', 'key_version', 'surfaces', 'established_at'],
    metadata_optional: ['expires_at'],
    validate(bond) {
      const errors = [];
      // scope must match "memory-kek-v<integer>"
      if (!bond.scope || !/^memory-kek-v\d+$/.test(bond.scope)) {
        errors.push(`scope must be "memory-kek-v<integer>", got: ${bond.scope}`);
      }
      // attachment must be a non-empty string (base64url-encoded encrypted blob)
      if (!bond.attachment || typeof bond.attachment !== 'string' || !bond.attachment.trim()) {
        errors.push('attachment must be a non-empty base64url string (the encrypted KEK blob)');
      }
      // metadata object
      if (!bond.metadata || typeof bond.metadata !== 'object') {
        errors.push('metadata must be an object');
      } else {
        const m = bond.metadata;
        if (!m.user_specific_salt || typeof m.user_specific_salt !== 'string') {
          errors.push('metadata.user_specific_salt must be a non-empty string (base64url)');
        }
        if (typeof m.key_version !== 'number' || !Number.isInteger(m.key_version) || m.key_version < 1) {
          errors.push('metadata.key_version must be a positive integer');
        }
        if (!Array.isArray(m.surfaces) || m.surfaces.length === 0) {
          errors.push('metadata.surfaces must be a non-empty array of surface strings');
        }
        if (!m.established_at || typeof m.established_at !== 'string') {
          errors.push('metadata.established_at must be an ISO 8601 string');
        }
        // expires_at optional — null or ISO 8601 string
        if (m.expires_at !== undefined && m.expires_at !== null && typeof m.expires_at !== 'string') {
          errors.push('metadata.expires_at must be null or an ISO 8601 string');
        }
      }
      return errors;
    },
  },

  // ── SPEC-134 §9.5 — memory-access (peer bond scope) ──────────────────────────
  // Permission bond for local-harness-to-kingdom permission delegation.
  // Grants a specific local harness the ability to read/write UserMemories for
  // the bonded user. Does not carry the KEK — that is separate (sharedKnowledgeToken).
  //
  // Required shape:
  //   scope:    "memory-access"
  //   metadata:
  //     harness_type:  "local-claude-code" | "local-opencode" | "other"
  //     surfaces:      Array<String>  (which surfaces this access covers)
  //     granted_at:    <ISO 8601>
  //     expires_at:    null | <ISO 8601>
  'memory-access': {
    description: 'Grants a local harness permission to read/write UserMemories for the bonded user. Scope is "memory-access". Does not carry key material — the KEK relationship is a separate sharedKnowledgeToken bond.',
    required_fields: ['scope', 'metadata'],
    optional_fields: [],
    metadata_required: ['harness_type', 'surfaces', 'granted_at'],
    metadata_optional: ['expires_at'],
    validate(bond) {
      const errors = [];
      const VALID_HARNESS_TYPES = ['local-claude-code', 'local-opencode', 'other'];
      if (!bond.metadata || typeof bond.metadata !== 'object') {
        errors.push('metadata must be an object');
      } else {
        const m = bond.metadata;
        if (!m.harness_type || !VALID_HARNESS_TYPES.includes(m.harness_type)) {
          errors.push(`metadata.harness_type must be one of: ${VALID_HARNESS_TYPES.join(', ')}`);
        }
        if (!Array.isArray(m.surfaces) || m.surfaces.length === 0) {
          errors.push('metadata.surfaces must be a non-empty array');
        }
        if (!m.granted_at || typeof m.granted_at !== 'string') {
          errors.push('metadata.granted_at must be an ISO 8601 string');
        }
      }
      return errors;
    },
  },
});

// ── Public API ─────────────────────────────────────────────────────────────────

const KoadHarnessBondTypes = {
  SCOPES: BOND_SCOPE_REGISTRY,

  // Returns true if the given bond type/scope string is registered.
  isKnownScope(scope) {
    return Object.prototype.hasOwnProperty.call(BOND_SCOPE_REGISTRY, scope);
  },

  // Validates a bond document against the registered type.
  // bond must have: { type, scope, attachment?, metadata? }
  // Returns { valid: Boolean, errors: String[] }
  validate(bond) {
    if (!bond || typeof bond !== 'object') {
      return { valid: false, errors: ['bond must be an object'] };
    }
    const typeKey = bond.type || bond.bond_type;
    if (!typeKey) {
      return { valid: false, errors: ['bond.type is required'] };
    }
    const entry = BOND_SCOPE_REGISTRY[typeKey];
    if (!entry) {
      return { valid: false, errors: [`unknown bond type: "${typeKey}"` ] };
    }

    const errors = [];

    // Check required_fields
    for (const field of (entry.required_fields || [])) {
      if (bond[field] === undefined || bond[field] === null) {
        errors.push(`required field "${field}" is missing`);
      }
    }

    // Run type-specific validator if present
    if (typeof entry.validate === 'function') {
      const typeErrors = entry.validate(bond);
      errors.push(...typeErrors);
    }

    return { valid: errors.length === 0, errors };
  },
};

// Expose globally for server-side callers without import overhead.
globalThis.KoadHarnessBondTypes = KoadHarnessBondTypes;

export { KoadHarnessBondTypes };
