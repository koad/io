if(!process.env.KOAD_IO_ENABLE_PWA_MIDDLEWARE) return;
if(!Meteor.settings?.public?.application)
  return console.log('[koad:io] no application settings found, not serving a manifest.');

let errors = [];

if(!Meteor.settings?.public?.application.name) errors.push("missing: application.name");
if(!Meteor.settings?.public?.application.short_name) errors.push("missing: application.short_name");
if(!Meteor.settings?.public?.application.color) errors.push("missing: application.color");
if(!Meteor.settings?.public?.application.icons) errors.push("missing: application.icons");
if(!Meteor.settings?.public?.application.description) errors.push("missing: application.description");
if(!Meteor.settings?.public?.application.screenshots) errors.push("missing: application.screenshots");
if(!Meteor.settings?.public?.application.shortcuts) errors.push("missing: application.shortcuts");
if(!Meteor.settings?.public?.application.start_url) errors.push("missing: application.start_url");

if(errors.length > 0){
  console.log({errors})
  return log.warning('setup errors detected > not serving manifest')
}

const appId = "/?homescreen=1";
const application = Meteor.settings.public.application;
const siteManifest = {
  "id": appId,
  "scope": "/",
  "display": "standalone",
  "name": application.name,
  "short_name": application.short_name,
  "description": application.description,
  "start_url": application.start_url,
  "background_color": application.color,
  "theme_color": application.color,
  "icons": application.icons,
  "screenshots": application.screenshots,
  "shortcuts": application.shortcuts
};

Meteor.startup(() => {
  koad.manifest = siteManifest;
  WebApp.connectHandlers.use('/manifest.json', (req, res, next) => {
      res.writeHead(200, {'Content-Type': 'text/html'});
      res.end(JSON.stringify(siteManifest, null, 3));
  });
});
