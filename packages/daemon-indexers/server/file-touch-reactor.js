// file-touch-reactor.js — consume file.touched emissions → update Documents.asof
//
// Observes the in-memory Emissions collection for type: 'file.touched' and
// upserts the corresponding Documents record with fresh recency fields:
//
//   Documents.upsert({ _id: path }, { $set: {
//     asof:            now,
//     lastTouchedBy:   entity,
//     lastTouchedTool: toolName,
//   }})
//
// This wires the projector signal into the atlas recency-boost mechanism —
// the existing subscription sees asof change and the file node repels neighbors.
//
// The reactor only runs when KOAD_IO_INDEX_DOCUMENTS is set (same gate as
// the documents indexer that owns the Documents collection).
//
// Documents is accessed via new Mongo.Collection with connection:null —
// same pattern as atlas-snapshot.js for cross-file in-memory collection access.

// In-process access to the Documents collection (connection:null = in-memory share).
// Must be constructed AFTER documents.js loads and creates 'Documents'.
// Load order in package.js guarantees this.
const DocumentsReactor = new Mongo.Collection('Documents', { connection: null });

// ---------------------------------------------------------------------------
// Reactor startup — observe Emissions for file.touched
// ---------------------------------------------------------------------------

Meteor.startup(() => {
  // Only activate if the documents indexer is running
  if (!process.env.KOAD_IO_INDEX_DOCUMENTS) return;

  const Emissions = globalThis.EmissionsCollection;
  if (!Emissions) {
    console.warn('[file-touch-reactor] EmissionsCollection not available — reactor disabled');
    return;
  }

  // Observe new emissions of type file.touched.
  // observeChanges on connection:null collections is synchronous Minimongo —
  // no async required, no DDP overhead.
  Emissions.find({ type: 'file.touched' }).observeChanges({
    added(_id, fields) {
      handleFileTouched(_id, fields);
    },
  });

  console.log('[file-touch-reactor] watching Emissions for file.touched');
});

// ---------------------------------------------------------------------------
// Handler — called for each new file.touched emission
// ---------------------------------------------------------------------------

function handleFileTouched(_id, fields) {
  try {
    const payload = fields.meta && fields.meta.payload;
    if (!payload) return;

    const { path: filePath, toolName, sessionId } = payload;
    if (!filePath || typeof filePath !== 'string') return;

    const entity   = fields.entity || null;
    const now      = fields.timestamp || new Date();

    // Only update the Documents record if it already exists.
    // The documents indexer owns upsert-with-full-content; we only touch
    // recency fields so we don't clobber an indexer write with a stale record.
    const existing = DocumentsReactor.findOne({ _id: filePath });
    if (!existing) {
      // File isn't indexed yet (may be outside corpus dirs, or indexer not yet
      // caught up). Skip — don't create stub records outside the indexer's control.
      return;
    }

    DocumentsReactor.update(filePath, {
      $set: {
        asof:            now instanceof Date ? now : new Date(now),
        lastTouchedBy:   entity,
        lastTouchedTool: toolName || null,
      },
    });
  } catch (err) {
    // Non-fatal — reactor failure must not affect emission path
    console.warn(`[file-touch-reactor] handleFileTouched error: ${err.message}`);
  }
}
