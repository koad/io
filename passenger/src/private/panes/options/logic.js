// options/logic.js
//
// Settings page for the Dark Passenger.
//
// Reads/writes chrome.storage.local for tier configuration + workspaceUrl,
// chrome.storage.session for the MCP token (visible read-only),
// invokes SW for tier re-probe and token rotation.

const els = {
	tierDot:        document.querySelector('.options-tier-dot'),
	tierLabel:      document.querySelector('.options-tier-label'),
	reprobeBtn:     document.querySelector('.options-reprobe'),

	tier1Host:      document.querySelector('input[name="tier1-host"]'),
	tier1Port:      document.querySelector('input[name="tier1-port"]'),
	tier1Proto:     document.querySelector('select[name="tier1-proto"]'),
	tier2Host:      document.querySelector('input[name="tier2-host"]'),
	tier2Port:      document.querySelector('input[name="tier2-port"]'),
	tier2Proto:     document.querySelector('select[name="tier2-proto"]'),
	workspaceUrl:   document.querySelector('input[name="workspace-url"]'),

	profileBox:     document.querySelector('.options-profile'),
	tokenDisplay:   document.querySelector('.options-token-display'),
	rotateBtn:      document.querySelector('.options-token-rotate'),

	saveBtn:        document.querySelector('.options-save'),
	saveStatus:     document.querySelector('.options-save-status'),
};

const TIER_LABELS = {
	1: 'connected — zerotier (tier 1)',
	2: 'connected — lighthouse (tier 2)',
	3: 'offline — fallback (tier 3)',
	probing: 'probing…',
};

// --- Load stored settings into the form ---

async function loadSettings() {
	const stored = await chrome.storage.local.get(['tier1', 'tier2', 'workspaceUrl', 'sovereignProfile']);

	const t1 = stored.tier1 || {};
	els.tier1Host.value = t1.host || '';
	els.tier1Port.value = t1.port || '';
	els.tier1Proto.value = t1.proto || 'http';

	const t2 = stored.tier2 || {};
	els.tier2Host.value = t2.host || '';
	els.tier2Port.value = t2.port || '';
	els.tier2Proto.value = t2.proto || 'https';

	els.workspaceUrl.value = stored.workspaceUrl || '';

	renderProfile(stored.sovereignProfile);
}

function renderProfile(profile) {
	els.profileBox.innerHTML = '';
	if (!profile || Object.keys(profile).length === 0) {
		const p = document.createElement('p');
		p.className = 'options-profile-empty';
		p.textContent = 'No cached sovereign profile.';
		els.profileBox.appendChild(p);
		return;
	}
	const dl = document.createElement('dl');
	Object.entries(profile).forEach(([k, v]) => {
		if (k === 'cachedAt') return;
		const dt = document.createElement('dt');
		dt.textContent = k;
		const dd = document.createElement('dd');
		dd.textContent = typeof v === 'string' ? v : JSON.stringify(v);
		dl.appendChild(dt);
		dl.appendChild(dd);
	});
	els.profileBox.appendChild(dl);
	if (profile.cachedAt) {
		const stamp = document.createElement('p');
		stamp.className = 'options-hint';
		const ago = Math.round((Date.now() - profile.cachedAt) / 1000 / 60);
		stamp.textContent = `cached ${ago} minutes ago`;
		els.profileBox.appendChild(stamp);
	}
}

// --- Tier indicator ---

async function refreshTierIndicator() {
	try {
		const state = await chrome.runtime.sendMessage({ action: 'getPanelState' });
		if (state && state.ok) {
			const key = String(state.tier);
			els.tierDot.setAttribute('data-tier', key);
			els.tierLabel.textContent = TIER_LABELS[key] || 'unknown';
		} else {
			els.tierDot.setAttribute('data-tier', 'probing');
			els.tierLabel.textContent = TIER_LABELS.probing;
		}
	} catch {
		els.tierDot.setAttribute('data-tier', 'probing');
		els.tierLabel.textContent = TIER_LABELS.probing;
	}
}

// --- Token display ---

async function refreshToken() {
	const stored = await chrome.storage.session.get('mcpSessionToken');
	els.tokenDisplay.textContent = stored.mcpSessionToken || '(none)';
}

// --- Save ---

async function save() {
	const tier1 = {
		host:  els.tier1Host.value.trim() || '10.10.10.10',
		port:  parseInt(els.tier1Port.value, 10) || 28282,
		proto: els.tier1Proto.value || 'http',
	};
	const tier2Host = els.tier2Host.value.trim();
	const tier2 = tier2Host ? {
		host:  tier2Host,
		port:  els.tier2Port.value ? parseInt(els.tier2Port.value, 10) : null,
		proto: els.tier2Proto.value || 'https',
	} : null;
	const workspaceUrl = els.workspaceUrl.value.trim() || null;

	const patch = { tier1 };
	if (tier2) patch.tier2 = tier2;
	else patch.tier2 = null;
	if (workspaceUrl) patch.workspaceUrl = workspaceUrl;
	else patch.workspaceUrl = null;

	await chrome.storage.local.set(patch);
	els.saveStatus.textContent = 'saved — re-probing…';
	// Tell the SW to re-probe immediately so the new config takes effect.
	await chrome.runtime.sendMessage({ action: 'reprobeTier' }).catch(() => {});
	setTimeout(() => {
		els.saveStatus.textContent = '';
		refreshTierIndicator();
	}, 1500);
}

// --- Wire up listeners ---

els.saveBtn.addEventListener('click', save);

els.reprobeBtn.addEventListener('click', async () => {
	els.tierDot.setAttribute('data-tier', 'probing');
	els.tierLabel.textContent = TIER_LABELS.probing;
	await chrome.runtime.sendMessage({ action: 'reprobeTier' }).catch(() => {});
	setTimeout(refreshTierIndicator, 1500);
});

els.rotateBtn.addEventListener('click', async () => {
	await chrome.runtime.sendMessage({ action: 'rotateToken' }).catch(() => {});
	refreshToken();
});

chrome.runtime.onMessage.addListener((msg) => {
	if (msg && msg.action === 'panelStateChanged') {
		refreshTierIndicator();
		loadSettings();  // re-render profile if cache updated
	}
});

// Initial load
loadSettings();
refreshTierIndicator();
refreshToken();
setInterval(refreshTierIndicator, 15000);
