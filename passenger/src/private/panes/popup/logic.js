const subtitle = document.getElementsByClassName("card-subtitle")[0];

const createWord = (text, index) => {
  const word = document.createElement("span");

  word.innerHTML = `${text} `;

  word.classList.add("card-subtitle-word");

  word.style.transitionDelay = `${index * 40}ms`;

  return word;
}

const addWord = (text, index) => subtitle.appendChild(createWord(text, index));

const createSubtitle = text => text.split(" ").map(addWord);
console.log('creating words')
createSubtitle("Dark Passenger");

// SPEC-196 — connection tier + HUD counts.
// Popup is read-only (SPEC-196 §2.). Side panel is the workspace.

const TIER_LABELS = {
  1: 'connected — zerotier',
  2: 'connected — lighthouse',
  3: 'offline — fallback',
  probing: 'connecting…',
};

const tierEl = document.querySelector('.card-tier');
const tierLabelEl = document.querySelector('.card-tier-label');
const corpusCountEl = document.querySelector('.card-corpus-count');
const scriptsCountEl = document.querySelector('.card-scripts-count');
const activeTabEl = document.querySelector('.card-active-tab');

function renderState(state) {
  if (!state || !state.ok) {
    tierEl.setAttribute('data-tier', 'probing');
    tierLabelEl.textContent = TIER_LABELS.probing;
    return;
  }
  const key = String(state.tier);
  tierEl.setAttribute('data-tier', key);
  tierLabelEl.textContent = TIER_LABELS[key] || 'unknown';
  corpusCountEl.textContent = String((state.actionable || []).length);
  // Scripts count is wired once the script registry is exposed (SPEC-196 §9).
  scriptsCountEl.textContent = '0';
  if (state.activeTab && state.activeTab.url) {
    try {
      const u = new URL(state.activeTab.url);
      activeTabEl.textContent = u.hostname + u.pathname;
    } catch {
      activeTabEl.textContent = state.activeTab.url;
    }
  } else {
    activeTabEl.textContent = '';
  }
}

async function refresh() {
  try {
    const state = await chrome.runtime.sendMessage({ action: 'getPanelState' });
    renderState(state);
  } catch (err) {
    console.warn('popup: getPanelState failed', err);
    renderState(null);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.action === 'panelStateChanged') refresh();
});

refresh();



let btt = document.querySelector(".btn-configure-application");
btt.addEventListener("click", () => {
  console.log('showOptions')
    chrome.runtime.sendMessage({ action: "showOptions"});
});

document.querySelector(".btn-grab-tabs").addEventListener('click', () => {
    console.log('grabTabs')
    chrome.runtime.sendMessage({ action: "getTabs" }, (response) => {
        const markdownLinks = response.map(tab => `[${tab.title}](${tab.url})`).join('\n');
        navigator.clipboard.writeText(markdownLinks).then(() => {
            console.log('Tab list copied to clipboard');
            window.close(); // Close the popup
        }).catch(err => {
            console.error('Could not copy text: ', err);
        });
    });
});

document.querySelector(".btn-copy-tab").addEventListener('click', () => {
    console.log('copyTab')
    chrome.runtime.sendMessage({ action: "getCurrentTab" }, (response) => {
        const markdownLink = `[${response.title}](${response.url})`;
        navigator.clipboard.writeText(markdownLink).then(() => {
            console.log('Current tab copied to clipboard');
            window.close(); // Close the popup
        }).catch(err => {
            console.error('Could not copy text: ', err);
        });
    });
});

document.querySelector(".btn-discard-tabs").addEventListener('click', () => {
    console.log('discardTabs')
    chrome.runtime.sendMessage({ action: "discardTabs" }, (response) => {
        console.log('Tabs discarded:', response.count);
        window.close();
    });
});


