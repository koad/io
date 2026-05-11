Package.describe({
  name: 'koad:io-daemon-indexers',
  version: '0.0.1',
  summary: 'Kingdom daemon indexers — entity scanner, alerts, keys, kingdoms, env, tickler, triggers, workers, documents, provisioner, founding cohort, pluggable indexer registry, emissions, bonds, passengers, primers, kingdom signing keys, atlas-snapshot, effectors, workspace-entity',
  git: '',
  documentation: null
});

// js-yaml is used by the primers indexer for YAML frontmatter parsing
Npm.depends({ 'js-yaml': '4.1.0' });

Package.onUse(function(api) {

	api.use('ecmascript');
	api.use('webapp');
	api.use('mongo');
	api.use('random');
	api.use('check');
	api.use('koad:io-core');
	api.use('koad:io-merkle-tree');

	// Load order matters:
	//   1. entity-scanner first — all other indexers depend on EntityScanner
	//   2. emissions — sets globalThis.EmissionsCollection (needed by provisioner)
	//   3. kingdoms, alerts, env, keys, tickler — depend on EntityScanner
	//   4. triggers-scanner — depends on EntityScanner; sets evaluateEmissionTriggers
	//   5. workers-scanner — depends on EntityScanner + koad.workers
	//   6. documents — depends on EntityScanner
	//   7. provisioner — depends on EntityScanner + globalThis.EmissionsCollection + evaluateEmissionTriggers (lazy refs, safe)
	//   8. founding-cohort-scanner — depends on EntityScanner
	//   9. kingdom-keys — must load before merkle.js (merkle reads KingdomKeys global)
	//  10. merkle — depends on EntityScanner + KingdomKeys (lazy ref, safe after #9)
	//  11. pluggable indexer infrastructure
	//  12. bonds — depends on EntityScanner + Kingdoms (lazy ref, safe)
	//  13. passengers — depends on EntityScanner
	//  14. primers — depends on nothing (self-contained walk)
	//  11. pluggable indexer infrastructure (jsonl, post-folder, brief-folder, claude-session, json-folder)
	//  15. atlas-snapshot — Meteor.methods for fast corpus delivery; must follow documents
	//  16. effectors — self-contained Meteor.methods, no ordering constraint
	//  17. workspace-entity — self-contained Meteor.methods + Passengers collection ref
	api.addFiles([
		'server/indexers/entity-scanner.js',
		'server/emissions.js',
		'server/indexers/kingdoms.js',
		'server/indexers/alerts.js',
		'server/indexers/env.js',
		'server/indexers/keys.js',
		'server/indexers/tickler.js',
		'server/indexers/triggers-scanner.js',
		'server/indexers/workers-scanner.js',
		'server/indexers/documents.js',
		'server/indexers/provisioner.js',
		'server/indexers/founding-cohort-scanner.js',
		'server/kingdom-keys.js',
		'server/merkle.js',
		'server/emissions-summary.js',
		'server/indexer-registry.js',
		'server/jsonl-projector.js',
		'server/post-folder-projector.js',
		'server/brief-folder-projector.js',
		'server/claude-session-projector.js',
		'server/json-folder-projector.js',
		'server/pluggable-indexers-startup.js',
		'server/indexer-admin-api.js',
		'server/indexers/bonds.js',
		'server/indexers/passengers.js',
		'server/indexers/primers.js',
		'server/atlas-snapshot.js',
		'server/effectors.js',
		'server/workspace-entity.js',
	], 'server');

	// EntityScanner and KingdomsIndexer are referenced by app-level files
	// (bonds.js, api.js etc.) via the implicit global — no export needed.
	// MerkleBuilder is used by app-level REST endpoints.
	// KingdomKeys is used by merkle.js (within this package) and may be referenced
	// by app-level code that reads signing key metadata.
	api.export('EntityScanner', 'server');
	api.export('KingdomsIndexer', 'server');
	api.export('MerkleBuilder', 'server');
	api.export('KingdomKeys', 'server');
});
