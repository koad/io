import { Meteor } from 'meteor/meteor';

import { Template } from 'meteor/templating';
Passengers = new Mongo.Collection('Passengers');
Template.WidgetQuickLaunch.onCreated(function() {
  // Subscribe to the 'current' publication
  this.subscribe('current');
});

Template.WidgetQuickLaunch.helpers({
  Entity() {
    return Passengers.findOne({selected: {$exists: true}});
  },
  fullIconClass() {
    return `fa fa-${this.key}`;
  }
});


Template.WidgetQuickLaunch.events({
  'click .main-diamond'(event, instance) {
    event.preventDefault();

    const navElement = instance.$('.nav');
    const mainDiamondElement = instance.$('.main-diamond');

    if (event.shiftKey) {
      // Shift click: toggle expansion
      if (navElement.hasClass('small')) {
        navElement.removeClass('small');
        mainDiamondElement.removeClass('small');
      } else {
        navElement.addClass('small');
        mainDiamondElement.addClass('small');
      }
    } else {
      // Regular click: if expanded, just collapse; if collapsed, launch first button
      if (!navElement.hasClass('small')) {
        // Diamond is expanded, just collapse it
        navElement.addClass('small');
        mainDiamondElement.addClass('small');
      } else {
        // Diamond is collapsed, click first button
        const firstButton = instance.$('.btn-nav').first();
        if (firstButton.length > 0) {
          // Add pulse animation to the diamond
          const logo = instance.$('.entity-icon');
          logo.addClass('pulse');
          setTimeout(() => {
            logo.removeClass('pulse');
          }, 600);
          
          firstButton.trigger('click');
        }
      }
    }
  },

  'click .btn-nav'(event, instance) {
    event.preventDefault();
    console.log('btn-nav: action:', this.action, "target:", this.target);
    
    // Collapse the diamond when a button is clicked
    const navElement = instance.$('.nav');
    const mainDiamondElement = instance.$('.main-diamond');
    if (!navElement.hasClass('small')) {
      navElement.addClass('small');
      mainDiamondElement.addClass('small');
    }
    
    Meteor.call(this.action, this.target, (error, result) => {
      if (error) {
        console.error('Error:', error);
      } else {
        // Additional client-side actions if needed
      }
    });

  },
});

if (typeof process !== 'undefined' && process.type === 'renderer') {
  // Your app is running in an Electron renderer process
  console.log('Running in Electron renderer process');
  document.documentElement.style.setProperty('--background-color', 'transparent');
} else {
  // Your app is running in a regular web browser
  console.log('Running in a regular web browser');
  document.documentElement.style.setProperty('--background-color', '#121212');
}
