// SPDX-License-Identifier: AGPL-3.0-or-later
//
// key-management.js — Blaze template logic for the Key Management surface.
//
// Surfaces:
//   - List all stored keys, flag the active (unlocked) one
//   - Lock all keys (clear session memory)
//   - Export a key (decrypt with passphrase, show PEM)
//   - Delete a key (with confirmation step)
//
// Sub-templates keyImportForm and keyGenerateForm handle their own logic.
//
// koad.passenger API used here:
//   listKeys()          → Promise<Array<{ id, description, publicKey }>>
//   activeDeviceKey()   → { id, description, publicKey } | null (sync)
//   clearSession()      → void
//   exportKey(id, passphrase) → Promise<string>  (PEM — NEEDS VULCAN)
//   deleteKey(id)       → Promise<void>

Template.keyManagement.onCreated(function () {
  const tpl = this;

  tpl.storedKeys    = new ReactiveVar([]);
  tpl.loadingKeys   = new ReactiveVar(true);
  tpl.globalError   = new ReactiveVar(null);
  tpl.globalSuccess = new ReactiveVar(null);

  // Export flow state
  tpl.showExport    = new ReactiveVar(false);
  tpl.exportKeyId   = new ReactiveVar(null);
  tpl.exportPem     = new ReactiveVar(null);
  tpl.exportError   = new ReactiveVar(null);
  tpl.exporting     = new ReactiveVar(false);

  // Delete flow state
  tpl.showDeleteConfirm = new ReactiveVar(false);
  tpl.deleteKeyId       = new ReactiveVar(null);

  tpl._refreshKeys = function () {
    tpl.loadingKeys.set(true);
    if (!koad || !koad.passenger || typeof koad.passenger.listKeys !== 'function') {
      tpl.loadingKeys.set(false);
      tpl.globalError.set('Passenger key storage is not available.');
      return;
    }
    koad.passenger.listKeys().then(keys => {
      tpl.storedKeys.set(keys || []);
      tpl.loadingKeys.set(false);
    }).catch(err => {
      tpl.loadingKeys.set(false);
      tpl.globalError.set(err.message || 'Failed to load keys.');
    });
  };

  tpl._refreshKeys();
});

Template.keyManagement.helpers({
  loadingKeys()       { return Template.instance().loadingKeys.get(); },
  storedKeys() {
    const tpl   = Template.instance();
    const keys  = tpl.storedKeys.get();
    const active = (koad && koad.passenger && typeof koad.passenger.activeDeviceKey === 'function')
      ? koad.passenger.activeDeviceKey()
      : null;
    const activeId = active && active.id;
    return keys.map(k => ({ ...k, isActive: k.id === activeId }));
  },
  hasKeys()           { return Template.instance().storedKeys.get().length > 0; },
  globalError()       { return Template.instance().globalError.get(); },
  globalSuccess()     { return Template.instance().globalSuccess.get(); },

  // Export flow
  showExport()        { return Template.instance().showExport.get(); },
  exportKeyId()       { return Template.instance().exportKeyId.get(); },
  exportPem()         { return Template.instance().exportPem.get(); },
  exportError()       { return Template.instance().exportError.get(); },
  exporting()         { return Template.instance().exporting.get(); },

  // Delete flow
  showDeleteConfirm() { return Template.instance().showDeleteConfirm.get(); },
  deleteKeyId()       { return Template.instance().deleteKeyId.get(); },
});

