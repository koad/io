// Daemon merkle tree — VESTA-SPEC-173 wiring
//
// Builds the kingdom merkle tree on demand from the current entity index
// and the operator sigchain at ~/.koad-io/me/sigchain/.
//
// Signing is deferred until the sovereign key infrastructure is wired
// (VESTA-SPEC-115 §3). For now, produces an unsigned summary.
//
// Leaf types (SPEC-173 §3):
//   entity  — per-entity leaf; tip is the latest sigchain entry for that entity
//             (leafCid > genesisCid — prefer the most recent entry)
//   kingdom — exactly one; tip is the operator sigchain head CID
//
// Entities without a published tip appear in allEntities with tip: 'pending'
// but are excluded from the actual tree build (SPEC-173 §4 requires a valid tip).

const fs = Npm.require('fs');
const path = Npm.require('path');

function getEntities() {
  return typeof EntityScanner !== 'undefined'
    ? EntityScanner.Entities.find().fetch()
    : [];
}

const KINGDOM_HANDLE = process.env.KOAD_IO_SPIRIT || 'koad';

// Read the operator sigchain head CID from ~/.koad-io/me/sigchain/metadata.json.
// This becomes the kingdom leaf tip (SPEC-173 §4, SPEC-170).
function readKingdomTip() {
  try {
    const metaPath = path.join(process.env.HOME, '.koad-io', 'me', 'sigchain', 'metadata.json');
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return meta.sigchainHeadCID || null;
  } catch (e) {
    return null;
  }
}

// Count entries in the operator sigchain (used as kingdom leaf seq).
function readKingdomSeq() {
  try {
    const entriesDir = path.join(process.env.HOME, '.koad-io', 'me', 'sigchain', 'entries');
    return fs.readdirSync(entriesDir).filter(f => f.endsWith('.json')).length;
  } catch (e) {
    return 0;
  }
}

function isValidCid(cid) {
  return typeof cid === 'string' && cid.startsWith('bagu');
}

// Build the leaf set from current daemon entity state + kingdom sigchain.
function buildLeafSet() {
  const entities = getEntities();
  const allEntities = [];
  let skippedCount = 0;

  for (const entity of entities) {
    // Prefer leafCid (latest entry) over genesisCid (birth record).
    // leafCid is the koad.entity.leaf-authorize entry — the most recent
    // sigchain entry for this entity. genesisCid is the birth record.
    const tip = entity.leafCid || entity.genesisCid || null;
    // Per-entity seq: 2 if leaf-authorize exists (genesis + leaf), 1 if genesis only.
    const seq = entity.leafCid ? 2 : (entity.genesisCid ? 1 : 0);
    const hasRealTip = isValidCid(tip);
    allEntities.push({ handle: entity.handle, tip: tip || 'pending', seq, hasRealTip });
    if (!hasRealTip) skippedCount++;
  }

  // Entity leaves
  const leaves = allEntities
    .filter(e => e.hasRealTip)
    .map(e => ({
      type: 'entity',
      id: e.handle,
      tip: e.tip,
      seq: e.seq,
    }));

  // Kingdom leaf (SPEC-173 §4.2 — REQUIRED)
  const kingdomTip = readKingdomTip();
  const kingdomSeq = readKingdomSeq();
  if (isValidCid(kingdomTip)) {
    leaves.push({
      type: 'kingdom',
      id: KINGDOM_HANDLE,
      tip: kingdomTip,
      seq: kingdomSeq,
    });
  }

  return { leaves, allEntities, skippedCount, kingdomTip, kingdomSeq };
}

// Build the tree state. Shared by the Meteor method and REST endpoint.
function buildMerkleState() {
  const { leaves, allEntities, skippedCount, kingdomTip, kingdomSeq } = buildLeafSet();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  if (leaves.length === 0) {
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
      kingdomTip,
      kingdomSeq,
      specRef: 'VESTA-SPEC-173',
    };
  }

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
      signature: null,
      seqno: null,
      timestamp,
      skip: {},
      leaves,
      allEntities,
      skippedCount,
      kingdomTip,
      kingdomSeq,
      specRef: 'VESTA-SPEC-173',
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
      kingdomTip,
      kingdomSeq,
      specRef: 'VESTA-SPEC-173',
    };
  }
}

Meteor.methods({
  async 'merkle.buildState'() {
    return buildMerkleState();
  },
});

// Export for the REST API layer
MerkleBuilder = { buildMerkleState };

console.log('[MERKLE] merkle.buildState method registered');
