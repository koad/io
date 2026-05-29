ApplicationLayout.pushHistory = (side, id, state) => {
  const layout = ApplicationLayout.get();
  const panel = layout[side].find(p => p.id === id);
  if (!panel) return;

  panel.history = panel.history || [];
  panel.history.push({ ...state });
  if (panel.history.length > MAX_HISTORY) {
    panel.history.shift();
  }

  ApplicationLayout.set(layout);
};

ApplicationLayout.back = (side, id) => {
  const layout = ApplicationLayout.get();
  const panel = layout[side].find(p => p.id === id);
  if (!panel?.history?.length) return null;

  const prev = panel.history.pop();
  Object.assign(panel, prev);
  ApplicationLayout.set(layout);
  return prev;
};

ApplicationLayout.forward = (side, id) => {
  const layout = ApplicationLayout.get();
  const panel = layout[side].find(p => p.id === id);
  if (!panel?.forwardHistory?.length) return null;

  const next = panel.forwardHistory.pop();
  Object.assign(panel, next);
  ApplicationLayout.set(layout);
  return next;
};

ApplicationLayout.replaceState = (side, id, state) => {
  const layout = ApplicationLayout.get();
  const panel = layout[side].find(p => p.id === id);
  if (!panel) return;

  if (panel.history?.length) {
    panel.forwardHistory = panel.forwardHistory || [];
    panel.forwardHistory.push({ ...panel.history.pop() });
  }
  panel.history = panel.history || [];
  panel.history.push({ ...state });

  if (panel.history.length > MAX_HISTORY) {
    panel.history.shift();
  }

  ApplicationLayout.set(layout);
};

ApplicationLayout.canGoBack = (side, id) => {
  const layout = ApplicationLayout.get();
  const panel = layout[side + 'Panels']?.find(p => p.id === id);
  return panel?.history?.length > 0;
};

ApplicationLayout.canGoForward = (side, id) => {
  const layout = ApplicationLayout.get();
  const panel = layout[side + 'Panels']?.find(p => p.id === id);
  return panel?.forwardHistory?.length > 0;
};

ApplicationLayout.clearHistory = (side, id) => {
  const layout = ApplicationLayout.get();
  const panel = layout[side + 'Panels']?.find(p => p.id === id);
  if (panel) {
    panel.history = [];
    panel.forwardHistory = [];
    ApplicationLayout.set(layout);
  }
};
