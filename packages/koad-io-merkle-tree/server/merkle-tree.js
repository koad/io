// koad:io-merkle-tree — server/merkle-tree.js
//
// Kingdom Merkle Tree — VESTA-SPEC-169 v1.0
//
// Pure compute module. No state, no collections, no IPFS. Input → output.
//
// API surface:
//   KingdomMerkleTree.buildTree(leaves)                    → { root, levels, leafHashes }
//   KingdomMerkleTree.generateProof(leaves, leafIndex)     → { leaf, path }
//   KingdomMerkleTree.verifyProof(proof, root)             → boolean
//   KingdomMerkleTree.buildSkipMap(seqno, rootHistory)     → object
//   KingdomMerkleTree.signRoot(payload, privateKeyBytes)   → Promise<signedRoot>
//   KingdomMerkleTree.verifySignedRoot(signedRoot, pubKeyBytes) → Promise<boolean>
//   KingdomMerkleTree.validateLeaf(leaf)                   → void (throws on invalid)
//   KingdomMerkleTree.sortLeaves(leaves)                   → sorted array
//
// Hash conventions (SPEC-169 §5):
//   leaf_hash(leaf)    = sha2-256(0x00 || dag-json-canonical(leaf))
//   node_hash(L, R)    = sha2-256(0x01 || L || R)
//   Odd-count padding  = node_hash(last, last)
//
// Root format (SPEC-169 §6):
//   { schema, kingdom, seqno, root, leaf_count, timestamp, prev_root, skip, signature }
//
// Ed25519 signing uses @noble/ed25519 via the app-level Npm install.
// dag-json canonical encoding uses @ipld/dag-json.
// sha2-256 uses Node's built-in crypto — no multiformats dependency needed here;
// the hash is a raw 32-byte Buffer (encoded as lowercase hex in the signed root).

import { createHash } from 'crypto';

// ── dag-json canonical encoding ───────────────────────────────────────────────
//
// SPEC-169 §4.1 and §6.3 require deterministic JSON: keys sorted, no whitespace.
// We implement this inline rather than depending on @ipld/dag-json to keep the
// package dependency-light. This follows SPEC-111 §3.1 exactly.
//
// Note: dag-json full spec supports CID links and Bytes as special types.
// For our use case (string/number/object/null fields only), lexicographic
// key-sorted JSON encoding is identical to dag-json canonical form.

function dagJsonCanonical(obj) {
  // Recursively produce deterministic JSON: keys sorted, no whitespace.
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(dagJsonCanonical).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + dagJsonCanonical(obj[k]));
  return '{' + pairs.join(',') + '}';
}

function dagJsonCanonicalBytes(obj) {
  return Buffer.from(dagJsonCanonical(obj), 'utf8');
}

// ── SHA-256 helpers ───────────────────────────────────────────────────────────

function sha256(data) {
  return createHash('sha256').update(data).digest(); // Buffer (32 bytes)
}

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex'); // lowercase hex string
}

// ── Leaf domain separator constants (SPEC-169 §5.1, §5.2) ────────────────────

const LEAF_PREFIX   = Buffer.from([0x00]); // distinguishes leaf hash from node hash
const NODE_PREFIX   = Buffer.from([0x01]); // distinguishes internal node hash

// ── Leaf hashing (SPEC-169 §5.1) ─────────────────────────────────────────────
//
// leaf_hash(leaf) = sha2-256(0x00 || dag-json-canonical(leaf))

function hashLeaf(leaf) {
  const encoded = dagJsonCanonicalBytes(leaf);
  const input = Buffer.concat([LEAF_PREFIX, encoded]);
  return sha256(input); // Buffer
}

// ── Internal node hashing (SPEC-169 §5.2) ────────────────────────────────────
//
// node_hash(left, right) = sha2-256(0x01 || left || right)

function hashNode(left, right) {
  const input = Buffer.concat([NODE_PREFIX, left, right]);
  return sha256(input); // Buffer
}

