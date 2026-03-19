import { Template } from 'meteor/templating'

Template.registerHelper('ToFixed', function(num, decimals) {
	if(num) {
		tick1s.depend()
		const dec = parseInt(decimals) || 0
		return num.toFixed(dec)
	}
})

Template.registerHelper('NumberWithCommas', (number, decimals) => {
	if(!number) return
	number = Number(number)
	if (typeof number === 'number' && !Number.isNaN(number)) {
		const dec = parseInt(decimals)
		if (!isNaN(dec)) {
			return number.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
		}
		return number.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
	}
})

Template.registerHelper('NumberOfDecimals', (number) => {
	if(!number) return
	if (typeof number === 'number' && !Number.isNaN(number)) {
		return Number(1 / number).toFixed(8)
	}
})

Template.registerHelper('CentsToDollars', function(cents) {
	return (Number(cents) / 100).toFixed(2)
})

Template.registerHelper('FormatCentsToDollars', function(cents) {
	if (typeof cents !== 'number') return '$0.00'
	return '$' + (cents / 100).toFixed(2)
})

Template.registerHelper('DenominationsToFractions', function(denominations) {
	return Math.pow(10, denominations).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
})
