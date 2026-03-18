import { Template } from 'meteor/templating'

Template.registerHelper('CursorCount', function(cursor) {
	if (!cursor || !cursor.count) return false
	return cursor.count()
})

Template.registerHelper('HasItems', function(cursorOrArray) {
	if (!cursorOrArray) return false
	if (typeof cursorOrArray.count === 'function') {
		return cursorOrArray.count() > 0
	}
	if (Array.isArray(cursorOrArray)) {
		return cursorOrArray.length > 0
	}
	return false
})

Template.registerHelper('HasMultipleItems', function(cursorOrArray) {
	if (!cursorOrArray) return false
	if (typeof cursorOrArray.count === 'function') {
		return cursorOrArray.count() > 1
	}
	if (Array.isArray(cursorOrArray)) {
		return cursorOrArray.length > 1
	}
	return false
})
