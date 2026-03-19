const DEFAULT_STATISTICS = {
  total_count: 0,
  list_count: 0,
  update_count: 0,
  delete_count: 0,
  get_count: 0,
  insert_count: 0,
  is_statistics_panel_visible: true,
  is_interface_panel_visible: true,
  is_database_panel_visible: true
};

const STATISTICS_KEYS = [
  'hooks',
  'web-hooks',
  'bank-hooks',
  'moneris-post',
  'coind-notifier-post',
  'coind-notifier',
  'sms-notifier-get',
  'sms-notifier'
];

Meteor.startup(async function() {
  for (const key of STATISTICS_KEYS) {
    if (await ApplicationStatistics.findOneAsync({ _id: key }) === null) {
      await ApplicationStatistics.insertAsync({
        _id: key,
        ...DEFAULT_STATISTICS
      });
    }
  }
});
