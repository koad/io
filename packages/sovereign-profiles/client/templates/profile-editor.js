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
  tpl.publishCancelled = new ReactiveVar(false);

  // Local social proofs list (reactive so add/remove updates UI)
  tpl.socialProofs = new ReactiveVar([]);

  // Active device key — populated from koad.passenger.activeDeviceKey()
  tpl.deviceKey = new ReactiveVar(null);

  // Passphrase modal state — set to a pending-resolve function when waiting for unlock
  tpl._pendingPublish = null;
  tpl.showPassphraseModal = new ReactiveVar(false);

  // Current profile data — loaded from sigchain tip on startup
  tpl.currentProfile = new ReactiveVar({
    name: '',
    bio: '',
    avatar: null,
    socialProofs: [],
  });

  // Populate active device key from Passenger key store.
  // koad.passenger.activeDeviceKey() is synchronous — returns { id, description, publicKey }
  // or null when no key is unlocked. Re-checks whenever the template is recreated.
  if (koad && koad.passenger && typeof koad.passenger.activeDeviceKey === 'function') {
    tpl.deviceKey.set(koad.passenger.activeDeviceKey());
  }

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
    // A key being unlocked is no longer a pre-condition to enable the button —
    // the passphrase modal intercepts the publish flow when no key is active.
    // Only block the button while a publish is in flight.
    return !Template.instance().publishing.get();
  },

  deviceKey() {
    // Returns { id, description, publicKey } from Passenger key storage, or null.
    // The reactive var is set in onCreated and updated by koad.passenger.unlock().
    return Template.instance().deviceKey.get();
  },

  // Live preview data for the profileCard sub-template
  previewProfile() {
    const tpl = Template.instance();
    const profile = tpl.currentProfile.get();
    return {
      name: profile.name || 'Your Name',
      bio: profile.bio || '',
      avatar: profile.avatar || null,
      entity: null,
      verified: false,
      bondCount: null,
    };
  },

  firstLetter(name) {
    return (name || '?').charAt(0).toUpperCase();
  },

  showPassphraseModal() {
    return Template.instance().showPassphraseModal.get();
  },

  // Data context passed into {{> keyPassphraseModal}} when it renders
  passphraseModalData() {
    const tpl = this;
    // `this` is the helper's data context, not the template instance —
    // use Template.instance() to reach reactive state.
    const inst = Template.instance();
    return {
      onUnlock(activeKey) {
        // Modal succeeded: populate deviceKey, hide modal, resume publish
        inst.deviceKey.set(activeKey);
        inst.showPassphraseModal.set(false);
        if (typeof inst._pendingPublish === 'function') {
          const resume = inst._pendingPublish;
          inst._pendingPublish = null;
          resume();
        }
      },
      onCancel() {
        // User dismissed without unlocking: graceful cancel, not an error
        inst.showPassphraseModal.set(false);
        inst._pendingPublish = null;
        inst.publishError.set(null);
        inst.publishing.set(false);
        // Surface a soft status message without an error class
        inst.publishedCid.set(null);
        inst.publishSuccess.set(false);
        // Re-enable publish button but show inline note
        inst.publishCancelled.set(true);
      },
    };
  },

  publishCancelled() {
    return Template.instance().publishCancelled.get();
  },
});

// ── Events ────────────────────────────────────────────────────────────────────

