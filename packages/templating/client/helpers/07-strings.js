import { Template } from 'meteor/templating'

Template.registerHelper('ToLowercase', function(string) {
	return String(string).toLowercase()
})

Template.registerHelper('Substring', function(str, len, post) {
	if(!str) return ""
	if(str.length <= len) return str
	if (typeof post === 'string' || post instanceof String) {
		len = len - post.length
		return `${str.substring(0, len)}${post}`
	}
	return `${str.substring(0, len)}`
})

Template.registerHelper('Stringify', function(context) {
	return JSON.stringify(context, null, 3)
})

Template.registerHelper('Json', function(context) {
	return console.log(JSON.stringify(context, null, 4))
})

Template.registerHelper('FormatHash', (hash) => {
	if(!hash) return
	return `${hash.substring(0, 16)}:${hash.substring(hash.length - 16)}`
})

Template.registerHelper('HiddenIp', (ipAddr) => {
	if(!ipAddr) return '-'
	const ipArray = ipAddr.split(".")
	if(!ipArray) return '-'
	return `${ipArray[0]}:${ipArray[3]}`
})

Template.registerHelper('Arrayify', function(obj) {
	const result = []
	for (const key in obj) {
		result.push({name: key, value: obj[key]})
	}
	return result
})
