// SPDX-License-Identifier: AGPL-3.0-or-later
//
// kingdoms-overview.js — Blaze template logic for the kingdoms index view.
// Subscribes to `kingdoms.all` (Vulcan Day-1 publication).
// Renders the Kingdoms collection via reactive cursor.
//
// Consumer: home page, /kingdoms route, or any operator panel.
// Usage: {{ > kingdomsOverview }}

Template.kingdomsOverview.onCreated(function() {
  const tpl = this;
  // Subscribe to the kingdoms.all publication (koad:io-core server/kingdoms-pub.js)
  tpl.subscribe('kingdoms.all');
});

Template.kingdomsOverview.helpers({
  loading() {
    return !Template.instance().subscriptionsReady();
  },

  kingdoms() {
    // Kingdoms is a global collection declared in koad:io-core/server/collections.js.
    // Sort by name for stable display order.
    return Kingdoms.find({}, { sort: { name: 1 } }).map(function(k) {
      return {
        _id:             k._id,
        name:            k.name        || k._id,
        domain:          k.domain      || null,
        sovereign:       k.sovereign   || null,   // sovereign entity name or handle
        sovereigntyModel: k.sovereigntyModel || null,
        // memberCount: prefer dedicated field if Vulcan stores it; fall back to entities array length.
        memberCount:     typeof k.memberCount === 'number'
                           ? k.memberCount
                           : (Array.isArray(k.entities) ? k.entities.length : null),
      };
    });
  },
});
