import { Template } from 'meteor/templating'

Template.registerHelper('Reldate', function(context) {
	if(context) {
		tick1s.depend()
		return moment(new Date(context)-TimeSync.serverOffset()).fromNow()
	}
})

Template.registerHelper('FromNow', function(date) {
	if(date) {
		tick1m.depend()
		const lapsed = new Date() - date
		if (lapsed < 2 * MINUTES) return 'just now'
		if (lapsed < 10 * MINUTES) return 'minutes ago'
		if (lapsed < 30 * MINUTES) return 'recently'
		if (lapsed < 50 * MINUTES) return 'this hour'
		if (lapsed < 120 * MINUTES) return 'last hour'
		if (lapsed < 2 * DAYS) return `${Number(lapsed / HOURS).toFixed(0)} hours ago`
		if (lapsed < 3 * DAYS) return `${Number(lapsed / DAYS).toFixed(0)} days ago`
		return `${Number(lapsed / DAYS).toFixed(0)} days ago`
	}
})

Template.registerHelper('Now', function() {
	return 'Just now'
})

Template.registerHelper('Timestamp', (date) => {
	if(!date) return
	if (typeof date === 'number' && date < new Date() / 1000) date = date * SECONDS
	return koad.format.timestamp(date)
})

Template.registerHelper('FormatDate', function(date) {
	if (date instanceof Date) {
		return date.toLocaleString()
	}
	return date
})

Template.registerHelper('DaysAgo', function(dayCount = 1) {
	return new Date().getTime() - (dayCount * 600000)
})

Template.registerHelper('DatePlus1000', (thing) => {
	if(!thing) return
	return new Date(Number(thing)*1000)
})

Template.registerHelper('WasWithinTheLastNineMinutes', function(date) {
	const targetDate = new Date(date)
	const now = new Date()
	const diffMinutes = (now - targetDate) / (1000 * 60)
	return diffMinutes <= 9
})

const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const monthsOfYear = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

Template.registerHelper('DayOfWeek', function() {
	const d = new Date(this.start)
	return daysOfWeek[d.getDay()]
})

Template.registerHelper('FullSizedDate', function() {
	const d = new Date(this.start)
	const date = d.getDate()
	const month = d.getMonth()
	const year = d.getFullYear()
	const nth = (n) => {
		if (n > 3 && n < 21) return 'th'
		switch (n % 10) {
			case 1: return "st"
			case 2: return "nd"
			case 3: return "rd"
			default: return "th"
		}
	}
	return `${monthsOfYear[month]} ${date}${nth(date)}, ${year}`
})

Template.registerHelper('StartTime', function() {
	return new Date(this.date)
})

Template.registerHelper('LastSunday', function() {
	const now = new Date()
	const dayOfWeek = now.getDay()
	const lastSunday = new Date(now)
	lastSunday.setDate(now.getDate() - dayOfWeek)
	lastSunday.setHours(0, 0, 0, 0)
	return lastSunday
})
