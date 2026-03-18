import { Template } from 'meteor/templating'

Template.registerHelper('UserIsInRole', function(uid, role) {
	if (Roles && Roles.userIsInRole(uid, [role])) {
		return true
	}
	return false
})

Template.registerHelper('UserHasRole', function(role) {
	if(role === null) return true
	if(role === undefined) return false
	if (Roles.userIsInRole(Meteor.userId(), role)) {
		return true
	}
	return false
})

Template.registerHelper('IsDesktop', function() {
	screenSize.depend()
	return window.innerHeight < window.innerWidth
})
