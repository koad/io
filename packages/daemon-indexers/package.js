Package.describe({
  name: 'koad:io-daemon-indexers',
  version: '0.0.1',
  summary: 'Kingdom daemon indexers — entity scanner, alerts, keys, kingdoms, env, tickler, triggers, workers, documents, provisioner, founding cohort, pluggable indexer registry',
  git: '',
  documentation: null
});

Package.onUse(function(api) {

	api.use('mongo');
	api.use('random');
	api.use('check');
	api.use('koad:io-core');
	api.use('koad:io-worker-processes');
	api.use('koad:io-merkle-tree');

	// Load order matters:
	//   1. entity-scanner first — all other indexers depend on EntityScanner
	//   2. kingdoms, alerts, env, keys, tickler — depend on EntityScanner
	//   3. triggers-scanner — depends on EntityScanner
	//   4. workers-scanner — depends on EntityScanner + koad.workers
	//   5. documents — depends on EntityScanner
	//   6. provisioner — depends on EntityScanner + EmissionsCollection + evaluateEmissionTriggers
	//   7. founding-cohort-scanner — depends on EntityScanner
	//   8. merkle — depends on EntityScanner
	//   9. pluggable indexer infrastructure
	api.addFiles([
		'server/indexers/entity-scanner.js',
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
		'server/merkle.js',
		'server/emissions-summary.js',
		'server/indexer-registry.js',
		'server/pluggable-indexers-startup.js',
		'server/indexer-admin-api.js',
	], 'server');

	// EntityScanner and KingdomsIndexer are referenced by app-level files
	// (bonds.js, api.js etc.) via the implicit global — no export needed.
	// MerkleBuilder is used by app-level REST endpoints.
	api.export('EntityScanner', 'server');
	api.export('KingdomsIndexer', 'server');
	api.export('MerkleBuilder', 'server');
});
