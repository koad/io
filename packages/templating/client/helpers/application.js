import { Template } from 'meteor/templating'

Template.registerHelper('SiteTitle', function() {
	return Meteor.settings.public.siteTitle
})

Template.registerHelper('Instance', function() {
	return koad.instance
})

Template.registerHelper('Version', function() {
	return Meteor.settings.public.version
})

Template.registerHelper('Build', function() {
	return Package['a'].Version || 'dev'
})

Template.registerHelper('SiteLogo', function() {
	return Meteor?.settings?.public?.siteLogo
})

Template.registerHelper('Ident', function() {
	return Meteor.settings.public.ident._id
})

Template.registerHelper('Copyright', function() {
	return Meteor.settings.public.copyright
})

Template.registerHelper('CopyrightText', function() {
	const copyright = Meteor.settings.public.copyright
	return `© ${copyright.est} - ${new Date().getFullYear()} ${copyright.holder}, all rights reserved.`
})

Template.registerHelper('CopyrightYear', function() {
	return Meteor.settings.public.copyrightYear
})

Template.registerHelper('BrandName', function() {
	return Meteor.settings.public.brandName
})

Template.registerHelper('AppName', function() {
	return Meteor.settings.public.appName
})

Template.registerHelper('Hoster', function() {
	return Meteor.settings.public.hoster
})

Template.registerHelper('PrivacyPolicyUrl', function() {
	return Meteor.settings.public.policies.privacy
})

Template.registerHelper('AppVersion', function() {
	return appVer()
})

Template.registerHelper('AppBuild', function() {
	return appBuild()
})

Template.registerHelper('AppSlogan', function() {
	return Meteor.settings.public.siteTitle
})
