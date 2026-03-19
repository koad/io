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
