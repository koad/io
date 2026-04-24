# Body Merge — How Packages Inject Into `<body>`

## Why this matters

In a koad:io app, you NEVER write:

```html
<body>
  <nav class="site-nav">...</nav>
  <main>{{> yield}}</main>
</body>
```

You write your routes, your templates, your logic — and when you run the app, a fully-chromed UI appears. Where did the nav come from? Where did the workspace come from?

**Answer: Blaze merges `<body>` templates across packages at load time.**

## The mechanism

Any package can define a `<body>` template in one of its HTML files:

```html
<!-- ~/.forge/packages/navigation/client/body.html -->
<body>
  {{> __left_accordion_menu__}}
  {{> __top_bar_assembly__}}
</body>
```

At app startup, Blaze collects every `<body>` template across every loaded package and merges their contents into the app's `<body>`, in package-load order. The app author's `<body>` (or default empty one) comes last.

So if the nav package is loaded, the rendered DOM looks like:

```html
<body>
  <!-- from navigation package -->
  <div id="accordion" class="left-accordion-menu">...</div>
  <div class="toolbar topnavbar-assembly">...</div>
  <div class="navPadding"></div>

  <!-- from templating package (if loaded) -->
  <div class="application-containment">
    <main class="content-containment">
      ...yielded route content...
    </main>
  </div>

  <!-- from the app itself, if it has its own <body> template -->
  ...
</body>
```

Zero config from the app author. Just add the package to `.meteor/packages` and it appears.

## How to reach for it

If you're writing a package that needs to always be present on screen — nav, footer, overlay, announcement banner, debug panel — define a `<body>` template:

```html
<!-- my-package/client/body.html -->
<body>
  {{> myAlwaysVisibleThing}}
</body>
```

Then addFile it on client:

```js
// my-package/package.js
api.addFiles('client/body.html', 'client');
```

The app gets your template injected into its `<body>` automatically.

## Bugs in the wild

- **Package load order matters but isn't fully predictable** — if two packages both define `<body>` templates, order is determined by Meteor's package resolution. Usually this is fine (nav comes before layout because layout deps on nav, etc.), but if you run into ordering issues, the fix is adding explicit `api.use(otherPkg)` to force order.
- **No isolation** — templates merged into `<body>` are globally named. `Template.myThing` and another package's `Template.myThing` will collide. Scope template names with package prefixes to avoid collisions.

## Open questions

- Should there be a canonical order for body-merge contributors? (chrome first, workspace second, overlays last) — currently ordering is incidental.
- Would be nice to have a lightweight API that declares "I should render BEFORE/AFTER this other package's body content" — not currently a thing.

## See also

- Code: `~/.forge/packages/navigation/client/body.html` (4 lines; the canonical example)
- Related: [space-reservation.md](./space-reservation.md) — how body-merged content claims viewport space
- Related: [application-layout.md](./application-layout.md) — also body-merged, but much richer
