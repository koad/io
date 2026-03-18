import { Template } from 'meteor/templating'
import { Tracker } from 'meteor/tracker'

tick1s = new Tracker.Dependency()
tick1m = new Tracker.Dependency()
screenSize = new Tracker.Dependency()

addEventListener('resize', () => {
	screenSize.changed()
})

SECONDS = 1000
MINUTES = 60 * SECONDS
HOURS = 60 * MINUTES
DAYS = 24 * HOURS
WEEKS = 7 * DAYS
YEARS = 365 * DAYS
MONTHS = YEARS / 12

Meteor.setInterval(function () {
	tick1s.changed()
}, 1 * SECONDS)

Meteor.setInterval(function () {
	tick1m.changed()
}, 60 * SECONDS)
