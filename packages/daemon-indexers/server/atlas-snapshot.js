// atlas.snapshot — pre-built single-shot corpus delivery for fast initial load.
//
// The DDP sub pattern (documents.atlas → observeChanges per record) is correct
// for live updates but slow for cold-start: every record traverses
// observe-mirror → forward → DDP message → browser. With ~2k docs + ~2k refs,
// that's noticeable on slow connections.
//
// This method returns the full corpus as a single JSON array. Server caches
// the result with a 60-second TTL keyed on the underlying Documents/DocumentRefs
// counts (cheap fingerprint — collection size is enough to invalidate when
// data changes). Browser inserts into local Mongo.Collections directly.
//
// Access to Documents and DocumentRefs is via new Mongo.Collection with
// connection:null — the standard daemon pattern for sharing in-memory
// collections across package files without explicit exports.

const DocumentsSnap    = new Mongo.Collection('Documents',    { connection: null });
const DocumentRefsSnap = new Mongo.Collection('DocumentRefs', { connection: null });

let _snapshotCache = null;        // { fingerprint, builtAt, payload }
const SNAPSHOT_TTL_MS = 60 * 1000;

function _buildAtlasSnapshot() {
  const docs = DocumentsSnap.find({}, {
    fields: { entity: 1, kind: 1, filename: 1, frontmatter: 1, mtime: 1, word_count: 1 },
  }).fetch();
  // Scope to resolved=true on the server. Include `resolved` in the projection
  // so the client reactive helper can reproduce the same selector locally.
  const refs = DocumentRefsSnap.find({ resolved: true }, {
    fields: { source_path: 1, target_path: 1, ref_key: 1, source_entity: 1, target_entity: 1, resolved: 1 },
  }).fetch();
  const fingerprint = docs.length + ':' + refs.length;
  return { fingerprint, builtAt: Date.now(), payload: { documents: docs, refs: refs } };
}

Meteor.methods({
  'atlas.snapshot'() {
    const now = Date.now();
    const docCount = DocumentsSnap.find().count();
    const refCount = DocumentRefsSnap.find({ resolved: true }).count();
    const currentFingerprint = docCount + ':' + refCount;
    if (_snapshotCache &&
        _snapshotCache.fingerprint === currentFingerprint &&
        (now - _snapshotCache.builtAt) < SNAPSHOT_TTL_MS) {
      return Object.assign({ cached: true }, _snapshotCache.payload, { fingerprint: _snapshotCache.fingerprint });
    }
    _snapshotCache = _buildAtlasSnapshot();
    return Object.assign({ cached: false }, _snapshotCache.payload, { fingerprint: _snapshotCache.fingerprint });
  },
});
