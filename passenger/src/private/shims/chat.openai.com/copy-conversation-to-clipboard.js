const mutatableSelector = 'main';
const buttonBoxSelector = 'div.flex.gap-2.pr-1'; 
const conversationSelector = 'div.flex.flex-col.text-sm.pb-9';
const userQuerySelector = 'div.flex.flex-grow.flex-col.max-w-full';
const gptVersionSelector = 'div.flex.items-center.gap-2'

function parseConversation() {
	const messages = [];
	const conversationContainer = document.querySelector(conversationSelector);
	if(!conversationContainer) return 'passenger: conversation container not found bro'
	const messageElements = conversationContainer.querySelectorAll('.text-token-text-primary');
 	let messageIncrement = 0;

	messageElements.forEach((messageElement) => {
		let  message

		let speaker;
		// Check if the message was sent by the user
		const userAvatar = messageElement.querySelector('img[alt="User"]');
		if (userAvatar) {
			speaker = 'User';
			message = messageElement.querySelector(userQuerySelector).textContent
		  } else {

		  	const gptAvatar = messageElement.querySelector('svg');
		  	console.log({gptAvatar})
		  	if (gptAvatar) {
		  		speaker = 'GPT';
		  		const messageContainer = messageElement.querySelector('div.markdown');
					message = messageContainer ? messageContainer.innerHTML : ""; // Use innerHTML to get the markdown
				}
			}

			console.log({speaker, message});

		// Construct message object and add it to the messages array
		if (speaker) {
			messages.push({
				speaker,
				message
			});
		}
	});

	// Optionally, convert messages to JSON or handle as needed
	return messages;
}


function addSaveButton(targetDiv) {

	const existingButton = targetDiv.querySelector('.save-conversation-button');
	if (existingButton) return;

	const buttonBox = targetDiv.querySelector(buttonBoxSelector);
	if (!buttonBox) return;

	const saveButton = document.createElement('button');
	saveButton.classList.add(
		'btn', 'relative', 'btn-neutral', 'btn-small', 
		'flex', 'h-9', 'w-9', 'items-center', 'justify-center', 
		'whitespace-nowrap', 'rounded-lg', 'save-conversation-button'
	);
	saveButton.style.backgroundImage = `url('${chrome.runtime.getURL("icons/logo-48x.png")}')`;
	saveButton.title = 'Save Conversation';

	const styleElement = document.createElement('style');
	styleElement.textContent = `
		.save-conversation-button {
			background-repeat: no-repeat;
			background-size: contain;
			border-radius: 50%;
			opacity: 0.1;
			border: none;
			cursor: pointer;
			transition: opacity 0.3s;
		}

		.save-conversation-button:hover {
			opacity: 0.6;
		}
	`;
	document.head.appendChild(styleElement);
	buttonBox.insertBefore(saveButton, buttonBox.firstChild);
	saveButton.addEventListener('click', () => {
		console.log('passenger: attempting to copy to clipboard button added to conversation');

		const version = targetDiv.querySelector(gptVersionSelector).textContent;
		const conversation = parseConversation();
		const payload = {
			asof: new Date(),
			title: document.title,
			url: window.location.href,
			version, conversation
		}

		navigator.clipboard.writeText(JSON.stringify(payload, null, 3))
		.then(() => console.log('passenger: conversation saved to clipboard!'))
		.catch(err => console.error('passenger: failed to copy conversation:', err));

	});
}

function waitForContainerAndObserve() {
	console.log('passenger: waiting for container');
	const checkInterval = setInterval(() => {
		const parentContainer = document.querySelector(mutatableSelector);
		if (parentContainer) {
			clearInterval(checkInterval);
			console.log('passenger: loading mutation observer');
			addSaveButton(parentContainer);
			const observer = new MutationObserver((mutations) => {
				console.log('passenger: mutation observed');
				mutations.forEach((mutation) => {
					mutation.addedNodes.forEach((node) => {
							console.log('passenger: mutation node type:', node.nodeType);
						if (node.nodeType === 1) addSaveButton(node);
					});
				});
			});
			observer.observe(parentContainer, { childList: true, subtree: true });
		}
	}, 1000);
}

if (document.readyState === "loading") {
	window.addEventListener('DOMContentLoaded', waitForContainerAndObserve);
} else {
	waitForContainerAndObserve();
}

console.log('passenger: loaded shims/chat.openai.com/copy-conversation-to-clipboard.js');
