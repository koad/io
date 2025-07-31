import { Accounts } from 'meteor/accounts-base';

tick1s = new Tracker.Dependency();
tick1m = new Tracker.Dependency();

debug = function (){
    return false;
};

const querystring = function() {
    var k, pair, qs, v, _i, _len, _ref, _ref1;
    qs = {};
    _ref = window.location.search.replace("?", "").split("&");
    for (_i = 0, _len = _ref.length; _i < _len; _i++) {
        pair = _ref[_i];
        _ref1 = pair.split("="), k = _ref1[0], v = _ref1[1];
        qs[k] = v;
    }
    return qs;
};

Meteor.startup(function () {
    if(DEBUG) console.log('application started');
    Session.set('established', undefined);

    var qs = querystring();
    if(qs.popup) Session.set('popup', true);

    var session = { features: {}, client: {
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
        "rgba": head.rgba,
        "memory": window.performance.memory
    }};

    Tracker.autorun(function () {
        if(DEBUG) console.log('dataport tracker running');
        if (Meteor.status().connected) {

            if(Session.get('activeHandshake'))return; // console.log('handshaking in progress!');

            if (Meteor.connection?._lastSessionId != Session.get('activeSession')?._id){ // and ID is different than current
                if(DEBUG) console.log('new connection detected')
                Session.set('established', undefined);  // withdraw valid connection flag
            }

            if(Session.get('established') == undefined) { 

                if(DEBUG) console.log('attempting to initalize dataport')
                Session.set('established', false);

                // If an earlier session is detected, orphan it
                if(Session.get('activeSession')) {
                    session.lastSession = Session.get('activeSession')._id
                    Session.set('activeSession', undefined);
                };
            };

            if ('windowControlsOverlay' in navigator) session.features.windowControlsOverlay = true;



            if(Session.get('activeSession')){
                if(DEBUG) console.log('session already active!')
            } else {
                Session.set('activeHandshake', true);
                if(DEBUG) console.log('handshaking with server');

                Meteor.callAsync('enable.connection', session).then((res) => {
                    if(DEBUG) console.log({res})
                    Session.set('activeHandshake', undefined);
                    Session.set('established', true);
                    Session.setPersistent('activeSession', res);
                    if(DEBUG) console.log('dataport connection to server established');
                }).catch((err) => {
                    if(DEBUG) console.log(err);
                    Session.set('activeHandshake', undefined);
                    throw new Meteor.Error(err, 'CLIENT::STARTUP', 'enable.connection', true)
                });
            }; 

        } else {
            if (Session.get('established')) {        // withdraw valid connection flag
                Session.set('established', undefined);    // If disconnected, withdraw valid connection flag
                if(DEBUG) console.log("disconnected from server");
            } else if(DEBUG) console.log("not connected to server");
        }
    });
});


// TODO: this is shit
// we want to be able to detect if we have other windows open, and make available a multi-viewport-sync feature.
// The only real way to do this, i think,.. is to use the server -- but this shouldnt be the case maybe.
Meteor.setInterval(function () { //Runs every 1 minute.
    // If an earlier session is detected, 
    if(Session.get('activeSession')) { 

        // and ID is different than current
        if (Meteor.connection._lastSessionId != Session.get('activeSession')._id){ 
            // withdraw valid connection flag
            Session.set('established', null);  
            //delete Session.keys['established']; 
        };
    } else { // otherwise if no current session is set
        Session.set('established', null);  // clear any existing connection flag
    };
}, 1000*60);


