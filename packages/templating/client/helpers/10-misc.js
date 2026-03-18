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