// ── Leaf validation (SPEC-169 §3) ─────────────────────────────────────────────

const VALID_LEAF_TYPES = new Set(['entity', 'user', 'kingdom', 'witness']);

function validateLeaf(leaf) {
  if (!leaf || typeof leaf !== 'object') {
    throw new Error('Leaf must be a non-null object');
  }
  if (!VALID_LEAF_TYPES.has(leaf.type)) {
    throw new Error(`Unknown leaf type: "${leaf.type}". Must be entity, user, kingdom, or witness.`);
  }
  if (typeof leaf.id !== 'string' || !leaf.id) {
    throw new Error('Leaf.id must be a non-empty string');
  }
  if (typeof leaf.tip !== 'string' || !leaf.tip) {
    throw new Error('Leaf.tip must be a non-empty string (CID)');
  }
  if (typeof leaf.seq !== 'number' || !Number.isInteger(leaf.seq) || leaf.seq < 0) {
    throw new Error('Leaf.seq must be a non-negative integer');
  }
}

// ── Leaf sorting (SPEC-169 §4.1) ──────────────────────────────────────────────
//
// Sort by lexicographic order of their canonical JSON serialization.

function sortLeaves(leaves) {
  return [...leaves].sort((a, b) => {
    const aStr = dagJsonCanonical(a);
    const bStr = dagJsonCanonical(b);
    return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
  });
}

// ── Tree construction (SPEC-169 §5) ───────────────────────────────────────────
//
// Returns:
//   root       — Buffer (32 bytes)
//   levels     — array of levels, each an array of Buffers (bottom = level[0])
//   leafHashes — array of leaf hash Buffers (pre-sorted, same order as leaves input)

function buildTree(leaves) {
  if (!leaves || leaves.length === 0) {
    throw new Error('Cannot build merkle tree from empty leaf set (SPEC-169 §4.2)');
  }

  // Validate all leaves
  leaves.forEach(validateLeaf);

  // Sort leaves (SPEC-169 §4.1)
  const sorted = sortLeaves(leaves);

  // Compute leaf hashes (bottom level)
  const leafHashes = sorted.map(hashLeaf);

  const levels = [leafHashes];
  let current = leafHashes;

  // Build tree upward until a single root remains
  while (current.length > 1) {
    const nextLevel = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      // Odd-count padding: last node hashes with itself (SPEC-169 §5.3)
      const right = i + 1 < current.length ? current[i + 1] : current[i];
      nextLevel.push(hashNode(left, right));
    }
    levels.push(nextLevel);
    current = nextLevel;
  }

  return {
    root: current[0],       // Buffer
    levels,                 // array of levels, level[0] = leaf hashes
    leafHashes,             // leaf hashes in sorted order
    sortedLeaves: sorted,   // sorted leaves (useful for callers)
  };
}

// ── Inclusion proof generation (SPEC-169 §7.1) ───────────────────────────────
//
// path: array of { hash: Buffer, position: 'left'|'right' }
//   — sibling at each level, with position indicating which side the sibling is on
//
// The verifier reconstructs by combining:
//   If sibling is 'right': node_hash(current, sibling.hash)
//   If sibling is 'left':  node_hash(sibling.hash, current)

