// Indexer loader — startup summary
// Meteor eager-loads all files in server/ alphabetically.
// Entity scanner loads first (entity-scanner.js < env.js alphabetically).
// Each indexer self-gates on its own KOAD_IO_INDEX_* env var.
// This file just prints the active/inactive summary.

Meteor.startup(() => {
  const indexers = [
    ['PASSENGERS', process.env.KOAD_IO_INDEX_PASSENGERS],
    ['ENV', process.env.KOAD_IO_INDEX_ENV],
    ['BONDS', process.env.KOAD_IO_INDEX_BONDS],
    ['KEYS', process.env.KOAD_IO_INDEX_KEYS],
    ['TICKLER', process.env.KOAD_IO_INDEX_TICKLER],
  ];

  const active = indexers.filter(([, v]) => v).map(([k, v]) => `${k}=${v}`);
  const inactive = indexers.filter(([, v]) => !v).map(([k]) => k);

  console.log('[INDEXERS] Entity scanner: always on');
  console.log('[INDEXERS] Alerts: always on');
  console.log('[INDEXERS] Active:', active.length ? active.join(', ') : 'none');
  if (inactive.length) {
    console.log('[INDEXERS] Inactive:', inactive.join(', '));
  }
});
