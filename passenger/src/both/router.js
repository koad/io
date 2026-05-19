Router.route('/', {name: 'home', template: 'home'});
Router.route('/index.html', {name: 'index', template: 'home'});
Router.route('/devops.html', {name: 'devops', template: 'devops'});
Router.route('/ecoincore.html', {name: 'ecoincore', template: 'blank'});
Router.route('/koad-io.html', {name: 'koad-io', template: 'blank'});

Router.route('/status.html', {name: 'status', template: 'Status'});
Router.route('/updates.html', {name: 'updates', template: 'Updates'});
Router.route('/settings.html', {name: 'settings', template: 'Settings'});

Router.route('/profiles.html', {name: 'profiles', template: 'SovereignProfiles'});
Router.route('/profiles/new.html', {name: 'profiles-new', template: 'ProfileWizard'});
Router.route('/profiles/edit.html', {name: 'profiles-edit', template: 'ProfileEditor'});
Router.route('/profiles/sign.html', {name: 'profiles-sign', template: 'SignMessage'});
Router.route('/profiles/verify.html', {name: 'profiles-verify', template: 'VerifyMessage'});
Router.route('/profiles/key.html', {name: 'profiles-key-inspect', template: 'KeyInspector'});

// Passenger Auth Routes
Router.route('/passenger/login.html', {name: 'passenger-login', template: 'PassengerLogin'});
Router.route('/passenger/login/success.html', {name: 'passenger-login-success', template: 'PassengerLoginComplete'});
Router.route('/passenger/login/failed.html', {name: 'passenger-login-failed', template: 'PassengerLoginComplete'});

Router.route('/workers.html', {name: 'workers', template: 'ServiceWorkers'});
Router.route('/designer.html', {name: 'designer', template: 'devops'});
Router.route('/shims.html', {name: 'shims', template: 'Shims'});
Router.route('/options.html', {name: 'options', template: 'blank', popup: true});

Router.route('/newtab.html', { name: 'newtab', template: 'NewBrowserTab' });
Router.route('/panel.html', { name: 'sidepanel', template: 'BrowserSidePanel' });


Router.configure({
  layoutTemplate: 'ApplicationLayout',
  template: 'DefaultTemplate',
  noRoutesTemplate: true
});
