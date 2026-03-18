/**
 * Basic Router Configuration - koad:io-router
 *
 * This file demonstrates the fundamental setup and usage of the koad:io-router package.
 * The router is responsible for managing application state based on URL changes and
 * rendering the appropriate templates.
 */

// Configure the router with global options
Router.configure({
  // The default layout template that wraps all route templates
  layoutTemplate: 'mainLayout',

  // The template to render while waiting for data to load
  loadingTemplate: 'loading',

  // The template to render when a route's data isn't found
  notFoundTemplate: 'notFound',

  // Wait on these subscriptions for all routes
  waitOn: function() {
    // This ensures that the subscriptions are ready before rendering the page
    // For example, you might wait on a user's profile data
    // return Meteor.subscribe('userData');
  }
});

/**
 * Route Definitions
 *
 * Each route maps a URL path to a specific template and can include:
 * - data context for the template
 * - hooks for executing code before/after rendering
 * - custom route controller configurations
 */

// Home page route
Router.route('/', {
  name: 'home',
  template: 'home',
  // Provide data context to the template
  data: function() {
    return {
      title: 'Welcome to koad:io-router',
      description: 'A powerful and flexible router for Meteor applications'
    };
  }
});

// About page route
Router.route('/about', {
  name: 'about',
  template: 'about',
  data: function() {
    return {
      title: 'About koad:io-router',
      features: [
        'Declarative routing',
        'Route parameters',
        'Data context',
        'Middleware support',
        'Layouts and template nesting',
        'Server-side routing'
      ]
    };
  }
});

// Route with parameters example
Router.route('/item/:_id', {
  name: 'item',
  template: 'item',
  // The data function has access to route parameters
  data: function() {
    // In a real application, you would fetch data from a collection
    // For example: return Items.findOne(this.params._id);
    return {
      _id: this.params._id,
      name: 'Example Item ' + this.params._id,
      description: 'This demonstrates accessing route parameters'
    };
  }
});

// Route not found - catch all for any undefined routes
Router.route('/(.*)', {
  name: 'notFound',
  template: 'notFound'
});

/**
 * Global Hooks
 *
 * Hooks allow you to execute code before, during, or after routing.
 * They can be applied globally, to specific routes, or to route groups.
 */

// Example of a global 'before' hook
Router.onBeforeAction(function() {
  // This code runs before the route action
  console.log('Navigating to:', Router.current().route.getName());

  // Always call this.next() to continue to the route
  this.next();
});

// If the user isn't logged in and tries to access a page that requires
// authentication, render the login template
/*
Router.onBeforeAction(function() {
  if (!Meteor.userId() && this.route.getName() !== 'login') {
    this.render('login');
  } else {
    this.next();
  }
}, {
  // Apply this hook only to routes that require login
  only: ['profile', 'dashboard', 'settings']
});
*/