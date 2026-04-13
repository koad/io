import { Meteor } from 'meteor/meteor';

import { Template } from 'meteor/templating';
Passengers = new Mongo.Collection('Passengers');
Alerts = new Mongo.Collection('Alerts');

// Global helper: route /overview to the KingdomOverview template
Template.registerHelper('isOverview', function () {
  return window.location.pathname === '/overview';
});
Template.WidgetQuickLaunch.onCreated(function() {
  // Subscribe to the 'current' publication
  this.subscribe('current');
  this.subscribe('alerts');
  this.subscribe('all'); // all passengers — needed for notification avatars
});

// Get alert records for the currently selected entity
function getEntityAlerts() {
  const entity = Passengers.findOne({selected: {$exists: true}});
  if (!entity) return [];
  return Alerts.find({ entity: entity.handle }).fetch();
}

Template.WidgetQuickLaunch.helpers({
  Entity() {
    return Passengers.findOne({selected: {$exists: true}});
  },
  fullIconClass() {
    return `fa fa-${this.key}`;
  },
  entityAlerts() {
    return getEntityAlerts();
  },
  hasAlerts() {
    const records = getEntityAlerts();
    return records.some(r => r.items && r.items.length > 0);
  },
  alertLevel() {
    const records = getEntityAlerts();
    const hasAlertSource = records.some(r => r.source === 'alerts' && r.items && r.items.length > 0);
    const hasNotifSource = records.some(r => r.source === 'notifications' && r.items && r.items.length > 0);
    if (hasAlertSource) return 'alert';
    if (hasNotifSource) return 'notification';
    return null;
  },
  alertClass() {
    const records = getEntityAlerts();
    const hasAlertSource = records.some(r => r.source === 'alerts' && r.items && r.items.length > 0);
    const hasNotifSource = records.some(r => r.source === 'notifications' && r.items && r.items.length > 0);
    if (hasAlertSource) return 'has-alerts';
    if (hasNotifSource) return 'has-notifications';
    return '';
  },
  avatarOpacity() {
    const records = getEntityAlerts();
    const hasAny = records.some(r => r.items && r.items.length > 0);
    return hasAny ? '0.69' : '1';
  },
  firstAlert() {
    const records = getEntityAlerts();
    // Alerts take priority over notifications
    const alertRecord = records.find(r => r.source === 'alerts' && r.items && r.items.length > 0);
    if (alertRecord) return alertRecord.items[0];
    const notifRecord = records.find(r => r.source === 'notifications' && r.items && r.items.length > 0);
    if (notifRecord) return notifRecord.items[0];
    return null;
  },
  allNotificationItems() {
    const items = [];
    const allAlerts = Alerts.find().fetch();
    for (const record of allAlerts) {
      if (!record.items || record.items.length === 0) continue;
      const passenger = Passengers.findOne({ handle: record.entity });
      const avatar = passenger ? passenger.image : '';
      for (let i = 0; i < record.items.length; i++) {
        items.push({
          entity: record.entity,
          source: record.source,
          avatar: avatar,
          body: record.items[i].body,
          type: record.items[i].type,
          timestamp: record.items[i].timestamp,
          index: i
        });
      }
    }
    items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return items;
  },
});


Template.WidgetQuickLaunch.events({
  'dblclick .main-diamond'(event, instance) {
    event.preventDefault();
    if (event.shiftKey) {
      // Shift-double-click: open kingdom overview
      const rootUrl = Meteor.absoluteUrl('overview');
      window.open(rootUrl, 'kingdom-overview');
    }
  },

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

  'click .notification-card'(event, instance) {
    event.preventDefault();
    event.stopPropagation();
    const entity = this.entity;
    const source = this.source;
    const index = this.index;
    Meteor.call('alerts.dismiss', { entity, source, index });
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