function generateProof(leaves, leafIndex) {
  if (!leaves || leaves.length === 0) {
    throw new Error('Cannot generate proof from empty leaf set');
  }

  // Sort leaves (must match tree construction order)
  const sorted = sortLeaves(leaves);

  if (leafIndex < 0 || leafIndex >= sorted.length) {
    throw new Error(`leafIndex ${leafIndex} out of range [0, ${sorted.length - 1}]`);
  }

  const { levels } = buildTree(sorted);

  const path = [];
  let currentIndex = leafIndex;

  // Walk up each level collecting sibling hashes
  for (let level = 0; level < levels.length - 1; level++) {
    const levelHashes = levels[level];
    let siblingIndex;
    let siblingPosition;

    if (currentIndex % 2 === 0) {
      // Current node is a left child — sibling is to the right
      siblingIndex = currentIndex + 1;
      siblingPosition = 'right';
      // Handle odd-count padding: if no right sibling exists, pad with self
      if (siblingIndex >= levelHashes.length) {
        siblingIndex = currentIndex;
      }
    } else {
      // Current node is a right child — sibling is to the left
      siblingIndex = currentIndex - 1;
      siblingPosition = 'left';
    }

    path.push({
      hash: levelHashes[siblingIndex],
      position: siblingPosition,
    });

    // Move up: parent index is floor(currentIndex / 2)
    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    leaf: sorted[leafIndex],    // the full leaf JSON object
    leafIndex,                  // index in sorted leaf array
    path,                       // array of { hash: Buffer, position: 'left'|'right' }
  };
}

// ── Inclusion proof verification (SPEC-169 §7.1) ─────────────────────────────
//
// proof: { leaf, path: [{ hash: Buffer, position: 'left'|'right' }] }
// root: Buffer or lowercase hex string

function verifyProof(proof, root) {
  if (!proof || !proof.leaf || !proof.path) {
    return false;
  }

  // Normalize root to Buffer
  const rootBuf = typeof root === 'string' ? Buffer.from(root, 'hex') : root;

  try {
    validateLeaf(proof.leaf);
  } catch (_) {
    return false;
  }

  let current = hashLeaf(proof.leaf);

  for (const step of proof.path) {
    const sibling = step.hash;
    if (step.position === 'right') {
      current = hashNode(current, sibling);
    } else {
      current = hashNode(sibling, current);
    }
  }

  return current.equals(rootBuf);
}

// ── Skip pointers (SPEC-169 §6.2) ─────────────────────────────────────────────
//
// rootHistory: Map<seqno (integer), rootHex (string)>
//   OR an object with integer keys
//
// Returns the skip map for the given seqno.
// Keys: string-encoded powers of 2 from 1 up to the largest power of 2 not exceeding seqno-1.
// Values: the root hex at seqno (current - k).
//
// Example: seqno=17, keys are "1","2","4","8","16"
//   "1"  → root at seqno 16
//   "2"  → root at seqno 15
//   "4"  → root at seqno 13
//   "8"  → root at seqno 9
//   "16" → root at seqno 1

function buildSkipMap(seqno, rootHistory) {
  if (seqno <= 1) return {};

  const skip = {};
  const lookup = typeof rootHistory.get === 'function'
    ? (n) => rootHistory.get(n)
    : (n) => rootHistory[n];

  // Powers of 2: k = 1, 2, 4, 8, ... while k <= seqno - 1
  for (let k = 1; k <= seqno - 1; k *= 2) {
    const targetSeqno = seqno - k;
    const rootAtTarget = lookup(targetSeqno);
    if (rootAtTarget !== undefined && rootAtTarget !== null) {
      skip[String(k)] = rootAtTarget;
    }
  }

  return skip;
}

// ── Root signing (SPEC-169 §6.3) ─────────────────────────────────────────────
//
// Builds and signs a complete signed root object.
//
// params:
//   {
//     kingdom:    string   — kingdom handle
//     seqno:      integer  — monotonically incrementing, starts at 1
//     root:       Buffer|string — 32-byte sha256 root hash
//     leaf_count: integer
//     timestamp:  string   — ISO 8601 UTC (default: now)
//     prev_root:  string|null — root hex from seqno-1 (null for seqno 1)
//     skip:       object   — skip pointer map from buildSkipMap()
//   }
// privateKeyBytes: Uint8Array (32 bytes, Ed25519 private key scalar)
//
// Returns: Promise<signedRootObject>

