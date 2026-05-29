import { Template } from 'meteor/templating'

Template.registerHelper('DeviceIcon', function(device) {
	if(!device) return 'question'
	if(device.startsWith("Ubuntu")) return "linux"
	if(device.startsWith("Android")) return "android"
	if(device.startsWith("Windows")) return "windows"
	if(device.startsWith("Mac OS")) return "apple"
	return "question"
})

Template.registerHelper('IsObject', function(thing) {
	return thing !== null && typeof thing === 'object'
})

Template.registerHelper('IsReady', function() {
	return Template.instance().subscriptionsReady()
})

Template.registerHelper('IsSettingToggledOn', function(key) {
	const setting = koad.settings.get(key)
	return setting && setting.value
})

Template.registerHelper('TypeIsBoolean', function() {
	return this.type == "boolean"
})

Template.registerHelper('TypeIsString', function() {
	return this.type == "string"
})

Template.registerHelper('ObjectKeysLength', function(obj) {
	if(!obj) return 0
	return Object.keys(obj)?.length || 0
})

Template.registerHelper('GetRolesForUser', (id) => {
	return Roles.getRolesForUser(id)
})

// ecoincore helpers distributed from client/helpers/template.js

Template.registerHelper('JSON', function(obj) {
	return JSON.stringify(obj, null, 5);
})

Template.registerHelper('true', function() {
	return true;
})

Template.registerHelper('false', function() {
	return false;
})

Template.registerHelper('length', function(arr) {
	return arr.length;
})

Template.registerHelper('isObject', function(thing) {
	return (typeof thing === 'object');
})

Template.registerHelper('isArray', function(thing) {
	return Array.isArray(thing);
})

Template.registerHelper('isReady', function() {
	return Template.instance().subscriptionsReady();
})

Template.registerHelper('absoluteUrl', function() {
	return Meteor.absoluteUrl();
})