Template.profileEditor.events({
  // ── Bio character counter ─────────────────────────────────
  'input #profile-bio'(event, tpl) {
    const el = event.currentTarget;
    const len = el.value.length;
    const max = parseInt(el.getAttribute('maxlength') || '280', 10);
    const counter = tpl.$('.js-bio-count');
    counter.text(`${len} / ${max}`);
    counter.removeClass('char-count--warn char-count--over');
    if (len >= max) {
      counter.addClass('char-count--over');
    } else if (len >= max * 0.85) {
      counter.addClass('char-count--warn');
    }
  },

  // ── Avatar CID → live preview ─────────────────────────────
  'input #profile-avatar'(event, tpl) {
    const cid = event.currentTarget.value.trim();
    const preview = tpl.$('.js-avatar-preview');
    if (cid) {
      preview.html(`<img src="/ipfs/${cid}" alt="avatar" />`);
    } else {
      const name = tpl.$('#profile-name').val().trim();
      preview.text((name || '?').charAt(0).toUpperCase());
    }
    // Keep reactive profile in sync so profileCard preview updates
    const current = tpl.currentProfile.get();
    tpl.currentProfile.set({ ...current, avatar: cid || null });
  },

  // Keep reactive name in sync for card preview
  'input #profile-name'(event, tpl) {
    const name = event.currentTarget.value;
    const current = tpl.currentProfile.get();
    tpl.currentProfile.set({ ...current, name });
  },

  // Keep reactive bio in sync for card preview
  'input #profile-bio'(event, tpl) {
    const bio = event.currentTarget.value;
    const current = tpl.currentProfile.get();
    tpl.currentProfile.set({ ...current, bio });
  },

  // ── CID copy button ────────────────────────────────────────
  'click .js-copy-cid'(event, tpl) {
    event.preventDefault();
    const cid = event.currentTarget.dataset.cid;
    if (!cid) return;
    navigator.clipboard.writeText(cid).then(() => {
      const btn = tpl.$(event.currentTarget);
      btn.addClass('copied').text('copied');
      setTimeout(() => btn.removeClass('copied').text('copy'), 2000);
    }).catch(() => {});
  },

  // ── Social proof add ──────────────────────────────────────
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
    tpl.publishCancelled.set(false);

    // ── Gate: ensure a key is unlocked before attempting to sign ──────────────
    // If no key is active, show the passphrase modal and wait for unlock.
    // The modal's onUnlock callback will re-invoke this flow via _pendingPublish.
    const activeKey = (koad && koad.passenger && typeof koad.passenger.activeDeviceKey === 'function')
      ? koad.passenger.activeDeviceKey()
      : null;

    if (!activeKey) {
      // Stash a resume function; the modal will call it on successful unlock
      tpl._pendingPublish = () => {
        // Re-fire the submit event programmatically on the form so the full
        // handler runs again with the now-unlocked key. Using requestSubmit()
        // triggers the native validation and the same submit handler.
        const form = tpl.$('#js-profile-editor-form')[0];
        if (form && typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else if (form) {
          form.submit();
        }
      };
      tpl.showPassphraseModal.set(true);
      return; // pause here — modal takes over
    }

    tpl.publishing.set(true);

    try {
      // Collect form values
      const name   = tpl.$('#profile-name').val().trim();
      const bio    = tpl.$('#profile-bio').val().trim();
      const avatar = tpl.$('#profile-avatar').val().trim() || null;
      const socialProofs = tpl.socialProofs.get();

      if (!name) throw new Error('Name is required');

      // Retrieve signing context from Passenger key store.
      // signingContext() throws if no key is unlocked — surfaced to the user below.
      if (!koad || !koad.passenger || typeof koad.passenger.signingContext !== 'function') {
        throw new Error(
          'Passenger key storage not available. ' +
          'Ensure koad.passenger is initialized before publishing.'
        );
      }

      const { entity, privateKey, pubkeyBytes, sigchainTip } =
        await koad.passenger.signingContext();

      let tipCid = sigchainTip;

      // SPEC-111 §4: if this is a fresh chain (no tip), emit a koad.genesis entry
      // first to anchor the entity + pubkey, then chain the profile state-update off it.
      if (!tipCid) {
        const genesisUnsigned = SovereignProfile.genesis({
          entity,
          pubkeyBytes,
        });
        const signedGenesis = await SovereignProfile.sign(genesisUnsigned, privateKey);
        tipCid = await SovereignProfile.publish(signedGenesis);
        // Persist genesis tip so that if the state-update publish fails we don't
        // re-emit genesis on retry.
        await koad.passenger.updateSigchainTip(tipCid);
      }

      const entry = SovereignProfile.create({
        entity,
        previousCid: tipCid,
        profile: { name, bio, avatar, socialProofs },
      });

      const signedEntry = await SovereignProfile.sign(entry, privateKey);
      const cid = await SovereignProfile.publish(signedEntry);

      // Update local sigchain tip pointer so next publish chains correctly
      await koad.passenger.updateSigchainTip(cid);

      // Refresh the deviceKey reactive var (unlock state may have changed)
      tpl.deviceKey.set(koad.passenger.activeDeviceKey());

      tpl.publishedCid.set(cid);
      tpl.publishSuccess.set(true);

    } catch (err) {
      tpl.publishError.set(err.message);
    } finally {
      tpl.publishing.set(false);
    }
  },
});
