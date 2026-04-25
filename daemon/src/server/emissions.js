// Entity emissions — in-memory notification bus
// Entities push notices/warnings/errors/requests via DDP method or REST
// Operator subscribes via DDP to see them in real time

const VALID_TYPES = ['notice', 'warning', 'error', 'request', 'session', 'flight', 'service', 'conversation', 'hook'];

const Emissions = new Mongo.Collection('Emissions', { connection: null });

// Server-side ancestry enrichment.
//
// When an emission carries meta.parentId, look up the parent and stamp:
//   meta.rootId  — top of the tree (parent's rootId, or parent._id if parent is root)
//   meta.depth   — distance from root (parent.depth + 1, or 1 if parent is root)
//   meta.path    — ordered ancestor IDs from root to immediate parent
//
// Cost: one findOne per insert with a parentId. Pays back hugely on tree
// queries — `find({ 'meta.path': X })` finds all descendants in one selector.
//
// If the parent doesn't exist (race or already archived), the meta is left
// as-is — child orphans are preserved with whatever parentId the caller sent.
function enrichAncestry(meta) {
  if (!meta || !meta.parentId) return meta || {};
  const parent = Emissions.findOne(meta.parentId);
  if (!parent) return meta;

  const parentMeta = parent.meta || {};
  const enriched = Object.assign({}, meta);
  enriched.rootId = parentMeta.rootId || parent._id;
  enriched.depth = (parentMeta.depth || 0) + 1;
  enriched.path = [...(parentMeta.path || []), parent._id];
  return enriched;
}
globalThis.enrichEmissionAncestry = enrichAncestry;

Meteor.methods({
  getHostname() {
    const os = Npm.require('os');
    return os.hostname();
  },

  'entity.emit'(data) {
    check(data, {
      entity: String,
      type: String,
      body: String,
      lifecycle: Match.Optional(String),
      meta: Match.Optional(Object),
    });

    if (!VALID_TYPES.includes(data.type)) {
      throw new Meteor.Error('invalid-type', `Type must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const now = new Date();
    const isLifecycle = data.lifecycle === 'open';

    const doc = {
      entity: data.entity,
      type: data.type,
      body: data.body,
      timestamp: now,
    };

    if (data.meta) doc.meta = enrichAncestry(data.meta);

    if (isLifecycle) {
      doc.status = 'open';
      doc.startedAt = now;
      doc.updatedAt = now;
      doc.history = [{ body: data.body, at: now }];
    }

    const id = Emissions.insert(doc);
    EntityScanner.Entities.update({ handle: data.entity }, { $set: { lastActivity: now } });
    console.log(`[EMIT] ${data.entity}/${data.type}: ${data.body}${isLifecycle ? ' (lifecycle:open)' : ''}`);

    // Heartbeat: keep the most-recent active HarnessSessions record fresh.
    // This gives a near-real-time session signal even when last-payload.json
    // hasn't changed and the stale-check interval hasn't fired yet.
    try {
      const Sessions = globalThis.SessionsCollection;
      if (Sessions) {
        const activeSessions = Sessions.find({
          entity: data.entity,
          status: 'active',
        }).fetch();
        if (activeSessions.length > 0) {
          // Pick the most-recently-started session
          const mostRecent = activeSessions.reduce((a, b) =>
            new Date(a.startedAt || 0) >= new Date(b.startedAt || 0) ? a : b
          );
          Sessions.update(mostRecent._id, { $set: { lastSeen: now } });
        }
      }
    } catch (e) {
      // Non-fatal — heartbeat failure must not affect emission path
    }

    // Reactive layer — fire matching triggers
    if (globalThis.evaluateEmissionTriggers) {
      const event = isLifecycle ? 'open' : 'emit';
      globalThis.evaluateEmissionTriggers(Object.assign({}, doc, { _id: id }), event);
    }

    return { _id: id };
  },

  'entity.emit.update'(_id, body, action, meta, fields) {
    check(_id, String);
    check(body, Match.Optional(String));
    check(action, Match.Optional(String));
    check(meta, Match.Optional(Object));
    check(fields, Match.Optional(Object));  // { status_line, note, results, results_type }

    const existing = Emissions.findOne(_id);
    if (!existing) {
      throw new Meteor.Error('not-found', `Emission ${_id} not found`);
    }

    const f = fields || {};
    const hasStructuredField = f.status_line != null || f.note != null || f.results != null;
    if (!hasStructuredField && !body) {
      throw new Meteor.Error('missing-body', 'Provide body or structured fields (status_line / note / results)');
    }

    const now = new Date();
    const effectiveBody = body || f.status_line || f.note || '(field update)';
    const update = {
      $set: { body: effectiveBody, updatedAt: now },
      $push: { history: { body: effectiveBody, at: now } },
    };

    if (action === 'close') {
      update.$set.status = 'closed';
      update.$set.closedAt = now;
    } else if (existing.status === 'open') {
      update.$set.status = 'active';
    }

    // Merge meta — new keys overlay, existing keys preserved
    if (meta && typeof meta === 'object') {
      const merged = Object.assign({}, existing.meta || {}, meta);
      update.$set.meta = merged;
    }

    // Structured narration fields:
    //   status_line — current activity headline, replaced on each call
    //   note        — append-only timeline entry (pushed to notes[])
    //   results     — markdown payload set when work completes (replaced)
    if (typeof f.status_line === 'string') {
      update.$set.status_line = f.status_line;
    }
    if (typeof f.note === 'string') {
      if (!update.$push) update.$push = {};
      update.$push.notes = { body: f.note, at: now };
    }
    if (typeof f.results === 'string') {
      update.$set.results = f.results;
      update.$set.results_type = (typeof f.results_type === 'string' && f.results_type) ? f.results_type : 'markdown';
    }

    Emissions.update(_id, update);
    EntityScanner.Entities.update({ handle: existing.entity }, { $set: { lastActivity: now } });
    console.log(`[EMIT] ${existing.entity}/${existing.type}: ${effectiveBody} (${action || 'update'})`);

    // Reactive layer — fire matching triggers
    if (globalThis.evaluateEmissionTriggers) {
      const after = Emissions.findOne(_id);
      const event = action === 'close' ? 'close' : 'update';
      if (after) globalThis.evaluateEmissionTriggers(after, event);
    }

    return { _id };
  },

  'emissions.clear'(entity) {
    check(entity, Match.Optional(String));
    if (entity) {
      const count = Emissions.remove({ entity });
      return { cleared: count };
    }
    const count = Emissions.remove({});
    return { cleared: count };
  },
});

// Minimongo ({ connection: null }) cannot observe cursors with sort+limit.
// Use date-range selector; client sorts in its own Minimongo.
Meteor.publish('emissions', function () {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  return Emissions.find({ timestamp: { $gte: cutoff } });
});

Meteor.publish('emissions.entity', function (handle) {
  check(handle, String);
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000);
  return Emissions.find({ entity: handle, timestamp: { $gte: cutoff } });
});

// Export for REST endpoint — see flights.js for why globalThis is needed
globalThis.EmissionsCollection = Emissions;
