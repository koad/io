// SPDX-License-Identifier: AGPL-3.0-or-later
//
// profile-full.js — Blaze template logic for the full profile view.
// Accepts data context from parent:
//   {{ > profileFull profile=renderData tipCid=cid }}
//
// Loads chain history reactively after mount.

import { SovereignProfile } from '../profile-viewer.js';

Template.profileFull.onCreated(function() {
  const tpl = this;
  tpl.chainHistory = new ReactiveVar([]);
  tpl.chainErrors = new ReactiveVar([]);
  tpl.chainLoading = new ReactiveVar(false);

  // Auto-load chain history if tipCid is provided
  tpl.autorun(function() {
    const data = Template.currentData();
    const tipCid = data?.tipCid;
    if (!tipCid) return;

    tpl.chainLoading.set(true);
    SovereignProfile.verifyChain(tipCid)
      .then(({ entries, errors }) => {
        tpl.chainHistory.set(entries);
        tpl.chainErrors.set(errors);
      })
      .catch(err => {
        tpl.chainErrors.set([err.message]);
      })
      .finally(() => {
        tpl.chainLoading.set(false);
      });
  });
});

Template.profileFull.helpers({
  profile() {
    const data = Template.currentData();
    return data?.profile || data || {};
  },

  chainHistory() {
    return Template.instance().chainHistory.get();
  },

  chainErrors() {
    return Template.instance().chainErrors.get();
  },

  chainLoading() {
    return Template.instance().chainLoading.get();
  },

  firstLetter(name) {
    return (name || '?').charAt(0).toUpperCase();
  },
});
