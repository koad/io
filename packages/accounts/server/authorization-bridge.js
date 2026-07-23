// authorization-bridge.js — Sovereign authorization helpers (VESTA-SPEC-185 v2.0 §6)
//
// Implements the sovereign authorization primitives that replace Meteor.roles
// lookups for fingerprint-authenticated sessions:
//
//   authorizeByBond(fingerprint, requiredBondTypes, resourceScope)
//     → Authorize a fingerprint by checking trust bonds
//
//   authorizeByCID(callerCid, resourceAcl, requiredRole)
//     → Authorize by checking CID-based ACL
//
//   authorizeSession(session, requiredBondTypes, resourceScope)
//     → Dual-path authorization: sovereign (bond) or portal (Meteor.roles)
//
// These helpers consume koad.indexes.fingerprints and koad.indexes.bonds.
// They NEVER touch Meteor.users for sovereign sessions.
//
// VESTA-SPEC-185 v2.0 §6.2: Bond types and their authorization levels
//   authorized-agent  → Full (admin-level)
//   authorized-builder → Write (modify but not administer)
//   authorized-specialist → Scoped (specific defined surfaces)
//   peer              → Mutual read (shared resources)
//   member            → Basic (read, some write scoped to self)
//   family            → Varies (per-entity)
//   friend            → Limited (specific shared resources)
//   employee          → Scoped (defined by employer)

const fs = require('fs');
const path = require('path');

const HOME_DIR = process.env.HOME || '';

// ---------------------------------------------------------------------------
// authorizeByBond — Check trust bonds for a given fingerprint
// ---------------------------------------------------------------------------

/**
 * Authorize a fingerprint by checking trust bonds.
 * 
 * @param {string} fingerprint - 40-char hex fingerprint
 * @param {string[]} requiredBondTypes - Bond types that satisfy this authorization
 *   (e.g. ['authorized-agent'], ['authorized-agent', 'authorized-builder'])
 * @param {string} [resourceScope] - Optional scope restriction to check
 * @returns {Promise<{authorized: boolean, principal?: object, bond?: object}>}
 * @throws {Meteor.Error} if fingerprint is unknown or not authorized
 */
async function authorizeByBond(fingerprint, requiredBondTypes, resourceScope) {
  if (!fingerprint || typeof fingerprint !== 'string') {
    throw new Meteor.Error('invalid-fingerprint', 'fingerprint is required');
  }

  // 1. Resolve principal from fingerprint
  const index = koad.indexes.fingerprints || globalThis.FingerprintEntityIndex;
  const principal = index && typeof index.lookup === 'function'
    ? index.lookup(fingerprint)
    : null;

  if (!principal) {
    throw new Meteor.Error('unauthorized', 'Unknown fingerprint — no entity/device indexed for this key');
  }

  // 2. Read trust bonds — prefer koad.indexes.bonds if available, otherwise scan filesystem
  let bonds = [];
  if (koad.indexes.bonds && typeof koad.indexes.bonds.bondsForPrincipal === 'function') {
    bonds = koad.indexes.bonds.bondsForPrincipal(fingerprint);
    // Also try by handle
    if (bonds.length === 0 && principal.handle) {
      bonds = koad.indexes.bonds.bondsForPrincipal(principal.handle);
    }
  } else {
    // Fallback: scan bond directory on disk
    bonds = await scanBondsForPrincipal(principal.basedir, principal.handle);
  }

  // 3. Check if any bond grants the required authorization level
  const matchedBond = bonds.find(bond =>
    requiredBondTypes.includes(bond.bondType) &&
    bond.signatureValid !== false &&
    (!resourceScope || scopeIncludes(bond.scope, resourceScope))
  );

  if (!matchedBond) {
    throw new Meteor.Error('unauthorized',
      `Insufficient bond authorization — requires one of: ${requiredBondTypes.join(', ')}`
    );
  }

  return {
    authorized: true,
    principal,
    bond: matchedBond,
  };
}

// ---------------------------------------------------------------------------
// authorizeByCID — Check CID-based ACL
// ---------------------------------------------------------------------------

/**
 * Authorize by checking if a caller's CID appears in a resource ACL.
 * 
 * @param {string} callerCid - 17-char CID from koad.generate.cid(handle)
 * @param {Array<{cid: string, role: string}>} resourceAcl - ACL entries
 * @param {string} requiredRole - Minimum role required (admin, contributor, etc.)
 * @returns {{authorized: boolean}}
 * @throws {Meteor.Error} if caller not in ACL or role insufficient
 */
function authorizeByCID(callerCid, resourceAcl, requiredRole) {
  if (!callerCid || !Array.isArray(resourceAcl)) {
    throw new Meteor.Error('invalid-input', 'callerCid and resourceAcl are required');
  }

  const entry = resourceAcl.find(a => a.cid === callerCid);
  if (!entry) {
    throw new Meteor.Error('unauthorized', 'Not in contributors list for this resource');
  }

  if (!roleSatisfies(entry.role, requiredRole)) {
    throw new Meteor.Error('unauthorized',
      `Insufficient role — has "${entry.role}", requires "${requiredRole}"`
    );
  }

  return { authorized: true };
}

// ---------------------------------------------------------------------------
// authorizeSession — Dual-path authorization
// ---------------------------------------------------------------------------

