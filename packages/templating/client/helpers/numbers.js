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

// Token count formatter — used by brand-components flight/item.
// Returns compact string: 1234 → "1.2k", 1234567 → "1.2M"
Template.registerHelper('formatTokens', function(n) {
	if (!n) return '0';
	if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
	if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
	return '' + n;
})

// Cost formatter — used by brand-components flight/item.
// Returns two-decimal string: 0.005 → "0.00", 1.5 → "1.50"
Template.registerHelper('formatCost', function(n) {
	if (!n) return '0.00';
	return n.toFixed(2);
})

// ecoincore helpers distributed from client/helpers/template.js

Template.registerHelper('toFixed8', function(num) {
	return Number(num).toFixed(8);
})

Template.registerHelper('toFixed', function(num, pos) {
	return Number(num).toFixed(pos);
})

Template.registerHelper('fix3', function(num) {
	return Number(num).toFixed(3);
})

Template.registerHelper('fix4', function(num) {
	return Number(num).toFixed(4);
})

Template.registerHelper('format8sats', function(n) {
	return Number(n).toFixed(8);
})

Template.registerHelper('formatBalance', function(balance) {
	if (!balance) return '0.00000000';
	return (parseFloat(balance) / 100000000).toFixed(8);
})

Template.registerHelper('formatDecimals', function(num) {
	num = Number(num);
	if (num === 1) return '<span class="text-muted">- 1 -</span>';
	let formatted;
	if (num >= 1000000) formatted = num.toFixed(0);
	else if (num >= 100000) formatted = num.toFixed(2);
	else if (num >= 10000) formatted = num.toFixed(3);
	else if (num >= 1000) formatted = num.toFixed(4);
	else if (num >= 100) formatted = num.toFixed(6);
	else if (num >= 10) formatted = num.toFixed(7);
	else {
		formatted = num.toFixed(8);
		return `${formatted}`;
	}
	let [integerPart, decimalPart] = formatted.split('.');
	integerPart = Number(integerPart).toLocaleString('en-US');
	if (!decimalPart) return `${integerPart}`;
	return `${integerPart}<span class="text-muted">.${decimalPart}</span>`;
})

function _ecoincore_dynamicFixed(value) {
	const absValue = Math.abs(value);
	if (absValue >= 10000) return value.toFixed(0);
	else if (absValue >= 1000) return value.toFixed(1);
	else if (absValue >= 100) return value.toFixed(2);
	else if (absValue >= 10) return value.toFixed(3);
	else if (absValue >= 1) return value.toFixed(4);
	else if (absValue >= 0.1) return value.toFixed(5);
	else if (absValue >= 0.01) return value.toFixed(6);
	else if (absValue >= 0.001) return value.toFixed(7);
	else return value.toFixed(8);
}

Template.registerHelper('dynamicFixed', function(num) {
	return _ecoincore_dynamicFixed(Number(num));
})

Template.registerHelper('FormatCoin', function(coin) {
	return Number(coin).toFixed(8);
})
