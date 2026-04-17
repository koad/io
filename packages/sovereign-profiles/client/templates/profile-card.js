// SPDX-License-Identifier: AGPL-3.0-or-later
//
// profile-card.js — Blaze template logic for the compact profile card.
// Usable anywhere. Data flows in via template data context:
//   {{ > profileCard profile=renderData }}
// where renderData is the output of SovereignProfile.render().

Template.profileCard.helpers({
  profile() {
    // Data context passed from parent template.
    // Expected shape: SovereignProfile.render() return value.
    return Template.currentData()?.profile || Template.currentData() || {};
  },

  firstLetter(name) {
    return (name || '?').charAt(0).toUpperCase();
  },
});
