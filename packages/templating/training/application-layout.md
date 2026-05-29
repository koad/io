# ApplicationLayout — The Three-Zone Workspace

> The templating package's main contribution: a fixed-position workspace with a center yield and dynamic left/right panel stacks. Each panel has its own history. Space reservation is reactive.

## Why this matters

Regular-flow Meteor apps scroll their whole body — main content stacked vertically, everything flows. Fine for blogs, landing pages, simple CRUD.

But cockpit-style apps (the daemon interface, kingofalldata.com, any dashboard with rich drill-downs) want a **window manager** feel: a stable center surface + panels that slide in alongside without navigating away. Finder column view. Dev tools. VS Code with explorer + outline visible simultaneously.

`ApplicationLayout` is that window manager, rendered in Blaze.

## Mechanism

### The template structure

```html
<template name="ApplicationLayout">
  <div class="application-containment">

    <!-- CENTER -->
    <main class="content-containment {{contentState.left}} {{contentState.right}}">
      {{> yield}}
      <back-to-top />
    </main>

    <!-- LEFT STACK -->
    {{#each leftPanels}}
      <aside class="panel-containment left {{state}}" data-id="{{id}}">
        <header class="panel-header">
          <h2>{{title}}</h2>
          <nav>{{#if canBack}}<button data-back-history />{{/if}}
               {{#if canForward}}<button data-forward-history />{{/if}}</nav>
          <button class="panel-close" data-close-panel />
        </header>
        <div class="panel-handle left" />
        {{> Template.dynamic template=template data=data}}
      </aside>
    {{/each}}

    <!-- RIGHT STACK (symmetric) -->
    {{#each rightPanels}} ... {{/each}}

  </div>
</template>
```

Three zones, all siblings in the DOM:
- **center** — route renders here via `{{> yield}}`
- **leftPanels** — reactive array; each element is an `<aside>` that slides in from the left
- **rightPanels** — reactive array; same shape, other side

### Reactive `contentState` — CSS-class space reservation

```js
Template.ApplicationLayout.helpers({
  contentState() {
    const layout = ApplicationLayout.get();
    const leftOpen  = (layout.leftPanels  || []).some(p => p.open);
    const rightOpen = (layout.rightPanels || []).some(p => p.open);
    return {
      left:  leftOpen  ? 'left-open'  : '',
      right: rightOpen ? 'right-open' : ''
    };
  },
  // ...
});
```

When a panel opens, `content-containment` gets the `left-open` or `right-open` class. CSS rules in `styles.css` respond by shrinking/shifting the center so the panel has room. Reactive, reversible, composable.

### Panel shape

Each panel is `{ id, title, template, data, open, state }`:
- `id` — unique per side; used for history keying
- `title` — header string
- `template` — template NAME to render (via `Template.dynamic`)
- `data` — data passed to the template
- `open` — whether currently visible
- `state` — CSS class (`'open'` or empty)

Pushing a panel is an ApplicationLayout API call (not documented here; see `engine.js`).

### Per-panel history

Each panel has its own history stack. The header includes back/forward buttons wired to the layout's `canGoBack/canGoForward/back/forward` API — lets you navigate WITHIN a panel without affecting the center route.

```js
canBack: ApplicationLayout.canGoBack('left', p.id),
canForward: ApplicationLayout.canGoForward('left', p.id)
```

### Events

```js
Template.ApplicationLayout.events({
  'click [data-close-panel]'(e)   { ... ApplicationLayout.close(side, id); }
  'click [data-toggle-panel]'(e)  { ... ApplicationLayout.toggle(side, id); }
  'click [data-open-panel]'(e)    { ... ApplicationLayout.open(side, id); }
  'click [data-back-history]'(e)  { ... ApplicationLayout.back(side, id); }
  'click [data-forward-history]'(e){ ... ApplicationLayout.forward(side, id); }
  'click .back-to-top'(e)         { ... panel.scrollTo({top:0, behavior:'smooth'}); }
  'keydown'(e)                    { if (e.key==='Escape' && ApplicationLayout.anyOpen()) ApplicationLayout.close(); }
});
```

