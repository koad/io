import { Template } from 'meteor/templating'

let lastEscPressTime = 0
const escPressThreshold = 369

Meteor.startup(() => {
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			const now = Date.now()
			if (now - lastEscPressTime <= escPressThreshold) {
				Session.set('ShowDevMode', true)
				lastEscPressTime = 0
			} else {
				lastEscPressTime = now
			}
		}
	})
})

Template.body.events({
	'click .btn-dump-json': function(event) {
		event.stopPropagation()
		console.log(JSON.stringify(this, null, 3))
	}
})

Template.hoverableTimestamp.onCreated(function() {
	this.showRelativeDate = new ReactiveVar(false)
	this.hoverTimeout = null
})

Template.hoverableTimestamp.events({
	'mouseover .hoverable-timestamp': function(event, template) {
		if (template.hoverTimeout) {
			clearTimeout(template.hoverTimeout)
		}
		template.showRelativeDate.set(true)
	},
	'mouseout .hoverable-timestamp': function(event, template) {
		template.hoverTimeout = setTimeout(function() {
			template.showRelativeDate.set(false)
		}, 4500)
	}
})

Template.hoverableTimestamp.helpers({
	showRelativeDate: function() {
		return Template.instance().showRelativeDate.get()
	}
})
