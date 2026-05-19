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