async function signRoot(params, privateKeyBytes) {
  const {
    kingdom,
    seqno,
    root,
    leaf_count,
    prev_root = null,
    skip = {},
  } = params;

  const timestamp = params.timestamp || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const rootHex = Buffer.isBuffer(root) ? root.toString('hex') : root;

  // Pre-image: dag-json canonical encoding of root object WITHOUT signature field.
  // Fields in lexicographic order (SPEC-169 §6.3):
  //   kingdom, leaf_count, prev_root, root, schema, seqno, skip, timestamp
  const preImage = {
    kingdom,
    leaf_count,
    prev_root,
    root: rootHex,
    schema: 'koad:io/kingdom-tree-root/v1',
    seqno,
    skip,
    timestamp,
  };

  const preImageBytes = dagJsonCanonicalBytes(preImage);

  // Sign with noble/ed25519
  // Lazy-require inside Meteor to avoid ESM resolution issues at package load time.
  // noble/ed25519 must be in the app's Npm.depends() or node_modules.
  let ed;
  try {
    ed = require('@noble/ed25519');
  } catch (_) {
    // Try globalThis.koad.deps.ed (wired by koad:io-core)
    if (globalThis.koad && globalThis.koad.deps && globalThis.koad.deps.ed) {
      ed = globalThis.koad.deps.ed;
    } else {
      throw new Error('[koad:io-merkle-tree] @noble/ed25519 not available. Add it to Npm.depends() or ensure koad:io-core is loaded first.');
    }
  }

  const signatureBytes = await ed.signAsync(preImageBytes, privateKeyBytes);
  // base64url encoding, RFC 4648 §5, no padding
  const signature = Buffer.from(signatureBytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return {
    schema: 'koad:io/kingdom-tree-root/v1',
    kingdom,
    seqno,
    root: rootHex,
    leaf_count,
    timestamp,
    prev_root,
    skip,
    signature,
  };
}

// ── Signed root verification (SPEC-169 §6.3) ─────────────────────────────────
//
// signedRoot: the signed root object (as produced by signRoot)
// pubKeyBytes: Uint8Array (32 bytes, Ed25519 public key)
//
// Returns: Promise<boolean>

async function verifySignedRoot(signedRoot, pubKeyBytes) {
  if (!signedRoot || typeof signedRoot !== 'object') return false;
  if (signedRoot.schema !== 'koad:io/kingdom-tree-root/v1') return false;
  if (typeof signedRoot.signature !== 'string') return false;

  // Reconstruct pre-image (without signature field)
  const preImage = {
    kingdom:    signedRoot.kingdom,
    leaf_count: signedRoot.leaf_count,
    prev_root:  signedRoot.prev_root,
    root:       signedRoot.root,
    schema:     signedRoot.schema,
    seqno:      signedRoot.seqno,
    skip:       signedRoot.skip,
    timestamp:  signedRoot.timestamp,
  };

  const preImageBytes = dagJsonCanonicalBytes(preImage);

  // Decode base64url signature
  const base64Padded = signedRoot.signature
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    + '='.repeat((4 - (signedRoot.signature.length % 4)) % 4);
  const signatureBytes = Buffer.from(base64Padded, 'base64');

  let ed;
  try {
    ed = require('@noble/ed25519');
  } catch (_) {
    if (globalThis.koad && globalThis.koad.deps && globalThis.koad.deps.ed) {
      ed = globalThis.koad.deps.ed;
    } else {
      throw new Error('[koad:io-merkle-tree] @noble/ed25519 not available.');
    }
  }

  try {
    const valid = await ed.verifyAsync(signatureBytes, preImageBytes, pubKeyBytes);
    return valid;
  } catch (_) {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const KingdomMerkleTree = {
  // Core construction
  buildTree,
  generateProof,
  verifyProof,
  buildSkipMap,

  // Signing
  signRoot,
  verifySignedRoot,

  // Helpers (exposed for testing and external use)
  validateLeaf,
  sortLeaves,
  hashLeaf,
  hashNode,
  dagJsonCanonical,
  dagJsonCanonicalBytes,
};
