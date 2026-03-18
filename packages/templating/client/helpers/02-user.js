import { Template } from 'meteor/templating'

Template.registerHelper('UserId', function() {
	return Meteor.userId()
})

Template.registerHelper('Uid', function() {
	return Meteor.userId()
})

Template.registerHelper('Username', function() {
	return Accounts.user()?.username
})

Template.registerHelper('DisplayName', function() {
	const user = Accounts?.user()
	if(!user) return
	const profile = user.profile
	if(!profile) return user.username
	if(profile.displayname) return profile.displayname
	if(profile.firstname) {
		if(profile.lastname) {
			return `${profile.firstname} ${profile.lastname}`
		}
		return `${profile.firstname} (${user.username})`
	}
	return user.username
})

Template.registerHelper('AvatarUrl', function() {
	const user = Accounts?.user()
	if (user?.profile?.avatar) return user.profile.avatar
	return '/assets/avatar-placeholder.png'
})

Template.registerHelper('Firstname', function() {
	return Accounts.user()?.profile?.firstname
})

Template.registerHelper('Lastname', function() {
	return Accounts.user()?.profile?.lastname
})

Template.registerHelper('Profile', function() {
	return Accounts.user()?.profile
})

Template.registerHelper('AccountAge', function() {
	return Accounts.user()?.createdAt
})

Template.registerHelper('UserGreetingString', () => {
	const hour = new Date().getHours()
	let greeting
	if(hour >= 6 && hour < 12) {
		greeting = 'Good Morning'
	} else if(hour >= 12 && hour < 18) {
		greeting = 'Good Afternoon'
	} else {
		greeting = 'Good Evening'
	}
	const username = Accounts?.user()?.username || 'User'
	return `${greeting} ${username}`
})

Template.registerHelper('Scrobble', function() {
	return Accounts.user()?.nowplaying
})

Template.registerHelper('Packages', function() {
	return _.map(Package, function(pkg, name) {
		return { name: name, pkg }
	})
})
