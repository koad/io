
let tick1s = new Tracker.Dependency();
Meteor.setInterval(function () { //Runs every 1 second.
    tick1s.changed();
    // console.log("running ticker 1s")
}, 100);


let hasLoaded = false;
Template["__koad-io_style-basic-bitch_debug__"].onRendered(function () {
    if(hasLoaded) return // already loaded our function.
    hasLoaded = true;
    randomizeColors()
});




Template["__koad-io_style-basic-bitch_debug__"].helpers({
  cssVariable(variableName) {
    tick1s.depend();
    return getComputedStyle(document.documentElement).getPropertyValue(variableName); 
  }
});

let root = document.documentElement;

let hue = 0;
let brightness = 0;
let saturation = 0;
let transparency = 0;

let brightnessIncrement = 1;
let saturationIncrement = 4;
let transparencyIncrement = 10;


const randomizeColors = ()=>{



 Meteor.setInterval(()=>{
  
  if(hue == 360) hue = 0;

  let accentHue = hue+180;
  if(accentHue>360) accentHue = accentHue - 360;
  let shadowHue = hue+90;
  if(shadowHue>360) shadowHue = shadowHue - 360;
  let textHue = hue+270;
  if(textHue>360) textHue = textHue - 360;

  brightness = brightness + brightnessIncrement
  saturation = saturation + saturationIncrement
  transparency = transparency + transparencyIncrement

  if(brightness == 100 || brightness == 0) brightnessIncrement = -brightnessIncrement;
  if(saturation == 100 || saturation == 0) saturationIncrement = -saturationIncrement;
  if(transparency == 100 || transparency == 0) transparencyIncrement = -transparencyIncrement;


  root.style.setProperty('--application-hue', hue);
  root.style.setProperty('--application-hue-degrees', `${hue}deg`);

  root.style.setProperty('--accent-hue', accentHue);
  root.style.setProperty('--shadow-hue', shadowHue);
  root.style.setProperty('--text-hue', textHue);

  root.style.setProperty('--application-brightness', brightness);
  root.style.setProperty('--shadow-brightness', brightness);
  root.style.setProperty('--text-brightness', 100-brightness);
  root.style.setProperty('--accent-brightness', 100-brightness);

  root.style.setProperty('--application-saturation', saturation);
  root.style.setProperty('--shadow-saturation', saturation);
  root.style.setProperty('--text-saturation', saturation);

  root.style.setProperty('--application-transparency', transparency);
  root.style.setProperty('--shadow-transparency', transparency);
  root.style.setProperty('--accent-transparency', transparency);

  hue = hue + 1

}, 50)


};

// randomizeColors();