// panel/logic.js — side panel boot logic
//
// Queries the service worker for current connection tier, populates the
// workspace iframe with the daemon-interface URL when connected, or shows
// the fallback identity view when offline.
//
// Tier states follow SPEC-196 §3:
//   1 = ZeroTier daemon, 2 = public lighthouse, 3 = offline fallback.
//
// This is a thin shell. Tier detection, corpus lookups, and script execution
// state all live in the service worker; the panel just renders what it asks for.

const tierIndicator = document.querySelector('.panel-tier');
const tierLabel = document.querySelector('.panel-tier-label');
const actionable = document.querySelector('.panel-actionable');
const actionableList = document.querySelector('.panel-actionable-list');
const actionableEmpty = document.querySelector('.panel-actionable-empty');
const workspace = document.querySelector('.panel-workspace');
const frame = document.querySelector('.panel-frame');
const workspaceFallback = document.querySelector('.panel-workspace-fallback');
const openInTabBtn = document.querySelector('.panel-open-in-tab');
const fallback = document.querySelector('.panel-fallback');

let _currentWorkspaceUrl = null;

// frame-ancestors / X-Frame-Options refusals don't fire a standard error
// event — the iframe just renders blank. We detect via a timeout: if the
// iframe never reaches a non-blank state within FRAME_LOAD_TIMEOUT_MS,
// show the fallback. The frame's load event fires on both success and
// blocked-response (Chrome behavior), so we use load + a content probe.
const FRAME_LOAD_TIMEOUT_MS = 4000;
let _frameTimeoutId = null;

function showFrameFallback() {
	frame.hidden = true;
	workspaceFallback.hidden = false;
}

function showFrame() {
	frame.hidden = false;
	workspaceFallback.hidden = true;
}

frame.addEventListener('load', () => {
	// If we can read contentDocument, the frame loaded successfully.
	// If frame-ancestors blocked it, contentDocument access throws or returns
	// an about:blank document.
	if (_frameTimeoutId) {
		clearTimeout(_frameTimeoutId);
		_frameTimeoutId = null;
	}
	try {
		const doc = frame.contentDocument;
		// Blocked iframes show about:blank. A real load has a URL we can read.
		if (!doc || frame.contentWindow.location.href === 'about:blank') {
			showFrameFallback();
		} else {
			showFrame();
		}
	} catch {
		// Cross-origin success path — we can't read contentDocument, which
		// means the frame loaded a cross-origin page (good).
		showFrame();
	}
});

openInTabBtn.addEventListener('click', () => {
	if (_currentWorkspaceUrl) {
		chrome.tabs.create({ url: _currentWorkspaceUrl });
	}
});

const TIER_LABELS = {
	1: 'connected — zerotier',
	2: 'connected — lighthouse',
	3: 'offline — fallback',
	probing: 'connecting…',
};

function setTier(tier) {
	const key = String(tier);
	tierIndicator.setAttribute('data-tier', key);
	tierLabel.textContent = TIER_LABELS[key] || 'unknown';
}

function showWorkspace(daemonUrl) {
	workspace.hidden = false;
	fallback.hidden = true;
	_currentWorkspaceUrl = daemonUrl || null;
	if (daemonUrl && frame.src !== daemonUrl) {
		showFrame();  // optimistic — load handler decides if fallback needed
		if (_frameTimeoutId) clearTimeout(_frameTimeoutId);
		_frameTimeoutId = setTimeout(() => {
			// Frame never fired load — likely network unreachable for the iframe path
			showFrameFallback();
		}, FRAME_LOAD_TIMEOUT_MS);
		frame.src = daemonUrl;
	}
}

function showFallback(profile) {
	workspace.hidden = true;
	fallback.hidden = false;
	const profileEl = document.querySelector('.panel-profile');
	if (!profileEl) return;
	profileEl.innerHTML = '';
	if (!profile || Object.keys(profile).length === 0) {
		profileEl.innerHTML = '<p style="color: var(--text-dim); font-style: italic;">no cached sovereign profile yet — connect once while online to populate</p>';
		return;
	}
	const dl = document.createElement('dl');
	dl.style.cssText = 'display: grid; grid-template-columns: max-content 1fr; gap: 6px 12px; margin: 0; font-size: 12px;';
	Object.entries(profile).forEach(([k, v]) => {
		if (k === 'cachedAt') return;  // shown separately
		const dt = document.createElement('dt');
		dt.textContent = k;
		dt.style.cssText = 'color: var(--text-dim); font-weight: 600;';
		const dd = document.createElement('dd');
		dd.textContent = typeof v === 'string' ? v : JSON.stringify(v);
		dd.style.cssText = 'margin: 0; word-break: break-all;';
		dl.appendChild(dt);
		dl.appendChild(dd);
	});
	profileEl.appendChild(dl);
	if (profile.cachedAt) {
		const stamp = document.createElement('p');
		const ago = Math.round((Date.now() - profile.cachedAt) / 1000 / 60);
		stamp.textContent = `cached ${ago}m ago`;
		stamp.style.cssText = 'color: var(--text-dim); font-style: italic; font-size: 11px; margin-top: 12px;';
		profileEl.appendChild(stamp);
	}
}

function renderActionable(items) {
	if (!Array.isArray(items) || items.length === 0) {
		actionable.hidden = true;
		actionableEmpty.hidden = false;
		return;
	}
	actionable.hidden = false;
	actionableEmpty.hidden = true;
	actionableList.innerHTML = '';
	items.forEach((item) => {
		const li = document.createElement('li');
		const entity = document.createElement('span');
		entity.className = 'panel-actionable-entity';
		entity.textContent = item.entity || '?';
		const title = document.createElement('span');
		title.textContent = item.title || item.path || '(untitled)';
		const action = document.createElement('span');
		action.className = 'panel-actionable-action';
		action.textContent = item.action || '';
		li.appendChild(entity);
		li.appendChild(title);
		if (action.textContent) li.appendChild(action);
		actionableList.appendChild(li);
	});
}

async function requestPanelState() {
	try {
		const state = await chrome.runtime.sendMessage({ action: 'getPanelState' });
		if (!state || !state.ok) {
			setTier('probing');
			return;
		}
		setTier(state.tier);
		if (state.tier === 3) {
			showFallback(state.profile);
		} else {
			showWorkspace(state.daemonUrl);
		}
		renderActionable(state.actionable || []);
	} catch (err) {
		console.warn('panel: getPanelState failed', err);
		setTier('probing');
	}
}

// Listen for tier transitions and corpus updates pushed from the SW.
chrome.runtime.onMessage.addListener((message) => {
	if (!message || typeof message !== 'object') return;
	if (message.action === 'panelStateChanged') {
		requestPanelState();
	}
});

// Initial render
setTier('probing');
requestPanelState();

// Refresh when this side panel is shown again (Chrome doesn't fire focus on
// the iframe-less panel reliably; a periodic refresh keeps it honest).
setInterval(requestPanelState, 15000);