/**
 * Dual-path authorization: sovereign (bond check) or portal (Meteor.roles).
 * 
 * During migration (Phase 1–2), allows both paths. Sovereign path takes precedence.
 * 
 * @param {object} session - ApplicationSessions document (must have fingerprint and/or userId)
 * @param {string[]} requiredBondTypes - Bond types for sovereign authorization
 * @param {string} [resourceScope] - Optional scope for bond authorization
 * @returns {Promise<{authorized: boolean, path: string}>}
 * @throws {Meteor.Error} if not authorized via any path
 */
async function authorizeSession(session, requiredBondTypes, resourceScope) {
  if (!session) {
    throw new Meteor.Error('unauthorized', 'No session provided');
  }

  // Sovereign path — fingerprint-based authorization
  if (session.fingerprint) {
    try {
      const result = await authorizeByBond(session.fingerprint, requiredBondTypes, resourceScope);
      return { authorized: true, path: 'sovereign', ...result };
    } catch (bondErr) {
      // If sovereign path fails but portal path exists, fall through
      if (!session.userId) {
        throw bondErr; // No portal fallback — rethrow
      }
      log.debug(`[authorizeSession] sovereign path failed for ${session.fingerprint.slice(0, 8)}... falling back to portal`);
    }
  }

  // Portal path — Meteor.roles-based authorization (legacy compatibility)
  if (session.userId) {
    if (typeof Roles !== 'undefined' && Roles.userIsInRole) {
      const inRole = Roles.userIsInRole(session.userId, requiredBondTypes);
      if (inRole) {
        return { authorized: true, path: 'portal' };
      }
    }
    throw new Meteor.Error('unauthorized', 'Insufficient role for portal session');
  }

  // No identity at all
  throw new Meteor.Error('unauthorized', 'Session is not authenticated');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Scan a bond directory for trust bond files.
 * Returns structured BondRecord objects.
 * 
 * @param {string} basedir - Entity's home directory (e.g., '/home/koad/.vulcan')
 * @param {string} handle - Entity handle (e.g., 'vulcan')
 * @returns {Promise<Array>} BondRecord array
 */
async function scanBondsForPrincipal(basedir, handle) {
  const bondDir = path.join(basedir, 'trust', 'bonds');
  if (!fs.existsSync(bondDir)) return [];

  let files;
  try {
    files = fs.readdirSync(bondDir);
  } catch (_) {
    return [];
  }

  const results = [];
  for (const fileName of files) {
    if (!fileName.endsWith('.md') && !fileName.endsWith('.md.asc')) continue;

    const bondPath = path.join(bondDir, fileName);
    try {
      const content = fs.readFileSync(bondPath, 'utf8');
      const bondType = extractBondType(content, fileName);
      const { source, target } = parseBondFilenames(fileName);
      const validAt = extractDate(content);

      results.push({
        sourceHandle: source,
        targetHandle: target,
        bondType,
        bondPath,
        validAt: validAt || new Date(0),
        signatureValid: fileName.endsWith('.asc'), // .asc = clearsigned = verified at rest
        scope: extractScope(content),
      });
    } catch (_) {
      // Skip unreadable bond files
    }
  }

  return results;
}

/**
 * Extract bond type from frontmatter or filename fallback.
 */
function extractBondType(content, fileName) {
  const match = content.match(/^(?:bond_type|bondType|type):\s*["']?([^"'\n]+)["']?/m);
  if (match && match[1]) return match[1].trim();

  const base = path.basename(fileName).replace(/\.md(?:\.asc)?$/i, '');
  const known = base.match(/(authorized-agent|authorized-builder|authorized-specialist|peer|family|friend|employee|member|vendor|customer)/i);
  return known ? known[1].toLowerCase() : 'unknown';
}

/**
 * Parse source and target handles from bond filename (<source>-to-<target>.md.asc).
 */
function parseBondFilenames(fileName) {
  const base = path.basename(fileName).replace(/\.md(?:\.asc)?$/i, '');
  const parts = base.split('-to-');
  if (parts.length === 2) {
    return { source: parts[0], target: parts[1] };
  }
  return { source: 'unknown', target: 'unknown' };
}

/**
 * Extract date from bond content (validAt, created, or date field in frontmatter).
 */
function extractDate(content) {
  const match = content.match(/^(?:validAt|created|date):\s*["']?([^"'\n]+)["']?/m);
  if (match && match[1]) {
    const d = new Date(match[1].trim());
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/**
 * Extract scope from bond frontmatter.
 */
function extractScope(content) {
  const match = content.match(/^scope:\s*["']?([^"'\n]+)["']?/m);
  return match ? match[1].trim() : null;
}

/**
 * Check if a bond's scope includes a given resource scope.
 * Simple prefix match — can be extended to regex/glob.
 */
function scopeIncludes(bondScope, resourceScope) {
  if (!bondScope) return true; // No scope restriction = applies everywhere
  if (!resourceScope) return true;
  return resourceScope.startsWith(bondScope);
}

/**
 * Check if a role satisfies the required level.
 * Role hierarchy: admin > contributor > member > viewer
 */
function roleSatisfies(role, required) {
  const hierarchy = ['viewer', 'member', 'contributor', 'admin'];
  const roleIdx = hierarchy.indexOf(role);
  const requiredIdx = hierarchy.indexOf(required);
  if (roleIdx === -1 || requiredIdx === -1) return false;
  return roleIdx >= requiredIdx;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { authorizeByBond, authorizeByCID, authorizeSession, scanBondsForPrincipal };

log.success('loaded koad:io-accounts/authorization-bridge (VESTA-SPEC-185 v2.0 §6)');
