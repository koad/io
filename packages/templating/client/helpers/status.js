import { Template } from 'meteor/templating'

Template.registerHelper('SiteInMaintenance', function() {
	return false
})

Template.registerHelper('SiteOnline', function() {
	return true
})

Template.registerHelper('DevModeEnabled', function() {
	return Session.get('ShowDevMode')
})

Template.registerHelper('IsBetaContentEnabled', function() {
	if(!window.Roles) return
	const userId = Meteor.userId()
	const isUserInBeta = Roles.userIsInRole(userId, 'trusted')
	const isBetaEnabled = Session.get("BETA")
	return isUserInBeta && isBetaEnabled
})

Template.registerHelper('IsLoggedInUser', function() {
	return Meteor.userId() === this._id
})

Template.registerHelper('LoggedInUserOwnsThis', function() {
	return Meteor.userId() === this._id
})

Template.registerHelper('IsPopup', function() {
	return Session.get('popup')
})
