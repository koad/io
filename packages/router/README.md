# koad:io-router

A comprehensive router package for [Meteor](https://github.com/meteor/meteor), built specifically for the koad:io framework. This package combines multiple Iron Router repositories into a single, streamlined package.

## Overview

koad:io-router unifies the following repositories into a single cohesive package:

### From polygonwood
- [iron-router](https://github.com/polygonwood/iron-router) - Core routing functionality
- [iron-controller](https://github.com/polygonwood/iron-controller) - Controller layer
- [iron-layout](https://github.com/polygonwood/iron-layout) - Layout management
- [iron-dynamic-template](https://github.com/polygonwood/iron-dynamic-template) - Dynamic template handling
- [iron-middleware-stack](https://github.com/polygonwood/iron-middleware-stack) - Middleware implementation

### From iron-meteor
- [iron-core](https://github.com/iron-meteor/iron-core) - Core functionality
- [iron-location](https://github.com/iron-meteor/iron-location) - Location handling
- [iron-url](https://github.com/iron-meteor/iron-url) - URL parsing and manipulation

## Installation

```shell
meteor add koad:io-router
```

## Quick Start

Create routes in a client/server JavaScript file:

```javascript
Router.route('/', function () {
  this.render('MyTemplate');
});

Router.route('/items', function () {
  this.render('Items');
});

Router.route('/items/:_id', function () {
  var item = Items.findOne({_id: this.params._id});
  this.render('ShowItem', {data: item});
});

// Server-side route
Router.route('/files/:filename', function () {
  this.response.end('hi from the server\n');
}, {where: 'server'});

// RESTful API routes
Router.route('/api', {where: 'server'})
  .get(function () {
    this.response.end('get request\n');
  })
  .post(function () {
    this.response.end('post request\n');
  });
```

## Key Features

- **Client and Server Routing**: Works seamlessly on both client and server
- **RESTful Routes**: Support for RESTful API endpoints
- **Template Integration**: Automatic template rendering based on route configuration
- **Middleware Support**: Hook into the routing lifecycle with middleware
- **Layout Management**: Control layouts and nested templates
- **Dynamic Templates**: Render templates dynamically based on route data
- **Parameter Extraction**: Easy access to URL parameters and query strings

## Hook System

The router provides several hooks for controlling the routing flow:

```javascript
Router.onBeforeAction(function() {
  if (!Meteor.userId()) {
    this.render('login');
  } else {
    this.next();
  }
});
```

## Template Lookup

If you don't explicitly set a template option on your route and don't explicitly render a template name, the router will try to automatically render a template based on the name of the route:

```javascript
Router.route('/items/:_id', {name: 'items.show'});
// Will look for a template named 'ItemsShow'
```

To customize this behavior, set your own converter function:

```javascript
Router.setTemplateNameConverter(function (str) { return str; });
```

## Waiting On Data

You can use the `waitOn` option to make sure data is available before rendering:

```javascript
Router.route('/post/:_id', {
  name: 'post.show',
  waitOn: function() {
    return Meteor.subscribe('post', this.params._id);
  }
});
```

## Query Parameters

Access query parameters through the `query` object:

```javascript
Router.route('/search', function() {
  var keyword = this.params.query.keyword;
  this.render('searchResults', {data: {keyword: keyword}});
});
```

## Progress Bar

The router includes a built-in progress bar that displays when loading different routes.

### Customization

The progress bar is mostly all CSS, and you can override the CSS with whatever you want.

For the most part, you'll want to change the `#iron-router-progress`'s `background-color` and `box-shadow` like this:
```css
#iron-router-progress {
	background-color : <COLOR>;
	box-shadow       : 0 0 5px <COLOR>;
}
```

### Automatic ticks
By default, the progress bar will tick every 0.75-1.5 seconds, after you start loading a route.

If you want to disable this behaviour you can do it either globally by:
```javascript
Router.configure({
	progressTick : false
});
```
Or by route definition:
```javascript
Router.route('/example', {
	progressTick : false
});
```

### Spinner
By default, a spinner is running, on the far right of the page, when loading.

You'll most likely want to just change the border-color like this:
```css
#iron-router-progress.spinner:before {
	border-color : <COLOR>;
}
```

If you don't like the spinner, simply disable it with:
```javascript
Router.configure({
	progressSpinner : false
});
```
Or by route definition:
```javascript
Router.route('/example', {
	progressSpinner : false
});
```

### Enable the progress bar, only for certain routes
If you don't want to use the progress bar for all routes, you can disable it globally, and enable it on the route level:
```javascript
Router.configure({
	progress : false
});

Router.route('/example', {
	progress : true
});
```

Or if you just want it disabled for certain routes:
```javascript
Router.route('/example', {
	progress : false
});
```

### Delay the progress from showing up on fast routes
If you don't want to see the progress-bar for 'fast' routes, you can set a delay (time in ms) in which you would like for the progress to wait, before showing up.
Global delay:
```javascript
Router.configure({
	progressDelay : 100
});
```

Or per route:
```javascript
Router.route('/example', {
	progressDelay : 100
});
```

You can enable it globally, and disable it for specific routes like this:
```javascript
Router.configure({
	progressDelay : 100
});

Router.route('/example', {
	progressDelay : false
});
```

### Debugging
If you want to debug the progress bar, you may enable the `progressDebug` option.

Global debugging:
```javascript
Router.configure({
	progressDebug : true
});
```

Route debugging:
```javascript
Router.route('/example', {
	progressDebug : true
});
```

You can enable it globally, and disable it for specific routes like this:
```javascript
Router.configure({
	progressDebug : true
});

Router.route('/example', {
	progressDebug : false
});
```

## Contributing

Contributions to koad:io-router are welcome! Whether it's bug fixes, feature enhancements, or documentation improvements, your help is appreciated.

### Reporting Issues

When reporting issues, please include:
- A clear description of the problem
- Steps to reproduce the issue
- Expected vs. actual behavior
- A minimal reproduction case if possible

### Development Setup

1. Clone the repository
2. Set up a local packages directory
3. Add the package to your Meteor project for testing

```bash
export PACKAGE_DIRS="/path/to/your/packages"
git clone https://github.com/koad/io-router.git /path/to/your/packages/koad-io-router
cd your-meteor-project
meteor add koad:io-router
```

## License

MIT
