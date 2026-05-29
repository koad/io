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

// ecoincore helpers distributed from client/helpers/template.js

Template.registerHelper('relDate', function(date) {
	if (!date) return;
	tick1s.depend();
	return moment(new Date(date)).fromNow();
})

Template.registerHelper('fromNow', function(date) {
	tick1s.depend();
	return moment(date).fromNow();
})

Template.registerHelper('stamp', function(date) {
	let stamp = '';
	const d = new Date(date);
	stamp += d.getFullYear();
	stamp += ':' + ('0' + Number(d.getMonth() + 1)).slice(-2);
	stamp += ':' + ('0' + Number(d.getDate())).slice(-2);
	stamp += ':' + ('0' + Number(d.getHours())).slice(-2);
	stamp += ':' + ('0' + Number(d.getMinutes())).slice(-2);
	stamp += ':' + ('0' + Number(d.getSeconds())).slice(-2);
	return stamp;
})

Template.registerHelper('since', function(date) {
	return moment(date).calendar();
})

Template.registerHelper('shortDate', function(date) {
	if (!date) return;
	tick1s.depend();
	return moment(date).fromNow();
})

// FormatElapsed — compact elapsed-time string from seconds.
// 90 → "1m 30s", 3720 → "1h 2m", 45 → "45s"
// Mirrors KoadOverview._formatElapsed (overview + brand-components packages).
// Used as {{FormatElapsed elapsed}} wherever a pre-computed seconds value needs
// human display without a full data-builder pass.
Template.registerHelper('FormatElapsed', function(secs) {
	if (secs == null) return '';
	if (secs < 60) return secs + 's';
	if (secs < 3600) return Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
	return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
})
