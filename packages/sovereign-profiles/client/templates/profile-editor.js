// SPDX-License-Identifier: AGPL-3.0-or-later
//
// profile-editor.js — Blaze template logic for the Passenger profile editor.
// Requires: SovereignProfile (builder API), local key access via Passenger.
//
// Key responsibilities:
//   - Read current profile from the entity's sigchain tip (via koad.sovereign.profile.resolve)
//   - Build new sigchain entry on submit
//   - Sign with local device key (sourced from Passenger key storage)
//   - Publish to IPFS, display returned CID

import { SovereignProfile } from '../profile-builder.js';

// ── Reactive state ────────────────────────────────────────────────────────────

Template.profileEditor.onCreated(function() {
  const tpl = this;

  tpl.publishing = new ReactiveVar(false);
  tpl.publishError = new ReactiveVar(null);
  tpl.publishSuccess = new ReactiveVar(false);
  tpl.publishedCid = new ReactiveVar(null);

  // Local social proofs list (reactive so add/remove updates UI)
  tpl.socialProofs = new ReactiveVar([]);

  // Current profile data — loaded from sigchain tip on startup
  tpl.currentProfile = new ReactiveVar({
    name: '',
    bio: '',
    avatar: null,
    socialProofs: [],
  });

  // TODO: load current profile from the entity's sigchain tip CID.
  // Pattern:
  //   const tipCid = koad.entity.sigchainTipCid(); // from Passenger session
  //   if (tipCid) {
  //     SovereignProfile.resolve(tipCid).then(data => {
  //       if (data) {
  //         tpl.currentProfile.set(data);
  //         tpl.socialProofs.set(data.socialProofs || []);
  //       }
  //     });
  //   }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

Template.profileEditor.helpers({
  currentProfile() {
    const tpl = Template.instance();
    return {
      ...tpl.currentProfile.get(),
      socialProofs: tpl.socialProofs.get(),
    };
  },

  publishing() {
    return Template.instance().publishing.get();
  },

  publishError() {
    return Template.instance().publishError.get();
  },

  publishSuccess() {
    return Template.instance().publishSuccess.get();
  },

  publishedCid() {
    return Template.instance().publishedCid.get();
  },

  canPublish() {
    const tpl = Template.instance();
    return !tpl.publishing.get() && tpl.deviceKey.get() !== null;
  },

  deviceKey() {
    // TODO: return active device key info from Passenger key storage
    // Pattern: koad.passenger.activeDeviceKey() → { id, description, pubkey, privateKey }
    return null;
  },
});

// ── Events ────────────────────────────────────────────────────────────────────

Template.profileEditor.events({
  'click .js-add-proof'(event, tpl) {
    event.preventDefault();
    const platform = tpl.$('#proof-platform').val().trim();
    const handle   = tpl.$('#proof-handle').val().trim();
    const url      = tpl.$('#proof-url').val().trim();

    if (!platform || !handle) return;

    const proofs = tpl.socialProofs.get();
    tpl.socialProofs.set([...proofs, { platform, handle, url }]);

    // Clear inputs
    tpl.$('#proof-platform').val('');
    tpl.$('#proof-handle').val('');
    tpl.$('#proof-url').val('');
  },

  'click .js-remove-proof'(event, tpl) {
    event.preventDefault();
    const idx = parseInt(event.currentTarget.dataset.index, 10);
    const proofs = tpl.socialProofs.get().filter((_, i) => i !== idx);
    tpl.socialProofs.set(proofs);
  },

  async 'submit #js-profile-editor-form'(event, tpl) {
    event.preventDefault();

    tpl.publishError.set(null);
    tpl.publishSuccess.set(false);
    tpl.publishing.set(true);

    try {
      // Collect form values
      const name   = tpl.$('#profile-name').val().trim();
      const bio    = tpl.$('#profile-bio').val().trim();
      const avatar = tpl.$('#profile-avatar').val().trim() || null;
      const socialProofs = tpl.socialProofs.get();

      if (!name) throw new Error('Name is required');

      // TODO: retrieve private key from Passenger key storage
      // const { entity, privateKey, pubkeyBytes, tipCid } = koad.passenger.signingContext();
      //
      // For scaffold: throw a clear TODO error rather than silently no-op
      throw new Error('TODO: connect to Passenger key storage. Retrieve entity, privateKey, pubkeyBytes, tipCid from koad.passenger.signingContext()');

      // ── Below is the intended flow once key storage is wired ──

      // const entry = SovereignProfile.create({
      //   entity,
      //   previousCid: tipCid,
      //   profile: { name, bio, avatar, socialProofs },
      // });

      // const signedEntry = await SovereignProfile.sign(entry, privateKey);
      // const cid = await SovereignProfile.publish(signedEntry);

      // // Update local sigchain tip pointer
      // koad.passenger.updateSigchainTip(cid);

      // tpl.publishedCid.set(cid);
      // tpl.publishSuccess.set(true);

    } catch (err) {
      tpl.publishError.set(err.message);
    } finally {
      tpl.publishing.set(false);
    }
  },
});
