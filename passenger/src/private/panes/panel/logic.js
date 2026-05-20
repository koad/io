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
const fallback = document.querySelector('.panel-fallback');

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
	if (daemonUrl && frame.src !== daemonUrl) frame.src = daemonUrl;
}

function showFallback(profile) {
	workspace.hidden = true;
	fallback.hidden = false;
	const profileEl = document.querySelector('.panel-profile');
	if (profile && profileEl) {
		profileEl.innerHTML = '';
		const dl = document.createElement('dl');
		Object.entries(profile).forEach(([k, v]) => {
			const dt = document.createElement('dt');
			dt.textContent = k;
			const dd = document.createElement('dd');
			dd.textContent = typeof v === 'string' ? v : JSON.stringify(v);
			dl.appendChild(dt);
			dl.appendChild(dd);
		});
		profileEl.appendChild(dl);
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