Template.keyManagement.events({

  // ── Lock all ───────────────────────────────────────────────
  'click .js-km-lock-all'(event, tpl) {
    event.preventDefault();
    tpl.globalError.set(null);
    tpl.globalSuccess.set(null);
    if (koad && koad.passenger && typeof koad.passenger.clearSession === 'function') {
      koad.passenger.clearSession();
      tpl.globalSuccess.set('All keys locked. Session memory cleared.');
      tpl._refreshKeys();
    } else {
      tpl.globalError.set('Passenger key storage is not available.');
    }
  },

  // ── Export key — open flow ─────────────────────────────────
  'click .js-km-export-key'(event, tpl) {
    event.preventDefault();
    const keyId = event.currentTarget.dataset.keyId;
    tpl.exportKeyId.set(keyId);
    tpl.exportPem.set(null);
    tpl.exportError.set(null);
    tpl.showExport.set(true);
    tpl.showDeleteConfirm.set(false);
    tpl.globalError.set(null);
    tpl.globalSuccess.set(null);
  },

  // ── Export form submit ─────────────────────────────────────
  async 'submit #js-export-form'(event, tpl) {
    event.preventDefault();
    tpl.exportError.set(null);
    tpl.exporting.set(true);

    const keyId      = tpl.exportKeyId.get();
    const passphrase = tpl.$('.js-export-passphrase').val();

    try {
      if (!koad || !koad.passenger || typeof koad.passenger.exportKey !== 'function') {
        // exportKey is flagged for Vulcan — surface a clear message
        throw new Error(
          'koad.passenger.exportKey() is not implemented yet. Flag for Vulcan.'
        );
      }
      if (!passphrase) throw new Error('Passphrase is required.');

      const pem = await koad.passenger.exportKey(keyId, passphrase);
      tpl.exportPem.set(pem);

    } catch (err) {
      tpl.exportError.set(err.message || 'Failed to decrypt key.');
    } finally {
      tpl.exporting.set(false);
    }
  },

  // ── Copy exported PEM to clipboard ────────────────────────
  'click .js-km-copy-export'(event, tpl) {
    event.preventDefault();
    const pem = tpl.exportPem.get();
    if (!pem) return;
    navigator.clipboard.writeText(pem).then(() => {
      const btn = tpl.$(event.currentTarget);
      btn.text('Copied');
      setTimeout(() => btn.text('Copy to clipboard'), 2000);
    }).catch(() => {});
  },

  // ── Close export panel ─────────────────────────────────────
  'click .js-km-close-export'(event, tpl) {
    event.preventDefault();
    tpl.showExport.set(false);
    tpl.exportPem.set(null);
    tpl.exportError.set(null);
    tpl.exportKeyId.set(null);
  },

  // ── Delete key — open confirmation ────────────────────────
  'click .js-km-delete-key'(event, tpl) {
    event.preventDefault();
    const keyId = event.currentTarget.dataset.keyId;
    tpl.deleteKeyId.set(keyId);
    tpl.showDeleteConfirm.set(true);
    tpl.showExport.set(false);
    tpl.globalError.set(null);
    tpl.globalSuccess.set(null);
  },

  // ── Delete confirmed ───────────────────────────────────────
  async 'click .js-km-delete-confirm'(event, tpl) {
    event.preventDefault();
    const keyId = event.currentTarget.dataset.keyId;
    tpl.globalError.set(null);
    tpl.globalSuccess.set(null);

    try {
      if (!koad || !koad.passenger || typeof koad.passenger.deleteKey !== 'function') {
        throw new Error('Passenger key storage is not available.');
      }
      await koad.passenger.deleteKey(keyId);
      tpl.globalSuccess.set(`Key ${keyId} deleted.`);
      tpl.showDeleteConfirm.set(false);
      tpl.deleteKeyId.set(null);
      tpl._refreshKeys();
    } catch (err) {
      tpl.globalError.set(err.message || 'Failed to delete key.');
      tpl.showDeleteConfirm.set(false);
    }
  },

  // ── Delete cancelled ──────────────────────────────────────
  'click .js-km-delete-cancel'(event, tpl) {
    event.preventDefault();
    tpl.showDeleteConfirm.set(false);
    tpl.deleteKeyId.set(null);
  },
});

// ── Sub-template: key list refresh hook ──────────────────────────────────────
// Expose a global so keyImportForm and keyGenerateForm can trigger a refresh
// of the parent key list after successfully adding a key.
Template.keyManagement.onRendered(function () {
  const tpl = this;
  // Store a refresh handle on the DOM node so sub-templates can reach it
  this.firstNode && (this.firstNode._kmRefresh = () => tpl._refreshKeys());
});
