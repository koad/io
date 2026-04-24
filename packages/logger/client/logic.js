const getCurrentRoute = () => {
  try {
    return Router?.current()?.route?.path() || 'unknown';
  } catch {
    return 'unknown';
  }
};

const throwError = function(error, origin, message) {
  console.log(`[NEW ERROR EVENT]:\ne:${error}\no:${origin}\nm:${message}`);
};

const catchError = function(origin, error, message) {
  const data = {
    method: origin,
    error: error,
    message: typeof message === 'string' ? message : error?.message
  };

  Meteor.call('caughtError', data);
  alert(data.message);
};

const log = {
  info(method, msg) {
    Meteor.call('logEvent', {
      message: msg,
      type: 'INFO',
      method: method,
      class: 'info',
      icon: 'fa fa-info-circle',
      route: getCurrentRoute()
    });
  },
  check(method, msg) {
    Meteor.call('logEvent', {
      message: msg,
      type: 'CHECK',
      method: method,
      class: 'muted',
      icon: 'fa fa-question-circle',
      route: getCurrentRoute()
    });
  },
  system(method, msg) {
    Meteor.call('logEvent', {
      message: msg,
      type: 'SYSTEM',
      method: method,
      class: 'primary',
      icon: 'fa fa-check-circle',
      route: getCurrentRoute()
    });
  },
  success(method, msg) {
    Meteor.call('logEvent', {
      message: msg,
      type: 'SUCCESS',
      method: method,
      class: 'success',
      icon: 'fa fa-thumbs-o-up',
      route: getCurrentRoute()
    });
  },
  warning(method, msg) {
    Meteor.call('logEvent', {
      message: msg,
      type: 'WARNING',
      method: method,
      class: 'warning',
      icon: 'fa fa-minus-circle',
      route: getCurrentRoute()
    });
  },
  error(method, msg, errorData) {
    Meteor.call('logEvent', {
      message: msg,
      type: 'ERROR',
      method: method,
      class: 'danger',
      icon: 'fa fa-warning',
      route: getCurrentRoute(),
      dump: errorData
    });
  }
};

window.onerror = function(errorMsg, url, lineNumber, column, errorObj) {
  console.log('Catching error!');
  console.log({ errorMsg, url, lineNumber, column, errorObj });

  if (errorMsg.indexOf('Script error.') > -1) return;
  if (errorMsg.indexOf('Unexpected token') > -1) return;

  try {
    if (!Router?.current()) return;
  } catch {
    return;
  }

  let errRoute;
  try {
    const route = Router.current().route;
    errRoute = {
      route: route.getName(),
      path: route.path(),
      params: route.params()
    };
  } catch {
    errRoute = { route: 'unknown', path: 'unknown', params: {} };
  }

  let sessionId = null;
  try {
    sessionId = Meteor.status()?.sessionId || Meteor.connection?._lastSessionId;
  } catch {}

  const errorData = {
    route: errRoute,
    message: errorMsg,
    source: url,
    ln: lineNumber,
    connection: sessionId,
    location: window.location?.href
  };

  console.log({ errorData });
  Meteor.call('uncaughtError', errorData);
};

// Meteor 3: bare `this` at module top level is undefined in Reify — use globalThis.
globalThis.log = log;
globalThis.catchError = catchError;
globalThis.throwError = throwError;
