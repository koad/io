# PRIMER: koad:io-router

**Meteor package name:** `koad:io-router`  
**Version:** 3.6.9  
**State:** Built, active — consolidated fork of Iron Router

---

## What It Does

Client and server routing for Meteor/Blaze applications. This is a consolidated fork of Iron Router — it vendors all the Iron Router sub-packages (iron-core, iron-location, iron-url, iron-controller, iron-layout, iron-dynamic-template, iron-middleware-stack) into a single Meteor package rather than managing them as separate packages.

Key capabilities:
- Client-side URL routing with Blaze template rendering
- Server-side routes (REST endpoints, file serving)
- RESTful HTTP method routing (`.get()`, `.post()`, etc.)
- Middleware hooks (`onBeforeAction`, `onAfterAction`)
- Layout management and nested templates
- Automatic template name lookup from route name
- Data waiting/subscriptions via `waitOn`
- Built-in progress bar with spinner
- URL parameter and query string extraction

## Dependencies

**npm:** `body-parser@1.12.4`

**Meteor:** `koad:io-core`, `webapp` (server), `ejson`, `meteor`, `templating`, `blaze`, `underscore`, `tracker`, `ui`, `jquery`, `reactive-var`, `random`, `appcache` (weak)

## Key Exports

| Export | Description |
|--------|-------------|
| `Router` | Global router instance — define routes on this |
| `RouteController` | Base controller class |
| `Iron` | Iron Router namespace (internal utilities) |
| `Handler` | Test-only |
| `urlToHashStyle`/`urlFromHashStyle` | Client test-only |

## Usage Pattern

```javascript
// Basic route
Router.route('/items/:_id', function() {
  this.render('ShowItem', { data: Items.findOne(this.params._id) });
});

// Server-side REST route
Router.route('/api/data', { where: 'server' })
  .get(function() { this.response.end(JSON.stringify(data)); })
  .post(function() { /* handle POST */ });

// Auth guard
Router.onBeforeAction(function() {
  if (!Meteor.userId()) { this.render('Login'); } else { this.next(); }
});

// Wait on subscription
Router.route('/post/:_id', {
  waitOn: function() { return Meteor.subscribe('post', this.params._id); }
});
```

## Progress Bar

Bundled CSS/JS progress bar shown during route transitions. Configurable:
- `progressTick: false` — disable auto-ticking
- `progressSpinner: false` — disable spinner
- `progressDelay: 100` — ms delay before showing (for fast routes)
- `progressDebug: true` — debug logging

Override appearance:
```css
#iron-router-progress { background-color: #yourcolor; }
```

## File Map

```
lib/
  core.js                  ← Iron.core namespace
  url.js                   ← URL utilities
  compiler.js              ← route pattern compilation
  dynamic_template.js/.html ← dynamic template component
  blaze_overrides.js       ← Blaze integration patches
  layout/                  ← layout management
  location/                ← client URL/history state
  middleware_handler.js    ← middleware primitives
  middleware_stack.js      ← middleware chain
  controller.js            ← base RouteController
  controller_client.js     ← client controller
  controller_server.js     ← server controller
  route.js                 ← Route class
  router.js                ← Router class
  router_client.js         ← client router bootstrap
  router_server.js         ← server router bootstrap
  hooks.js                 ← lifecycle hooks
  helpers.js               ← Blaze helpers
  global_router.js         ← global Router singleton
  http_methods.js          ← REST method routing
  plugins.js               ← plugin system
  progress.html/js/css     ← progress bar
  templates.html           ← default layouts/error pages
  wait_list.js             ← subscription waiting
test/                      ← test suite
examples/                  ← usage examples
```

## Known Issues / Notes

- This is a fork of Iron Router, which is unmaintained upstream. Kept alive here for the koad:io Blaze stack.
- Sources consolidated from `polygonwood` and `iron-meteor` GitHub orgs.
- Test suite is present and substantive — run via `meteor test-packages`.
- See `Guide.md` and `History.md` in package root for original documentation.
