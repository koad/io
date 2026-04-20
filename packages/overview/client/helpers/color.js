// Color helper functions shared by overview templates.
// These read from Passengers collection — caller must ensure it's available.

KoadOverview = KoadOverview || {};

// Entity accent color — warm hsl derived from passenger outfit.
// Returns a CSS hsl() string.
KoadOverview._entityColor = function (handle) {
  var passenger = globalThis.Passengers ? globalThis.Passengers.findOne({ handle: handle }) : null;
  var hue = passenger && passenger.outfit ? passenger.outfit.hue : 200;
  return 'hsl(' + hue + ', 60%, 65%)';
};

KoadOverview._accentColor = function (handle) {
  var passenger = globalThis.Passengers ? globalThis.Passengers.findOne({ handle: handle }) : null;
  var outfit = passenger && passenger.outfit;
  var hue = outfit ? outfit.hue : 0;
  var sat = outfit ? outfit.saturation : 0;
  var bri = outfit ? outfit.brightness : 30;
  return 'hsl(' + hue + ', ' + sat + '%, ' + Math.min(bri + 20, 60) + '%)';
};

// Profile URL — configurable by host app via KoadOverview.configure().
// Daemon sets baseUrl to 'https://kingofalldata.com'; forge uses relative '/'.
KoadOverview._settings = {
  profileBaseUrl: 'https://kingofalldata.com',
};

KoadOverview.configure = function (opts) {
  if (opts && opts.profileBaseUrl != null) {
    KoadOverview._settings.profileBaseUrl = opts.profileBaseUrl;
  }
};

KoadOverview._entityProfileUrl = function (handle) {
  var base = KoadOverview._settings.profileBaseUrl;
  // If base ends with '/', strip it; handle has no leading slash
  return base.replace(/\/$/, '') + '/' + handle;
};
