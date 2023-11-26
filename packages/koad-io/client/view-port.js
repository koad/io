// TODO figure out how to keep track of physical screen size
// what good is 4k if it is a 6 inch device?

const DEBUG=true;
  
var screenWidth = window.screen.width; // Screen width in pixels
var screenHeight = window.screen.height; // Screen height in pixels
var devicePixelRatio = window.devicePixelRatio; // Pixel density of the device

var physicalWidth = screenWidth / (devicePixelRatio*96); // Physical width in inches
var physicalHeight = screenHeight / (devicePixelRatio*96); // Physical height in inches

if(DEBUG){
    console.log("devicePixelRatio: " + devicePixelRatio + " ");
    console.log("Screen Width: " + screenWidth + " pixels");
    console.log("Screen Height: " + screenHeight + " pixels");
    console.log("Estimated Monitor Width: " + physicalWidth + " inches");
    console.log("Estimated Monitor Height: " + physicalHeight + " inches");
}

// Check if the DeviceOrientation API is supported
if ('DeviceOrientationEvent' in window) {
    window.addEventListener('deviceorientation', handleOrientation);
} else console.log('Device orientation API is not supported on this device.');

function handleOrientation(event) {
    // Get the orientation data from the event
    const alpha = event.alpha; // Z-axis rotation (compass direction)
    
    // Determine the side of the notch based on alpha value
    let notchSide;
    if (alpha >= 45 && alpha < 135) {
        notchSide = 'Left';
    } else if (alpha >= 225 && alpha < 315) {
        notchSide = 'Right';
    } else {
        notchSide = 'Unknown';
    }

    console.log(`Notch is on the ${notchSide} side.`);
    let viewport = Session.get('viewport');
    Session.set('viewport', {...viewport, knotch: notchSide });
};

Meteor.startup(function () {

    Session.set('viewport', {
        "colorDepth": screen.colorDepth,
        "orientation": screen.orientation,
        "screen": head.screen,
        "mobile": head.mobile,
        "desktop": head.desktop,
        "touch": head.touch,
        "portrait": head.portrait,
        "landscape": head.landscape,
        "retina": head.retina,
        "transitions": head.transitions,
        "transforms": head.transforms,
        "gradients": head.gradients,
        "opacity": head.opacity,
        "multiplebgs": head.multiplebgs,
        "boxshadow": head.boxshadow,
        "borderimage": head.borderimage,
        "borderradius": head.borderradius,
        "cssreflections": head.cssreflections,
        "fontface": head.fontface,
        "rgba": head.rgba
    });
});

window.addEventListener("orientationchange", function() {
    Session.set('viewport', {
        "orientation": screen.orientation,
        "devicePixelRatio": window.devicePixelRatio,
        "screen": head.screen,
        "mobile": head.mobile,
        "desktop": head.desktop,
        "touch": head.touch,
        "portrait": head.portrait,
        "landscape": head.landscape,
        "retina": head.retina,
        "transitions": head.transitions,
        "transforms": head.transforms,
        "gradients": head.gradients,
        "opacity": head.opacity,
        "multiplebgs": head.multiplebgs,
        "boxshadow": head.boxshadow,
        "borderimage": head.borderimage,
        "borderradius": head.borderradius,
        "cssreflections": head.cssreflections,
        "fontface": head.fontface,
        "rgba": head.rgba
    });
}, false);

