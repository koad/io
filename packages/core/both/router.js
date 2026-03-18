"use strict"

return; // this does not yet work,. it needs templates to work right,. need to think..
if(!Router) return;

function emailVerified (user) {
    return _.some(user.emails, function (email) {
        return email.verified
    });
};

const filters = {
    authenticate: async function () {
        if (Meteor.loggingIn()) {
            this.render('loading')
        } else {
            var user = await Meteor.userAsync()
            if (!user) {
                this.layout('EmptyLayout')
                this.render('_loginout')
                return
            }
            // if (!Roles.userIsInRole(user, ['admin', 'user', 'suspended', 'super-admin'])) {
            //  const result = await Meteor.callAsync("updateRoles", user._id);
            //      if (err){
            //          notify({title: 'Error.',text: err.message+' Your account cannot be loaded, please try again later or report a bug to bugs at indie.express',icon: 'fa fa-bomb',addclass: 'pn-warning',nonblock: {nonblock: true}});
            //      }else{
            //          notify({title: 'Welcome',text: 'Your account has been activated for use, welcome aboard!.',icon: 'fa fa-envelope-o',addclass: 'pn-success', nonblock: {nonblock: true}});
            //      }
            //  });
            //  this.render('AccessDenied');
            //  Session.set("breadcrumbs", ['Error', 'Access Denied']);
            //  return
            // }
            // if (!Roles.userIsInRole(user, ['admin', 'user'])) {
            //  this.render('AccessDenied')
            //  Session.set("breadcrumbs", ['Error', 'Access Denied']);
            //  return
            // }
            this.next()
        }
    }, hasEmailVerified: async function () {
        // if (!emailVerified(Meteor.isServer ? await Meteor.userAsync() : Meteor.user())) {
        //  Session.set("breadcrumbs", ['Login', 'Error', 'Email address not verified']);
        //  this.render('awaitingVerification');
        //  return
        // }
        this.next()
    }, testFilter: function () {
        this.next()
    }, isAdmin: async function () {
        var user = await Meteor.userAsync()
        if (!Roles.userIsInRole(user, ["admin"])) {
            this.render('AccessDenied')
            Session.set("breadcrumbs", ['Access Denied']);
            return
        }
        this.next()
    }, isOwner: async function () {
        var user = await Meteor.userAsync()
        if (!Roles.userIsInRole(user, ["owner"])) {
            this.render('AccessDenied')
            Session.set("breadcrumbs", ['Access Denied']);
            return
        }
        this.next()
    }, isSysop: async function () {
        var user = await Meteor.userAsync()
        if (!Roles.userIsInRole(user, ["sysop"])) {
            this.render('AccessDenied')
            Session.set("breadcrumbs", ['Access Denied']);
            return
        }
        this.next()
    }, isUser: async function () {
        var user = await Meteor.userAsync()
        if (!Roles.userIsInRole(user._id, ["user", 'super-admin'])) {
            this.render('AccessDenied')
            Session.set("breadcrumbs", ['Access Denied']);
            return
        }
        this.next()
    }, isBeta: async function () {
        var user = await Meteor.userAsync()
        if (!Roles.userIsInRole(user, ["beta"])) {
            this.render('AccessDenied')
            Session.set("breadcrumbs", ['Access Denied']);
            return
        }
        this.next()
    }, isAccountant: async function () {
        var user = await Meteor.userAsync()
        if (!Roles.userIsInRole(user, ["accountant"])) {
            this.render('AccessDenied')
            Session.set("breadcrumbs", ['Access Denied']);
            return
        }
        this.next()
    }, isBanker: async function () {
        var user = await Meteor.userAsync()
        if (!Roles.userIsInRole(user, ["bank", "admin", "owner"])) {
            this.render('AccessDenied')
            Session.set("breadcrumbs", ['Access Denied']);
            return
        }
        this.next()
    }
};

Router.filters = filters;

