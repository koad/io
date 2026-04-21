// auth.js — session authentication and bond-gated scope resolution
// VESTA-SPEC-139 §5
//
// Authentication: Bearer token = harness session ID from HarnessSessions collection.
// Authority profile: bond type → scope sets per §5.2.
// No cryptographic bond verification (deferred to OQ-2).

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Bond type → authority scope mapping (VESTA-SPEC-139 §5.2)
// ---------------------------------------------------------------------------

const BOND_SCOPES = {
  'authorized-agent':     ['read.all', 'write.all'],
  'authorized-builder':   ['read.all', 'write.emissions.own', 'write.flights.own'],
  'authorized-specialist':['read.own', 'write.emissions.own', 'read.kingdom.summary'],
  'peer':                 ['read.own', 'read.kingdom.summary'],
  'community-member':     ['read.kingdom.summary'],
  'kingdom-peer':         ['read.kingdom.summary'],
};

// Scope check helpers
function hasScope(scopes, required) {
  if (!scopes || !Array.isArray(scopes)) return false;
  return scopes.includes(required);
}

function hasAnyScope(scopes, ...required) {
  return required.some(s => hasScope(scopes, s));
}

// ---------------------------------------------------------------------------
// Bond type detection from BondsIndex
//
// BondsIndex stores: { handle, bonds: [{ filename, type, base }], ... }
// The bond file base is typically "issuer-to-entity-bond_type.md"
// We also read the bond file content to extract the Type field.
// ---------------------------------------------------------------------------

const BondsRef = new Mongo.Collection('BondsIndex', { connection: null });

// Parse bond type from file content — looks for "**Type:** <bond-type>" line
// or "type: <bond-type>" in frontmatter.
function parseBondTypeFromFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    // PGP-signed format: look in signed message body
    const typeMatch = content.match(/\*\*Type:\*\*\s*([a-z0-9-]+)/i);
    if (typeMatch) return typeMatch[1].toLowerCase();
    // YAML frontmatter format
    const yamlMatch = content.match(/^type:\s*([a-z0-9-]+)/im);
    if (yamlMatch) return yamlMatch[1].toLowerCase();
  } catch (e) { /* file unreadable */ }
  return null;
}

// Priority order for bond authority (highest first)
const BOND_PRIORITY = [
  'authorized-agent',
  'authorized-builder',
  'authorized-specialist',
  'peer',
  'community-member',
  'kingdom-peer',
];

// Extract bond type for an entity.
// Primary: BondsIndex (if indexed).
// Fallback: direct disk scan of ~/.<entity>/trust/bonds/ (when indexer not running).
function resolveBondType(entityHandle) {
  const homePath = process.env.HOME || '/home/koad';
  const entityPath = path.join(homePath, `.${entityHandle}`);
  const bondsDir = path.join(entityPath, 'trust', 'bonds');

  let bestType = null;
  let bestPriority = Infinity;

  // Primary: use BondsIndex if it has records for this entity
  const record = BondsRef.findOne({ handle: entityHandle });
  if (record && record.bonds && record.bonds.length > 0) {
    for (const bond of record.bonds) {
      const filePath = path.join(bondsDir, bond.filename);
      const bondType = parseBondTypeFromFile(filePath);
      if (!bondType) continue;
      const priority = BOND_PRIORITY.indexOf(bondType);
      if (priority !== -1 && priority < bestPriority) {
        bestPriority = priority;
        bestType = bondType;
      }
    }
    if (bestType) return bestType;
  }

  // Fallback: scan trust/bonds/ directly (BondsIndex not populated)
  try {
    const files = fs.readdirSync(bondsDir);
    for (const filename of files) {
      if (filename.startsWith('.')) continue;
      const filePath = path.join(bondsDir, filename);
      const bondType = parseBondTypeFromFile(filePath);
      if (!bondType) continue;
      const priority = BOND_PRIORITY.indexOf(bondType);
      if (priority !== -1 && priority < bestPriority) {
        bestPriority = priority;
        bestType = bondType;
      }
    }
  } catch (e) {
    // No bonds dir or unreadable — entity has no bonds
  }

  return bestType;
}

// ---------------------------------------------------------------------------
// Session authentication (VESTA-SPEC-139 §5.1)
// ---------------------------------------------------------------------------

// Authenticate a bearer token. Returns an authority profile or null on failure.
//
// profile = { entity, bond_type, scopes }
function authenticateSession(token) {
  if (!token || typeof token !== 'string') return null;

  const Sessions = globalThis.SessionsCollection;
  if (!Sessions) {
    console.warn('[mcp-service:auth] SessionsCollection not available');
    return null;
  }

  // Look up the session by _id (token is the session document _id)
  const session = Sessions.findOne({ _id: token, status: 'active' });
  if (!session) {
    // Also try by sessionToken field if the collection uses a dedicated field
    const byToken = Sessions.findOne({ sessionToken: token, status: 'active' });
    if (!byToken) return null;
    return buildProfile(byToken.entity);
  }

  return buildProfile(session.entity);
}

