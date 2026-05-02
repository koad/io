// Daemon merkle tree — VESTA-SPEC-169 wiring
//
// Builds the kingdom merkle tree on demand from the current entity index.
// Signing is deferred until the sovereign key infrastructure is wired
// (VESTA-SPEC-115 §3). For now, produces an unsigned summary for the
// operator dashboard.
//
// Entity leaves require a real sigchain tip CID (SPEC-111 format).
// Entities without a published tip are included with a sentinel tip
// ("pending") so the operator can see them in the table — but the
// leaf is excluded from the actual tree build (SPEC-169 §4 requires a
// valid tip; "pending" is not a valid CID). Once Mercury publishes
// entity sigchains, tips will populate here automatically.
//
// Route: /merkle (Blaze-rendered, server publishes via Meteor.method)

// Local ref — Entities collection is declared in entity-scanner.js
// globalThis reference so load-order is not a problem.
function getEntities() {
  return typeof EntityScanner !== 'undefined'
    ? EntityScanner.Entities.find().fetch()
    : [];
}

// Kingdom handle from env (KOAD_IO_SPIRIT or fallback)
const KINGDOM_HANDLE = process.env.KOAD_IO_SPIRIT || 'koad';

// Build the leaf set from current daemon entity state.
// Returns { leaves, skippedCount, reason }
//   leaves      — array of valid SPEC-169 leaves (only those with a real tip)
//   allEntities — array of { handle, tip, hasRealTip } for the UI table
//   skippedCount — entities skipped due to missing tip
function buildLeafSet() {
  const entities = getEntities();
  const allEntities = [];
  let skippedCount = 0;

  for (const entity of entities) {
    const tip = entity.sigchainTip || entity.chainTip || entity.tip_cid || null;
    const seq = entity.sigchainSeq || entity.chainSeq || 0;
    const hasRealTip = !!(tip && tip.startsWith('bagu'));
    allEntities.push({ handle: entity.handle, tip: tip || 'pending', seq, hasRealTip });
    if (!hasRealTip) skippedCount++;
  }

  // Build leaves only from entities with valid CID tips
  const leaves = allEntities
    .filter(e => e.hasRealTip)
    .map(e => ({
      type: 'entity',
      id: e.handle,
      tip: e.tip,
      seq: e.seq,
    }));

  return { leaves, allEntities, skippedCount };
}

// Build the tree state for the /merkle route.
// Returns a snapshot object — clients call this method to get fresh state.
Meteor.methods({
  async 'merkle.buildState'() {
    const { leaves, allEntities, skippedCount } = buildLeafSet();
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

    if (leaves.length === 0) {
      // No publishable sigchain tips yet — return empty-state summary
      return {
        kingdom: KINGDOM_HANDLE,
        status: 'no_published_tips',
        message: 'No entity sigchain tips published yet. Tree will populate as entities publish SPEC-111 entries.',
        leaf_count: 0,
        root: null,
        signature: null,
        seqno: null,
        timestamp,
        skip: {},
        allEntities,
        skippedCount,
        specRef: 'VESTA-SPEC-169',
      };
    }

    // Build the tree using the imported KingdomMerkleTree primitive
    try {
      const sorted = KingdomMerkleTree.sortLeaves(leaves);
      const { root } = KingdomMerkleTree.buildTree(sorted);
      const rootHex = root.toString('hex');

      return {
        kingdom: KINGDOM_HANDLE,
        status: 'built',
        message: null,
        leaf_count: leaves.length,
        root: rootHex,
        signature: null, // signing deferred — sovereign key not wired yet
        seqno: null,      // seqno tracking starts with signing infrastructure
        timestamp,
        skip: {},
        allEntities,
        skippedCount,
        specRef: 'VESTA-SPEC-169',
      };
    } catch (err) {
      console.error('[MERKLE] buildTree failed:', err.message);
      return {
        kingdom: KINGDOM_HANDLE,
        status: 'error',
        message: err.message,
        leaf_count: leaves.length,
        root: null,
        signature: null,
        seqno: null,
        timestamp,
        skip: {},
        allEntities,
        skippedCount,
        specRef: 'VESTA-SPEC-169',
      };
    }
  },
});

console.log('[MERKLE] merkle.buildState method registered');
