// var port = chrome.extension.connect();

// document.getElementById('myCustomEventDiv').addEventListener('myCustomEvent', function() {
//   console.log('asss')
//   var eventData = document.getElementById('myCustomEventDiv').innerText;
//   port.postMessage({message: "myCustomEvent", values: eventData});
// });

// document.addEventListener('click', function (event) {
// 	console.log('CKUCCKUCCKUCCKUCCKUC')
// 	console.log('CKUCCKUCCKUCCKUCCKUC')
// 	console.log('CKUCCKUCCKUCCKUCCKUC')
// 	console.log('CKUCCKUCCKUCCKUCCKUC')
// 	console.log('CKUCCKUCCKUCCKUCCKUC')
// 	console.log('CKUCCKUCCKUCCKUCCKUC')
// 	console.log('CKUCCKUCCKUCCKUCCKUC')
// 	console.log('CKUCCKUCCKUCCKUCCKUC')
// 	console.log('CKUCCKUCCKUCCKUCCKUC')
// 	console.log('CKUCCKUCCKUCCKUCCKUC')
//    event.preventDefault();
// }, {capture: true});

console.log('loaded koad:io-dark-passenger');
console.log(new Date())

// chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
//   // there are other status stages you may prefer to inject after
//   if (changeInfo.status === "complete") {
//     const url = new URL(tab.url);

//     console.log('chrome.tabs.onUpdated');
//     console.log({url});
//   }
// });

const originalAddEventListener = Document.prototype.addEventListener;
const listeners = [];

Document.prototype.addEventListener = function(type, listener, options) {
	console.log(`koad:io - ${type} listener detected!`);
    if (type === "contextmenu") {
        listeners.push({ type, listener, options });
    }
    return originalAddEventListener.apply(this, arguments);
};

// ... after some time or event, or immediately:

// for (let { type, listener, options } of listeners) {
//     document.removeEventListener(type, listener, options);
// }

//
// Delete the item when shift-clicked to it.
document.addEventListener('click', function (event) {
    if (event.ctrlKey && event.shiftKey) {
        event.preventDefault();
        event.target.remove();
    }
});

console.log('completely loaded koad:io worker')