function buildProfile(entity) {
  if (!entity) return null;

  const bondType = resolveBondType(entity);
  if (!bondType) {
    // No bond record — entity not in trust graph, reject
    return null;
  }

  const scopes = BOND_SCOPES[bondType] || null;
  if (!scopes) {
    // Unrecognized bond type — reject
    return null;
  }

  return {
    entity,
    bond_type: bondType,
    scopes,
  };
}

// ---------------------------------------------------------------------------
// Per-tool scope enforcement helpers
// ---------------------------------------------------------------------------

// Check read access: own-entity reads, kingdom-wide reads.
// entity param = the entity being queried (may differ from caller).
// callerProfile = { entity, scopes }
function checkReadAccess(callerProfile, targetEntity, requireAll) {
  const { entity: callerEntity, scopes } = callerProfile;

  if (requireAll) {
    // Requires read.all
    if (!hasScope(scopes, 'read.all')) {
      return { ok: false, error: 'SCOPE_INSUFFICIENT', message: 'read.all scope required' };
    }
  } else if (targetEntity && targetEntity !== callerEntity) {
    // Querying another entity's data
    if (!hasScope(scopes, 'read.all')) {
      return { ok: false, error: 'SCOPE_INSUFFICIENT', message: 'read.all scope required to query another entity' };
    }
  } else {
    // Own entity: needs read.own or read.all
    if (!hasAnyScope(scopes, 'read.own', 'read.all')) {
      return { ok: false, error: 'SCOPE_INSUFFICIENT', message: 'read.own or read.all scope required' };
    }
  }

  return { ok: true };
}

// Check write access for emissions (write.emissions.own or write.all).
// targetEntity = the entity the emission will be written for.
function checkEmissionWrite(callerProfile, targetEntity) {
  const { entity: callerEntity, scopes } = callerProfile;

  if (targetEntity && targetEntity !== callerEntity) {
    if (!hasScope(scopes, 'write.all')) {
      return { ok: false, error: 'SCOPE_INSUFFICIENT', message: 'write.all scope required to act for another entity' };
    }
  } else {
    if (!hasAnyScope(scopes, 'write.emissions.own', 'write.all')) {
      return { ok: false, error: 'SCOPE_INSUFFICIENT', message: 'write.emissions.own or write.all scope required' };
    }
  }

  return { ok: true };
}

// Check write access for flights.
function checkFlightWrite(callerProfile, targetEntity) {
  const { entity: callerEntity, scopes } = callerProfile;

  if (targetEntity && targetEntity !== callerEntity) {
    if (!hasScope(scopes, 'write.all')) {
      return { ok: false, error: 'SCOPE_INSUFFICIENT', message: 'write.all scope required to act for another entity' };
    }
  } else {
    if (!hasAnyScope(scopes, 'write.flights.own', 'write.all')) {
      return { ok: false, error: 'SCOPE_INSUFFICIENT', message: 'write.flights.own or write.all scope required' };
    }
  }

  return { ok: true };
}

// Check kingdom summary read access.
function checkKingdomSummaryRead(callerProfile) {
  const { scopes } = callerProfile;
  if (!hasAnyScope(scopes, 'read.kingdom.summary', 'read.own', 'read.all')) {
    return { ok: false, error: 'SCOPE_INSUFFICIENT', message: 'read.kingdom.summary scope required' };
  }
  return { ok: true };
}

// Check session read: full records require read.all; count-only requires read.kingdom.summary.
function checkSessionRead(callerProfile, targetEntity, fullRecords) {
  const { entity: callerEntity, scopes } = callerProfile;

  if (fullRecords) {
    if (targetEntity && targetEntity !== callerEntity) {
      if (!hasScope(scopes, 'read.all')) {
        return { ok: false, error: 'SCOPE_INSUFFICIENT', message: 'read.all scope required for full session records of another entity' };
      }
    } else if (!hasAnyScope(scopes, 'read.all', 'read.own')) {
      return { ok: false, error: 'SCOPE_INSUFFICIENT', message: 'read.own or read.all scope required' };
    }
  } else {
    if (!hasAnyScope(scopes, 'read.kingdom.summary', 'read.own', 'read.all')) {
      return { ok: false, error: 'SCOPE_INSUFFICIENT', message: 'read.kingdom.summary scope required' };
    }
  }

  return { ok: true };
}

// Export
globalThis.McpServiceAuth = {
  authenticateSession,
  buildProfile,
  checkReadAccess,
  checkEmissionWrite,
  checkFlightWrite,
  checkKingdomSummaryRead,
  checkSessionRead,
  hasScope,
  hasAnyScope,
  BOND_SCOPES,
};
