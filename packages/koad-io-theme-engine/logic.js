const reaction = new ReactiveVar(0);

let theme = {
	hue: false,
	set: {
		hue: setThemeHue
	},
	darkmode: {
		toggle: toggleDarkMode
	}
};

koad.theme = theme;

Template.registerHelper('HasTheme', function() {
  return typeof koad.theme.hue == 'number';
});

function setThemeHue(hue){
	console.log({hue})
	if(typeof hue == "number") {
		koad.theme.hue = Number(hue);
		updateApplicationHue(hue);
	};
};

// Function to update the hue value
function updateHue(num) {
	if(typeof koad.theme.hue == "number"){
		console.log('hue has been set, stopping the rotator');
		clearInterval(theme.rotator);
		return;
	}
	let increment = reaction.get();
	if (increment >= 360) increment = 0;

	increment++;
	reaction.set(increment)
	updateApplicationHue(increment);
};

function updateApplicationHue(hue) {
	// Set the --application-hue variable on the root element
	document.documentElement.style.setProperty('--application-hue', hue);
	document.documentElement.style.setProperty('--text-brightness', 15);
};

function toggleDarkMode(){
	// Assuming the variable --application-hue is defined on the :root element
	const rootStyle = getComputedStyle(document.documentElement);
	const brightness = rootStyle.getPropertyValue('--application-brightness').trim();
	console.log({brightness})
	document.documentElement.style.setProperty('--application-brightness', 100 - brightness);
	document.documentElement.style.setProperty('--text-brightness', brightness);
};

Meteor.startup(()=>{
	if(!Meteor.settings?.public?.application){
		reaction.set(200)
		console.log('Application settings not quite configured,. starting the theme rotator;  use koad.theme.set.hue(212) to set the hue manually in your logic.');
		console.log('%csee https://book.koad.sh/reference/koad-io/dot-env/?h=env#json for information on setting up koad:io', 'color: red; font-size: 14px;');
		// theme.rotator = setInterval(updateHue, 1000);
	};
});
