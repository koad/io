// SPDX-License-Identifier: AGPL-3.0-or-later
//
// key-generate-form.js — Blaze template logic for key generation.
//
// koad.passenger API used:
//   generateKey(opts) → Promise<{ id, publicKey }>
//     opts: { passphrase, description }
//
// After success the form resets and notifies the parent keyManagement surface
// to refresh its key list via the _kmRefresh hook on the ancestor DOM node.

Template.keyGenerateForm.onCreated(function () {
  const tpl = this;
  tpl.generating      = new ReactiveVar(false);
  tpl.generateError   = new ReactiveVar(null);
  tpl.generateSuccess = new ReactiveVar(null);
});

Template.keyGenerateForm.helpers({
  generating()      { return Template.instance().generating.get(); },
  generateError()   { return Template.instance().generateError.get(); },
  generateSuccess() { return Template.instance().generateSuccess.get(); },
});

Template.keyGenerateForm.events({

  async 'submit #js-key-generate-form'(event, tpl) {
    event.preventDefault();
    tpl.generateError.set(null);
    tpl.generateSuccess.set(null);
    tpl.generating.set(true);

    const entity            = tpl.$('.js-gen-entity').val().trim();
    const desc              = tpl.$('.js-gen-desc').val().trim();
    const passphrase        = tpl.$('.js-gen-passphrase').val();
    const passphraseConfirm = tpl.$('.js-gen-passphrase-confirm').val();

    try {
      if (!entity)     throw new Error('Entity name is required.');
      if (!passphrase) throw new Error('Passphrase is required.');
      if (passphrase !== passphraseConfirm) {
        throw new Error('Passphrases do not match.');
      }

      if (!koad || !koad.passenger || typeof koad.passenger.generateKey !== 'function') {
        throw new Error('Passenger key storage is not available.');
      }

      const description = [entity, desc].filter(Boolean).join(' — ');

      const result = await koad.passenger.generateKey({ passphrase, description });

      const shortId = result && result.id ? result.id.slice(0, 16) + '…' : 'key';
      tpl.generateSuccess.set(
        `Key generated (${shortId}). ` +
        'Back it up via Export before using it to sign anything important.'
      );

      // Reset form
      tpl.$('#js-key-generate-form')[0].reset();

      // Refresh parent key list
      const rootNode = tpl.firstNode;
      let node = rootNode && rootNode.parentNode;
      while (node) {
        if (node._kmRefresh) { node._kmRefresh(); break; }
        node = node.parentNode;
      }

    } catch (err) {
      tpl.generateError.set(err.message || 'Key generation failed.');
    } finally {
      tpl.generating.set(false);
    }
  },
});