Panels can be opened/closed via DOM `data-*` attributes — any template can include:
```html
<button data-open-panel data-side="right" data-id="bond-detail">Open Bond</button>
```
and the layout event delegation handles the rest.

## How to reach for it

**Wire ApplicationLayout as your router's layout template:**
```js
Router.configure({ layoutTemplate: 'ApplicationLayout' });
```

**From anywhere, open a panel:**
```js
ApplicationLayout.open('right', {
  id: 'bond-detail',
  title: 'Bond',
  template: 'BondDetail',
  data: { bondId: '...' }
});
```

**Or declaratively in templates:**
```html
<button data-open-panel data-side="right" data-id="bond-detail">Inspect bond</button>
```

**Close:**
```js
ApplicationLayout.close('right', 'bond-detail');
// or Escape key (handled globally via the layout's keydown event)
```

**Check state:**
```js
if (ApplicationLayout.anyOpen()) { ... }
```

## Bugs in the wild

- **`{{> Template.dynamic template=template data=data}}`** — the panel's template is rendered by name (string). If the template name doesn't exist, Blaze silently renders nothing (no error to console). Typos = invisible bugs. A pre-flight check that the template exists would help.
- **No panel deduplication** — calling `open('left', { id: 'foo' })` when a `left[foo]` panel is already open may stack two visually. Should be idempotent.
- **Keyboard Escape closes any panel, not just the focused one** — `keydown` handler calls `close()` with no arguments, which closes all. Ambiguous when multiple panels open on both sides. Consider scoping to the panel with focus.
- **Panel header render has title even when title is blank** — the `{{#if title}}` guard is present but some panels end up with headers just containing the close button, which looks odd. Empty-title panels should probably render without a header entirely.
- **No resize-handles on panels** — `<div class="panel-handle left">` is in the template, but the resize gesture logic is in `gestures.js` which wasn't audited here.

## Open questions

- **Named yields vs reactive panels** — Iron Router supports named yields (`this.render('X', { to: 'name' })`); `ApplicationLayout` uses reactive arrays instead. Two mental models not yet unified. A route's structural layout vs a user's transient panel-push are different intents; could coexist or one could subsume the other.
- **Canonical space reservation API** — `ApplicationLayout` uses `contentState` CSS classes; the navigation package uses `<style>` injection + navPadding div + imperative accordion width. Could unify into one `reserve/release` API.
- **Panel persistence across routes** — if user navigates from `/entity/juno` to `/entity/vulcan`, should the right-panel they had open on Juno auto-update to show Vulcan's detail? Or close? Route-coupling semantics aren't defined.
- **Mobile fold-down** — how do the three zones collapse on narrow viewports? Tabs? Stack? Accordion? No defined behavior; CSS currently best-effort.
- **leftPanels / rightPanels data source** — `ApplicationLayout.get()` is an opaque getter; is the underlying state Session-based, reactive-var-based, or its own store? Worth knowing if you want to subscribe to it from outside.

## See also

- `client/layout/templates.html` — the template (this lesson's main subject)
- `client/layout/logic.js` — the helpers + event delegation (same pattern, same lesson)
- `client/layout/engine.js` — the `ApplicationLayout.open/close/toggle/back/forward/anyOpen/canGoBack/canGoForward/get` API surface (not audited yet)
- `client/layout/history.js` — per-panel history stack
- `client/layout/gestures.js` — touch/swipe gesture handling (not audited)
- `client/layout/styles.css` — the CSS rules for `.content-containment.left-open` etc.
- Companion (navigation package): `~/.forge/packages/navigation/training/top-bar.md` — the nav that sits above this workspace
- Syllabus: `~/.koad-io/training/layout/index.md`
