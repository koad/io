// SPDX-License-Identifier: AGPL-3.0-or-later
//
// key-import-form.js — Blaze template logic for key import.
//
// koad.passenger API used:
//   importKey(seed, opts) → Promise<{ id, publicKey }>
//     opts: { passphrase, description }
//     seed: hex string (64 chars) or Uint8Array (32 bytes)
//
// After success the form resets and notifies the parent keyManagement surface
// to refresh its key list by calling _kmRefresh on the nearest ancestor node.

Template.keyImportForm.onCreated(function () {
  const tpl = this;
  tpl.importing      = new ReactiveVar(false);
  tpl.importError    = new ReactiveVar(null);
  tpl.importSuccess  = new ReactiveVar(null);
});

Template.keyImportForm.helpers({
  importing()     { return Template.instance().importing.get(); },
  importError()   { return Template.instance().importError.get(); },
  importSuccess() { return Template.instance().importSuccess.get(); },
});

Template.keyImportForm.events({

  async 'submit #js-key-import-form'(event, tpl) {
    event.preventDefault();
    tpl.importError.set(null);
    tpl.importSuccess.set(null);
    tpl.importing.set(true);

    const seed              = tpl.$('.js-import-seed').val().trim();
    const label             = tpl.$('.js-import-label').val().trim();
    const passphrase        = tpl.$('.js-import-passphrase').val();
    const passphraseConfirm = tpl.$('.js-import-passphrase-confirm').val();

    try {
      if (!seed)       throw new Error('Key material is required.');
      if (!passphrase) throw new Error('Passphrase is required.');
      if (passphrase !== passphraseConfirm) {
        throw new Error('Passphrases do not match.');
      }

      if (!koad || !koad.passenger || typeof koad.passenger.importKey !== 'function') {
        throw new Error('Passenger key storage is not available.');
      }

      // importKey accepts a hex string directly; the key-store normalises it
      const result = await koad.passenger.importKey(seed, {
        passphrase,
        description: label || undefined,
      });

      const shortId = result && result.id ? result.id.slice(0, 16) + '…' : 'key';
      tpl.importSuccess.set(`Key imported (${shortId}). Passphrase stored — unlock it to sign.`);

      // Reset form
      tpl.$('#js-key-import-form')[0].reset();

      // Refresh parent key list
      const rootNode = tpl.firstNode;
      let node = rootNode && rootNode.parentNode;
      while (node) {
        if (node._kmRefresh) { node._kmRefresh(); break; }
        node = node.parentNode;
      }

    } catch (err) {
      tpl.importError.set(err.message || 'Import failed.');
    } finally {
      tpl.importing.set(false);
    }
  },
});
