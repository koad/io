console.log('loading shim: youtube.com/preview-button.js');

function addButtonsToVideos() {

	if(!document || !document.getElementById) return console.log('too early')
	const primaryContainer = document.getElementById('primary');
	if(!primaryContainer?.querySelectorAll) return console.log('none found: primaryContainer');
	const videos = primaryContainer.querySelectorAll('#contents ytd-rich-item-renderer, #contents ytd-video-renderer');
	if(!videos) return console.log('none found: videos');

	videos.forEach(video => {
		// Avoid adding multiple buttons
		if (video.querySelector('.custom-popup-button')) return;
		console.log({video})

		const button = document.createElement('button');
		button.className = 'custom-popup-button';

		button.style.backgroundColor = '#00000000';
		button.style.backgroundImage = 'url(' + chrome.runtime.getURL('icons/logo-48x.png') + ')';
		button.style.backgroundSize = 'cover'; // Adjust as necessary to fit your image
		button.style.width = '36px'; // Adjust width as necessary
		button.style.height = '36px'; // Adjust height as necessary
		button.style.border = 'none'; // Optional: removes the border
		button.style.cursor = 'pointer'; // Changes cursor on hover to indicate clickability

		button.style.position = 'absolute';
		button.style.top = '8px';
		button.style.left = '8px';
		button.style.zIndex = '1000';

		button.onclick = function () {

			this.style.animation = 'clickAnimation 0.5s ease forwards';
			// Logic to open the extension's popup
			// Since content scripts can't directly execute extension logic like opening popups,
			// you'll need to send a message to the background script.
			console.log('clickidy clickidy');

			// Extracting video ID for both regular videos and shorts
			let videoUrl = video.querySelector('a#video-title, a#thumbnail').href;
			let videoId;
			if (videoUrl.includes('/watch?v=')) {
				videoId = new URLSearchParams(new URL(videoUrl).search).get('v');
			} else if (videoUrl.includes('/shorts/')) {
				videoId = videoUrl.split('/shorts/')[1];
			}

			if(!videoId) return console.log('unable to get video id!', video);

			chrome.runtime.sendMessage({action: "sendToDaemon", videoId: videoId}, function(response) {
				console.log('Video sent to daemon');
				console.log('Response from daemon:', response);
			});
		};

		video.style.position = 'relative'; // Ensure the button positions correctly
		video.appendChild(button);
	});
}

// Run the function when the script loads
addButtonsToVideos();

// Since YouTube uses dynamic loading, set up a MutationObserver to handle new videos being loaded
const observer = new MutationObserver(mutations => {
	mutations.forEach(mutation => {
		if (mutation.addedNodes.length) {
			addButtonsToVideos();
		}
	});
});

observer.observe(document.body, { childList: true, subtree: true });

// Ensure to define this animation in your content script or load a CSS file that includes it
const style = document.createElement('style');
style.type = 'text/css';
style.innerHTML = `
@keyframes clickAnimation {
	0% { transform: scale(1); }
	50% { transform: scale(0.8); }
	100% { transform: scale(1); }
}
.custom-popup-button {
	opacity: 0.1;
}
.custom-popup-button:hover {
	opacity: 1;
}
`;
document.head.appendChild(style);
