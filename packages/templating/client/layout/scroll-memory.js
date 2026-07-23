// ApplicationLayout scroll memory
//
// Blaze route transitions can replace the {{> yield}} contents without preserving
// the scroll position of the ApplicationLayout center pane. This module records
// the center pane scroll position per route and replays it after the next route's
// template has rendered.
//
// Opt out per route/template with any of:
//   Router.route('/x', { disableScrollMemory: true })
//   Router.route('/x', { scrollMemory: false })
//   Template.SomePage.disableApplicationScrollMemory = true
//   <main data-disable-scroll-memory>...</main>
//
// Opt out globally at runtime with:
//   ApplicationLayout.scrollMemory.disable()
//
// Pin to top instead of remembering scroll positions with any of:
//   ApplicationLayout.scrollMemory.pinToTop()
//   Router.route('/x', { scrollMemory: 'top' })
//   Router.route('/x', { pinScrollTop: true })
//   Template.SomePage.applicationScrollMemory = 'top'
//   Template.SomePage.pinApplicationScrollTop = true
//   <main data-scroll-memory="top">...</main>

(function () {
  const STORAGE_KEY = 'koad:io:application-layout:scroll-memory:v1';
  const DEFAULT_DURATION_MS = 210;
  const RESTORE_WAIT_MS = 1200;
  const RESTORE_TICK_MS = 80;
  const SCROLL_IDLE_MS = 120;
  const MAX_RECORDS = 80;
  const DEBUG = true;
  const LOG_PREFIX = '[ApplicationLayout.scrollMemory]';

  const state = {
    enabled: true,
    mode: 'memory',
    currentKey: null,
    currentRoute: null,
    restoreToken: 0,
    restoreTimer: null,
    saveTimer: null,
    activeAnimation: null,
    routeAutorun: null,
    attachedContainer: null,
    detachContainer: null,
  };

  function log(event, payload) {
    if (!DEBUG || typeof console === 'undefined') return;
    if (payload === undefined) {
      console.log(LOG_PREFIX, event);
    } else {
      console.log(LOG_PREFIX, event, payload);
    }
  }

  function warn(event, payload) {
    if (!DEBUG || typeof console === 'undefined') return;
    if (payload === undefined) {
      console.warn(LOG_PREFIX, event);
    } else {
      console.warn(LOG_PREFIX, event, payload);
    }
  }

  function getStore() {
    try {
      const raw = window.sessionStorage && window.sessionStorage.getItem(STORAGE_KEY);
      const store = raw ? JSON.parse(raw) : {};
      log('store:read', { keys: Object.keys(store) });
      return store;
    } catch (error) {
      warn('store:read failed', error);
      return {};
    }
  }

  function setStore(store) {
    try {
      const records = Object.entries(store)
        .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
        .slice(0, MAX_RECORDS);
      const pruned = Object.fromEntries(records);
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
      log('store:write', { keys: Object.keys(pruned), count: Object.keys(pruned).length });
    } catch (error) {
      warn('store:write failed', error);
      // Storage can fail in private contexts. Scroll memory is a convenience.
    }
  }

  function getRoute() {
    if (typeof Router === 'undefined' || !Router.current) {
      log('route:get skipped — Router unavailable');
      return null;
    }
    return Router.current();
  }

  function getRouteName(route) {
    const routeObj = route && route.route;
    if (!routeObj) return null;
    if (typeof routeObj.getName === 'function') return routeObj.getName();
    return routeObj._name || routeObj.name || null;
  }

  function getRouteTemplateName(route) {
    const routeObj = route && route.route;
    const options = routeObj && routeObj.options;
    if (!options) return null;

    const template = options.template || options.layoutTemplate;
    if (typeof template === 'string') return template;
    if (typeof template === 'function') {
      try { return template(); } catch (error) { warn('route:template function failed', error); return null; }
    }
    return null;
  }

  function getRouteKey(route) {
    if (!route) return null;

    const location = window.location || {};
    const path = `${location.pathname || '/'}${location.search || ''}`;
    const name = getRouteName(route);
    const key = name ? `route:${name}:${path}` : `path:${path}`;

    log('route:key', { name, path, key });
    return key;
  }

  function routeOptions(route) {
    return route && route.route && route.route.options;
  }

  function routeDisablesScrollMemory(route) {
    const options = routeOptions(route);
    if (!options) return false;

    const disabled = options.disableScrollMemory === true || options.scrollMemory === false;
    if (disabled) log('skip:route option disabled scroll memory', { options });
    return disabled;
  }

  function routePinsScrollTop(route) {
    const options = routeOptions(route);
    if (!options) return false;

    const pinned = options.pinScrollTop === true ||
      options.applicationScrollMemory === 'top' ||
      options.scrollMemory === 'top' ||
      options.scrollMemoryMode === 'top';

    if (pinned) log('mode:route pins scroll top', { options });
    return pinned;
  }

  function templateDisablesScrollMemory(route) {
    const templateName = getRouteTemplateName(route);
    if (!templateName || typeof Template === 'undefined') return false;

    const template = Template[templateName];
    const disabled = !!(
      template && (
        template.disableApplicationScrollMemory === true ||
        template.scrollMemory === false ||
        template.applicationScrollMemory === false
      )
    );

    if (disabled) log('skip:template disabled scroll memory', { templateName });
    return disabled;
  }

  function templatePinsScrollTop(route) {
    const templateName = getRouteTemplateName(route);
    if (!templateName || typeof Template === 'undefined') return false;

    const template = Template[templateName];
    const pinned = !!(
      template && (
        template.pinApplicationScrollTop === true ||
        template.applicationScrollMemory === 'top' ||
        template.scrollMemory === 'top' ||
        template.scrollMemoryMode === 'top'
      )
    );

    if (pinned) log('mode:template pins scroll top', { templateName });
    return pinned;
  }

  function domDisablesScrollMemory(container) {
    const disabled = !!(
      container && (
        container.hasAttribute('data-disable-scroll-memory') ||
        container.querySelector('[data-disable-scroll-memory]')
      )
    );

    if (disabled) log('skip:dom disabled scroll memory');
    return disabled;
  }

  function domPinsScrollTop(container) {
    const target = container && (
      container.hasAttribute('data-pin-scroll-top') ? container :
        container.querySelector('[data-pin-scroll-top], [data-scroll-memory="top"]')
    );

    const pinned = !!(
      target ||
      (container && container.getAttribute('data-scroll-memory') === 'top')
    );

    if (pinned) log('mode:dom pins scroll top');
    return pinned;
  }

  function shouldSkip(container, route) {
    const disabled = !state.enabled;
    if (disabled) log('skip:globally disabled');

    const skip = disabled ||
      routeDisablesScrollMemory(route) ||
      templateDisablesScrollMemory(route) ||
      domDisablesScrollMemory(container);

    if (skip) log('skip:yes', { key: state.currentKey });
    return skip;
  }

  function pinsScrollTop(container, route) {
    const pinned = state.mode === 'top' ||
      routePinsScrollTop(route) ||
      templatePinsScrollTop(route) ||
      domPinsScrollTop(container);

    if (pinned) log('mode:pin-to-top active', { mode: state.mode, key: state.currentKey });
    return pinned;
  }

  function getContainer() {
    const selectors = [
      '.application-containment > .content-containment',
      '.application-containment .content-containment',
      'main.content-containment',
      '.content-containment',
    ];

    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container) {
        log('container:found', { selector });
        return container;
      }
    }

    const route = getRoute();
    const routeOptions = route && route.route && route.route.options;
    log('container:not found', {
      readyState: document.readyState,
      hasApplicationContainment: !!document.querySelector('.application-containment'),
      contentContainmentCount: document.querySelectorAll('.content-containment').length,
      applicationLayoutRendered: !!document.querySelector('.application-containment'),
      routeName: getRouteName(route),
      routeTemplate: getRouteTemplateName(route),
      routeLayoutTemplate: routeOptions && routeOptions.layoutTemplate,
      bodyClass: document.body && document.body.className,
    });
    return null;
  }

  function readScroll(container) {
    if (!container) return null;
    const scroll = {
      top: Math.max(0, Math.round(container.scrollTop || 0)),
      left: Math.max(0, Math.round(container.scrollLeft || 0)),
      height: Math.max(0, Math.round(container.scrollHeight || 0)),
      clientHeight: Math.max(0, Math.round(container.clientHeight || 0)),
      at: Date.now(),
    };
    log('scroll:read', scroll);
    return scroll;
  }

  function saveScroll(key, container, reason = 'manual', route = getRoute()) {
    log('save:begin', { key, reason });

    if (!key) {
      log('save:abort — no key');
      return;
    }
    if (!container) {
      log('save:abort — no container');
      return;
    }

    if (shouldSkip(container, route)) {
      log('save:skip', { key, reason });
      return;
    }
    if (pinsScrollTop(container, route)) {
      log('save:skip — pin-to-top mode', { key, reason });
      return;
    }

    const scroll = readScroll(container);
    if (!scroll) {
      log('save:abort — read returned null', { key, reason });
      return;
    }

    const store = getStore();
    store[key] = scroll;
    setStore(store);
    log('save:complete', { key, reason, scroll });
  }

  function scheduleSave(key, container) {
    log('save:schedule requested', {
      key,
      hasContainer: !!container,
      animationActive: !!state.activeAnimation,
    });

    if (!key || !container || state.activeAnimation) {
      log('save:schedule skipped', {
        noKey: !key,
        noContainer: !container,
        animationActive: !!state.activeAnimation,
      });
      return;
    }

    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(() => saveScroll(key, container, 'scroll-idle'), SCROLL_IDLE_MS);
  }

  function getStoredScroll(key) {
    if (!key) return null;
    const store = getStore();
    const stored = store[key] || null;
    log('restore:lookup', { key, found: !!stored, stored });
    return stored;
  }

  function clampTarget(container, scroll) {
    if (!container || !scroll) return 0;
    const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
    const target = Math.max(0, Math.min(scroll.top || 0, maxTop));
    log('restore:clamp-target', {
      requestedTop: scroll.top,
      maxTop,
      target,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    });
    return target;
  }

  function cancelAnimation(reason = 'unspecified') {
    if (state.activeAnimation) {
      log('animation:cancel', { reason });
      window.cancelAnimationFrame(state.activeAnimation.frame);
      state.activeAnimation = null;
    }
  }

  function animateLinear(container, targetTop, durationMs) {
    cancelAnimation('new animation starting');

    const startTop = container.scrollTop || 0;
    const distance = targetTop - startTop;

    log('animation:start', { startTop, targetTop, distance, durationMs });

    if (Math.abs(distance) < 2) {
      container.scrollTop = targetTop;
      log('animation:instant-complete', { targetTop });
      return;
    }

    const startedAt = performance.now();
    const animation = { frame: null, startedAt, startTop, targetTop };
    state.activeAnimation = animation;

    function step(now) {
      if (state.activeAnimation !== animation) {
        log('animation:step ignored — stale animation');
        return;
      }

      const elapsed = now - startedAt;
      const progress = Math.min(1, elapsed / durationMs);
      container.scrollTop = startTop + (distance * progress);

      log('animation:step', {
        elapsed: Math.round(elapsed),
        progress: Number(progress.toFixed(3)),
        scrollTop: Math.round(container.scrollTop || 0),
        targetTop,
      });

      if (progress < 1) {
        animation.frame = window.requestAnimationFrame(step);
      } else {
        container.scrollTop = targetTop;
        state.activeAnimation = null;
        log('animation:complete', { targetTop });
      }
    }

    animation.frame = window.requestAnimationFrame(step);
  }

  function restoreWhenReady(key, route) {
    const token = ++state.restoreToken;
    const startedAt = Date.now();
    let targetScroll = null;
    let targetSource = null;

    log('restore:begin', { key, token });

    window.clearTimeout(state.restoreTimer);
    cancelAnimation('restore begin');

    function attempt() {
      if (token !== state.restoreToken) {
        log('restore:attempt ignored — stale token', { token, currentToken: state.restoreToken });
        return;
      }

      const container = getContainer();
      const waitedMs = Date.now() - startedAt;
      const waitedEnough = waitedMs >= RESTORE_WAIT_MS;

      if (!container) {
        log('restore:attempt waiting — no container', { key, token, waitedMs, waitedEnough });
        if (!waitedEnough) {
          state.restoreTimer = window.setTimeout(attempt, RESTORE_TICK_MS);
        } else {
          log('restore:aborted — no container after wait', { key, token, waitedMs });
        }
        return;
      }

      if (shouldSkip(container, route)) {
        log('restore:attempt skipped by opt-out', { key, token });
        return;
      }

      if (!targetScroll) {
        if (pinsScrollTop(container, route)) {
          targetScroll = { top: 0, left: 0, height: 0, at: Date.now(), reason: 'pin-to-top' };
          targetSource = 'pin-to-top';
        } else {
          const stored = getStoredScroll(key);
          targetScroll = stored || { top: 0, left: 0, height: 0, at: Date.now(), reason: 'no previous memory' };
          targetSource = stored ? 'memory' : 'default-top';
        }
        log('restore:target', { key, token, targetSource, targetScroll });
      }

      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const canReachTarget = maxTop >= Math.min(targetScroll.top, Math.max(0, targetScroll.height - 1));
      log('restore:attempt', {
        key,
        token,
        targetTop: targetScroll.top,
        maxTop,
        canReachTarget,
        waitedMs,
        waitedEnough,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
        currentTop: container.scrollTop,
      });

      if (targetScroll.top === 0 || canReachTarget || waitedEnough) {
        const targetTop = clampTarget(container, targetScroll);
        log('restore:ready — animating', { key, token, targetTop });
        animateLinear(container, targetTop, DEFAULT_DURATION_MS);
        return;
      }

      state.restoreTimer = window.setTimeout(attempt, RESTORE_TICK_MS);
    }

    Tracker.afterFlush(() => {
      log('restore:afterFlush', { key, token });
      window.requestAnimationFrame(() => {
        log('restore:requestAnimationFrame', { key, token });
        attempt();
      });
    });
  }

  function onRouteChanged(route) {
    log('onRouteChanged');

    const nextKey = getRouteKey(route);
    if (!nextKey) {
      log('route:change ignored — no next key');
      return;
    }
    if (nextKey === state.currentKey) {
      log('route:change ignored — same key', { key: nextKey });
      return;
    }

    const previousKey = state.currentKey;
    const container = getContainer();

    log('route:change', { previousKey, nextKey, hasContainer: !!container });

    if (previousKey && container) {
      saveScroll(previousKey, container, 'route-change-before-switch', state.currentRoute);
    }

    state.currentKey = nextKey;
    state.currentRoute = route;
    restoreWhenReady(state.currentKey, route);
  }

  function attach(container) {
    log('attach', { hasContainer: !!container });

    if (!container) return;
    if (state.attachedContainer === container) {
      log('attach:skipped — already attached');
      return;
    }

    if (typeof state.detachContainer === 'function') {
      state.detachContainer('reattach');
    }

    const onScroll = () => {
      log('event:scroll', {
        key: state.currentKey,
        top: Math.round(container.scrollTop || 0),
        height: Math.round(container.scrollHeight || 0),
        clientHeight: Math.round(container.clientHeight || 0),
      });
      scheduleSave(state.currentKey, container);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    log('attach:scroll listener installed');

    state.attachedContainer = container;
    state.detachContainer = (reason = 'detach') => {
      log('destroy:cleanup begin', { key: state.currentKey, reason });
      container.removeEventListener('scroll', onScroll);
      saveScroll(state.currentKey, container, 'destroy-cleanup');
      window.clearTimeout(state.saveTimer);
      window.clearTimeout(state.restoreTimer);
      cancelAnimation('destroy cleanup');
      if (state.attachedContainer === container) state.attachedContainer = null;
      if (state.detachContainer) state.detachContainer = null;
      log('destroy:cleanup complete');
    };
  }

  function startRouteAutorun() {
    if (state.routeAutorun) {
      log('route:autorun skipped — already started');
      return;
    }

    if (typeof Tracker === 'undefined') {
      warn('route:autorun unavailable — Tracker missing');
      return;
    }

    log('route:autorun start');
    state.routeAutorun = Tracker.autorun(() => {
      log('route:autorun fired');
      attach(getContainer());

      const route = getRoute();
      if (!route) {
        log('autorun:no route yet');
        return;
      }
      onRouteChanged(route);
    });
  }

  ApplicationLayout.scrollMemory = {
    enable() { state.enabled = true; log('api:enable'); },
    disable() { state.enabled = false; log('api:disable'); },
    pinToTop() { state.mode = 'top'; log('api:pinToTop'); },
    remember() { state.mode = 'memory'; log('api:remember'); },
    mode(nextMode) {
      if (nextMode === 'top' || nextMode === 'memory') {
        state.mode = nextMode;
        log('api:mode', { mode: state.mode });
      }
      return state.mode;
    },
    clear() { setStore({}); log('api:clear'); },
    save() { log('api:save'); saveScroll(state.currentKey, getContainer(), 'api-save', state.currentRoute); },
    restore() { log('api:restore'); restoreWhenReady(state.currentKey, getRoute()); },
  };

  log('module:loaded');

  if (typeof Template !== 'undefined' && Template.ApplicationLayout) {
    Template.ApplicationLayout.onRendered(function () {
      log('template:onRendered');
      attach(this.find('.content-containment'));
      startRouteAutorun();
    });

    Template.ApplicationLayout.onDestroyed(function () {
      log('template:onDestroyed');
      if (typeof state.detachContainer === 'function') {
        state.detachContainer('template destroyed');
      }
      if (state.routeAutorun) {
        state.routeAutorun.stop();
        state.routeAutorun = null;
        log('route:autorun stopped');
      }
    });
  } else {
    warn('template:ApplicationLayout unavailable — scroll memory inactive until ApplicationLayout is available');
  }
}());
