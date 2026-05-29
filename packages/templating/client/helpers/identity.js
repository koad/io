import { Template } from 'meteor/templating'

// ---------------------------------------------------------------------------
// koad.identity Blaze helpers
//
// These helpers read from koad.identity which now publishes Tracker.Dependency
// reactivity (VESTA-SPEC-149 + identity-factory.js reactivity layer).
// Autoruns and Blaze computations automatically recompute when load(),
// lockdown(), create(), importMnemonic(), or setFromKeyManager() fires.
//
// Naming convention: koad_identity_<property> — underscore-delimited,
// matches existing helper conventions in this package.
// ---------------------------------------------------------------------------

Template.registerHelper('koad_identity_ready', function() {
	return koad.identity && koad.identity.ready();
});

Template.registerHelper('koad_identity_isLoaded', function() {
	return koad.identity && koad.identity.isLoaded;
});

Template.registerHelper('koad_identity_isMasterLoaded', function() {
	return koad.identity && koad.identity.isMasterLoaded;
});

Template.registerHelper('koad_identity_handle', function() {
	return koad.identity && koad.identity.handle;
});

Template.registerHelper('koad_identity_fingerprint', function() {
	return koad.identity && koad.identity.fingerprint;
});

Template.registerHelper('koad_identity_masterFingerprint', function() {
	return koad.identity && koad.identity.masterFingerprint;
});

Template.registerHelper('koad_identity_publicKey', function() {
	return koad.identity && koad.identity.publicKey;
});

Template.registerHelper('koad_identity_posture', function() {
	return koad.identity && koad.identity.posture;
});

Template.registerHelper('koad_identity_shortFp', function() {
	if (!koad.identity || !koad.identity.fingerprint) return '';
	return koad.identity.fingerprint.slice(-8).toLowerCase();
});
