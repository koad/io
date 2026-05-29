// PRIMER: ApplicationLayout reactive state + event delegation
//
// Pairs with templates.html to make the three-zone workspace reactive.
// Two responsibilities here:
//
// 1. REACTIVE HELPERS
//    - contentState()  : derives {left: 'left-open'|'', right: ...}
//                        from whichever panels are open; the template
//                        applies these as CSS classes on content-containment
//                        so the center shrinks/shifts
//    - leftPanels() / rightPanels() : map raw panel data to render-ready
//                                     shape (state + canBack + canForward)
//    - primaryNav / secondaryNav / mainContent : pass-throughs from
//      ApplicationLayout.get() — legacy-feeling but still referenced
//
// 2. EVENT DELEGATION (data-* driven)
//    Any template under the layout can trigger panel actions by adding
//    data attributes to a button/link:
//      [data-close-panel]    → close panel containing this element
//      [data-toggle-panel]   → toggle panel with data-side+data-id
//      [data-open-panel]     → open   panel with data-side+data-id
//      [data-back-history]   → per-panel back
//      [data-forward-history]→ per-panel forward
//      .back-to-top          → scroll containing panel/main to top
//    Plus a global Escape keydown → close all panels if any open.
//
// ApplicationLayout.{get,open,close,toggle,back,forward,canGoBack,
// canGoForward,anyOpen} are defined in engine.js (not primered here yet).
//
// BUGS IN THE WILD:
//   - Escape closes everything, not the focused panel only
//   - side detection relies on classList.contains('left') — if a panel
//     has both classes (shouldn't happen but isn't asserted), it returns
//     'right' because falsy check first
//   - primaryNav/secondaryNav/mainContent helpers exist but aren't used
//     in templates.html — dead code candidates for the next sweep
//   - No error path if ApplicationLayout.get() throws or returns null
//
// OPEN QUESTIONS:
//   - Should Template.ApplicationLayout.events live in a separate
//     events.js to mirror templates/logic split elsewhere in the kingdom?
//   - contentState only reads left+right; if a panel has state 'minimized'
//     or 'pinned', the space reservation doesn't reflect that
//
// See also:
//   - templates.html (the DOM this logic drives)
//   - engine.js (the ApplicationLayout API surface)
//   - ./application-layout.md (draft full-length lesson)

Template.ApplicationLayout.helpers({
  contentState() {
    const layout = ApplicationLayout.get();
    const leftOpen = (layout.leftPanels || []).some(p => p.open);
    const rightOpen = (layout.rightPanels || []).some(p => p.open);
    return {
      left: leftOpen ? 'left-open' : '',
      right: rightOpen ? 'right-open' : ''
    };
  },

  leftPanels() {
    return (ApplicationLayout.get().leftPanels || []).map(p => ({
      ...p,
      state: p.open ? 'open' : '',
      canBack: ApplicationLayout.canGoBack('left', p.id),
      canForward: ApplicationLayout.canGoForward('left', p.id)
    }));
  },

  rightPanels() {
    return (ApplicationLayout.get().rightPanels || []).map(p => ({
      ...p,
      state: p.open ? 'open' : '',
      canBack: ApplicationLayout.canGoBack('right', p.id),
      canForward: ApplicationLayout.canGoForward('right', p.id)
    }));
  },

  primaryNav() {
    return ApplicationLayout.get().primaryNav;
  },

  secondaryNav() {
    return ApplicationLayout.get().secondaryNav;
  },

  mainContent() {
    return ApplicationLayout.get().main;
  }
});

Template.ApplicationLayout.events({
  'click .back-to-top'(e) {
    e.preventDefault();
    const panel = e.currentTarget.closest('.panel-containment, .content-containment');
    if (panel) {
      panel.scrollTo({ top: 0, behavior: 'smooth' });
    }
  },

  'click [data-close-panel]'(e) {
    e.preventDefault();
    const panel = e.currentTarget.closest('.panel-containment');
    if (panel) {
      const id = panel.dataset.id;
      const side = panel.classList.contains('left') ? 'left' : 'right';
      ApplicationLayout.close(side, id);
    }
  },

  'click [data-toggle-panel]'(e) {
    e.preventDefault();
    const { side, id } = e.currentTarget.dataset;
    if (side && id) {
      ApplicationLayout.toggle(side, id);
    }
  },

  'click [data-open-panel]'(e) {
    e.preventDefault();
    const { side, id } = e.currentTarget.dataset;
    if (side && id) {
      ApplicationLayout.open(side, id);
    }
  },

  'click [data-back-history]'(e) {
    e.preventDefault();
    const panel = e.currentTarget.closest('.panel-containment');
    if (panel) {
      const side = panel.classList.contains('left') ? 'left' : 'right';
      ApplicationLayout.back(side, panel.dataset.id);
    }
  },

  'click [data-forward-history]'(e) {
    e.preventDefault();
    const panel = e.currentTarget.closest('.panel-containment');
    if (panel) {
      const side = panel.classList.contains('left') ? 'left' : 'right';
      ApplicationLayout.forward(side, panel.dataset.id);
    }
  },

  'keydown'(e) {
    if (e.key === 'Escape' && ApplicationLayout.anyOpen()) {
      ApplicationLayout.close();
    }
  }
});
