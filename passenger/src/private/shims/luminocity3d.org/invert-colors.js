// content.js
(function() {
    const style = document.createElement('style');
    style.innerHTML = `
        html {
            /* Invert colors */
            filter: invert(1) hue-rotate(180deg);
            /* Keep images and videos from inverting */
            background: black;
        }
        img, video {
            filter: invert(1) hue-rotate(180deg);
        }
    `;
    document.head.appendChild(style);
})();
