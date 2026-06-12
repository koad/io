// User profile publication — publish safe fields for /:username route
// Publishes username + profile only; never services or emails.
// Consumed by UserProfile template via 'user.profile' subscription.

import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';

Meteor.publish('user.profile', function (usernameOrHandle) {
  check(usernameOrHandle, String);

  if (!usernameOrHandle) return this.ready();

  // Match by username or profile.handle (GitHub login sets username)
  return Meteor.users.find(
    {
      $or: [
        { username: usernameOrHandle },
        { 'profile.handle': usernameOrHandle }
      ]
    },
    {
      fields: {
        username: 1,
        profile: 1
      },
      limit: 1
    }
  );
});
