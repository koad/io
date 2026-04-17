// SPDX-License-Identifier: AGPL-3.0-or-later
//
// key-passphrase-modal.js — Blaze template logic for the passphrase unlock modal.
//
// Usage: render {{> keyPassphraseModal}} and pass data context:
//   keyId       — string, id of key to unlock (optional; unlocks first stored key if omitted)
//   onUnlock    — callback(key) fired after successful unlock
//   onCancel    — callback() fired on cancel
//
// The modal calls koad.passenger.unlock(id, passphrase). On success it fires onUnlock
// with the active key object from koad.passenger.activeDeviceKey().

Template.keyPassphraseModal.onCreated(function () {
  const tpl = this;
  tpl.unlocking   = new ReactiveVar(false);
  tpl.unlockError = new ReactiveVar(null);

  // Resolve which key we're unlocking. If a keyId was passed in data context, use it.
  // Otherwise, try to find the first stored key via listKeys().
  tpl.activeKey = new ReactiveVar(null);

  const data = tpl.data || {};
  if (data.keyId) {
    tpl.activeKey.set({ id: data.keyId, description: data.keyDescription || null });
  } else if (koad && koad.passenger && typeof koad.passenger.listKeys === 'function') {
    koad.passenger.listKeys().then(keys => {
      if (keys && keys.length > 0) {
        tpl.activeKey.set(keys[0]);
      }
    }).catch(() => {});
  }
});

Template.keyPassphraseModal.helpers({
  unlocking()    { return Template.instance().unlocking.get(); },
  unlockError()  { return Template.instance().unlockError.get(); },
  activeKey()    { return Template.instance().activeKey.get(); },
});

Template.keyPassphraseModal.events({

  async 'submit #js-passphrase-form'(event, tpl) {
    event.preventDefault();
    tpl.unlockError.set(null);
    tpl.unlocking.set(true);

    const passphrase = tpl.$('.js-passphrase-input').val();
    const key        = tpl.activeKey.get();
    const keyId      = (key && key.id) || (tpl.data && tpl.data.keyId) || null;

    try {
      if (!koad || !koad.passenger || typeof koad.passenger.unlock !== 'function') {
        throw new Error('Passenger key storage is not available.');
      }
      if (!keyId) {
        throw new Error('No key found. Import or generate a key in Key Management first.');
      }
      if (!passphrase) {
        throw new Error('Passphrase is required.');
      }

      await koad.passenger.unlock(keyId, passphrase);

      const active = koad.passenger.activeDeviceKey();
      if (!active) {
        // unlock() resolved but activeDeviceKey() still null — wrong passphrase or
        // internal state issue; surface a generic message
        throw new Error('Passphrase incorrect. The key could not be decrypted.');
      }

      // Success — fire the callback and let the parent close this modal
      const onUnlock = tpl.data && tpl.data.onUnlock;
      if (typeof onUnlock === 'function') {
        onUnlock(active);
      }

    } catch (err) {
      tpl.unlockError.set(err.message || 'Incorrect passphrase.');
    } finally {
      tpl.unlocking.set(false);
    }
  },

  'click .js-km-cancel'(event, tpl) {
    event.preventDefault();
    const onCancel = tpl.data && tpl.data.onCancel;
    if (typeof onCancel === 'function') {
      onCancel();
    }
  },

  // Close on overlay click (outside the modal card)
  'click .js-km-overlay'(event, tpl) {
    if (event.target === event.currentTarget) {
      const onCancel = tpl.data && tpl.data.onCancel;
      if (typeof onCancel === 'function') {
        onCancel();
      }
    }
  },

  // Suppress Enter propagation so the form submit doesn't bubble
  'keydown .js-passphrase-input'(event) {
    if (event.key === 'Enter') {
      event.stopPropagation();
    }
  },
});
