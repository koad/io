ApplicationLayout = {};

const DEFAULT = {
  main: null,
  primaryNav: null,
  secondaryNav: null,
  leftPanels: [],
  rightPanels: []
};

const MAX_HISTORY = 50;
const getApp = () => Session.get('application') || {};

ApplicationLayout.get = () => {
  const app = getApp();
  return { ...DEFAULT, ...(app.layout || {}) };
};

ApplicationLayout.set = (layout) => {
  const app = getApp();
  app.layout = { ...ApplicationLayout.get(), ...layout };
  Session.set('application', app);
};

ApplicationLayout.patch = (path, value) => {
  const layout = ApplicationLayout.get();
  const keys = path.split('.');
  let obj = layout;

  while (keys.length > 1) {
    const k = keys.shift();
    if (!obj[k] || typeof obj[k] !== 'object') {
      obj[k] = {};
    }
    obj = obj[k];
  }

  obj[keys[0]] = value;
  ApplicationLayout.set(layout);
};

ApplicationLayout.toggle = (side, id) => {
  const layout = ApplicationLayout.get();
  const panels = layout[side + 'Panels'];
  const panel = panels?.find(p => p.id === id);
  if (!panel) return;
  panel.open = !panel.open;
  ApplicationLayout.set(layout);
};

ApplicationLayout.open = (side, id) => {
  const layout = ApplicationLayout.get();
  const panels = layout[side + 'Panels'];
  const panel = panels?.find(p => p.id === id);
  if (!panel) return;
  panel.open = true;
  ApplicationLayout.set(layout);
};

ApplicationLayout.close = (side, id) => {
  const layout = ApplicationLayout.get();
  if (side && id) {
    const panels = layout[side + 'Panels'];
    const panel = panels?.find(p => p.id === id);
    if (panel) {
      panel.open = false;
    }
  } else {
    layout.leftPanels?.forEach(p => p.open = false);
    layout.rightPanels?.forEach(p => p.open = false);
  }
  ApplicationLayout.set(layout);
};

ApplicationLayout.isOpen = (side, id) => {
  const layout = ApplicationLayout.get();
  const panels = layout[side + 'Panels'];
  return panels?.some(p => p.id === id && p.open) ?? false;
};

ApplicationLayout.anyOpen = () => {
  const layout = ApplicationLayout.get();
  return (layout.leftPanels?.some(p => p.open) || layout.rightPanels?.some(p => p.open)) ?? false;
};

ApplicationLayout.addPanel = (side, panel) => {
  const layout = ApplicationLayout.get();
  const panels = layout[side + 'Panels'] || [];
  if (!panels.find(p => p.id === panel.id)) {
    panels.push({ ...panel, open: false, history: [] });
    layout[side + 'Panels'] = panels;
    ApplicationLayout.set(layout);
  }
};

ApplicationLayout.removePanel = (side, id) => {
  const layout = ApplicationLayout.get();
  const panels = layout[side + 'Panels'];
  if (panels) {
    layout[side + 'Panels'] = panels.filter(p => p.id !== id);
    ApplicationLayout.set(layout);
  }
};

ApplicationLayout.updatePanel = (side, id, updates) => {
  const layout = ApplicationLayout.get();
  const panels = layout[side + 'Panels'];
  const panel = panels?.find(p => p.id === id);
  if (panel) {
    Object.assign(panel, updates);
    ApplicationLayout.set(layout);
  }
};
