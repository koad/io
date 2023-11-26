if (!Meteor.settings.public.ident || !Meteor.settings.public.ident.instance) {
  return console.log('Settings incomplete or not found, disabling koad:io');
};
  
const DEBUG = false;
ApplicationSessions = new Mongo.Collection('sessions');

let counter = 0;

const logDebug = (message) => {
  if (DEBUG) console.log(message);
};

Meteor.startup(() => {
  koad.maintenance = false;
  koad.instance = Meteor.settings.public.ident.instance;
  Session.set('instance', koad.instance);

  setTimeout(() => {
    let sessionData = ApplicationSessions.find({ _id: Meteor.connection._lastSessionId });
    if (!sessionData) return console.log('No session data found, cannot attach to koad:io dataport!');

    logDebug('Attached to koad:io dataport, observing changes.');
    koad.internals.upstart = new Date();
    sessionData.observeChanges({
      added: function (id, message) {
        counter++;
        logDebug(`${message} brings the total to ${counter} session(s).`);
        manageUserAuthenticationState(id, message);
      },
      changed: function (id, message) {
        logDebug(`${message} was changed.`);
        logDebug('Existing session changed.');
        manageUserAuthenticationState(id, message);
      },
      removed: function (id, message) {
        counter--;
        logDebug(`Lost one. We're now down to ${counter} session(s).`);
        manageUserAuthenticationState(id, message);
      },
    });
  }, 1600);
});


const manageUserAuthenticationState = (id, state) => {
  koad.internals.asof = new Date();
  if (state && state.stampedLoginToken) {
    Meteor.loginWithToken(state.stampedLoginToken.token, (error) => {
      if (error) {
        console.error(`Login failed: ${error}`);
      } else {
        logDebug('Successfully logged in.');
      }
    });
  }
  logDebug('manageUserAuthenticationState');
  logDebug({ state });
};
