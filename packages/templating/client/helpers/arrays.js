import { Template } from 'meteor/templating'

Template.registerHelper('Length', function(array) {
	return Array.isArray(array) ? array.length : 0
})

Template.registerHelper('First', (arr) => {
	return arr?.[0]
})

Template.registerHelper('FirstN', function(array, n) {
	if(array?.fetch) array = array.fetch()
	if (!Array.isArray(array)) return []
	const count = parseInt(n) || 3
	return array.slice(0, count)
})

Template.registerHelper('RandomN', function(array, n) {
	if(array?.fetch) array = array.fetch()
	if (!array || !Array.isArray(array) || array.length === 0) return []
	const count = parseInt(n) || 20
	const shuffled = array.sort(() => 0.5 - Math.random())
	return shuffled.slice(0, count)
})

Template.registerHelper('JoinArrayWithCommas', function(arr) {
	return arr.join(', ')
})
