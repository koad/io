let lastEscPressTime = 0;
const escPressThreshold = 300; // Time in milliseconds; adjust as needed for sensitivity
const mainMenuItems = [{
  title: "updates",
  route: "updates",
  path: "/updates.html"
},{
  title: "status",
  route: "status",
  path: "/status.html",
},{
  title: "settings",
  route: "settings",
  path: "/settings.html",
},{
  title: "profiles",
  route: "profiles",
  path: "/profiles.html",
},{
  title: "designer",
  route: "designer",
  path: "/designer.html",
},{
  title: "workers",
  route: "workers",
  path: "/workers.html",
}]

Meteor.startup(() => {
Session.set('TopBarNavItems',  mainMenuItems);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const now = Date.now();
      if (now - lastEscPressTime <= escPressThreshold) {
        Session.set('TopBarNavItems', mainMenuItems);
        Session.set('ShowDevMode', true);
        lastEscPressTime = 0;
      } else {
        lastEscPressTime = now;
      }
    }
  });
});

Template.NewBrowserTab.onRendered(function () {
  Session.set('TopBarNavItems', [] );
  document.title="Start a new Journey";
  Session.set('ApplicationIconTarget', null)
});

Template.NewBrowserTab.onDestroyed(function () {
  Session.set('ApplicationIconTarget', '/')
  document.title="dark:passenger ready";
  Session.set('TopBarNavItems', [{
    title: "updates",
    route: "updates",
    path: "/updates.html"
  },{
    title: "status",
    route: "status",
    path: "/status.html",
  },{
    title: "settings",
    route: "settings",
    path: "/settings.html",
  }] );
});



Template.BrowserSidePanel.onRendered(function () {
  Session.set('TopBarNavItems', [] );
  document.title="dark:passenger ready";
  Session.set('ApplicationIconTarget', null)
});


