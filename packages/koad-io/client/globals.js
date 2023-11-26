// globals.js
// no "use strict" statement here ...

allow = function() {return true;}
deny = function() {return false;}
// function Login() {return log.info(arguments)}

if(DEBUG) console.log('koad:io - DEBUG mode enabled, expect verbose output!');

tick1s = new Tracker.Dependency();
tick1m = new Tracker.Dependency();

Meteor.setInterval(function () { //Runs every 1 second.
    tick1s.changed();
    // console.log("running ticker 1s")
}, 1000);

Meteor.setInterval(function () { //Runs every 1 minute.
    tick1m.changed();
    // console.log("running ticker 1m")
}, 60 * 1000);

// Define a simpler login function, since we will use this soley as our front door.
Login = function(token){
	Meteor.loginWithToken(token);
};

Logout = function(){
	Meteor.logout();
};
