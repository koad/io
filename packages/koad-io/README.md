# koad:io

The main koad:io package providing core functionality for Meteor applications built on the koad:io framework. This package serves as the foundation for all koad:io applications, combining core routing, session management, templating, and utilities into a single convenient package.

## Installation

```shell
meteor add koad:io
```

## Dependencies

This package automatically includes and implies:
- `koad:io-core` - Core framework
- `koad:io-router` - Routing system
- `koad:io-session` - Session management
- `koad:io-templating` - Template engine
- `koad:io-plus-head-js` - Head management
- `accounts-base` - Meteor accounts
- `standard-minifier-css` - CSS minification
- `standard-minifier-js` - JavaScript minification
- `mobile-experience` - Mobile support
- `mizzao:timesync` - Time synchronization
- `matb33:collection-hooks` - Collection hooks
- `mongo` - MongoDB driver
- `tracker` - Meteor reactivity
- `templating` - Meteor templating
- `jquery` - jQuery

## Features

### Core Functionality
- Unified package that includes all koad:io essentials
- Automatic configuration based on application settings
- Instance-based identification

### Session Management
- `ApplicationSessions` - Track user sessions across devices
- Connection tracking via `connection-tracker.js`
- Automatic session lifecycle management

### Authentication
- Token-based login system
- Cross-device authentication support
- Login/Logout helper functions

### Time Utilities
- `tick1s` - Triggers every second
- `tick1m` - Triggers every minute

### Device & Service Management
- `Devices` collection - Track connected devices
- `Services` collection - Track external services

### Secrets Management
- Server-side secrets storage
- Secure configuration handling

### Middleware
- Manifest middleware for PWA support
- 404 handling middleware
- Request/response interception

### Internationalization
- Country codes utilities (`CountryCodes`)

### Web Vitals
- Built-in web vitals tracking

## Global API

### Client-Side

#### `Login(token)`
Log in with a token string.

```javascript
Login(token);
```

#### `Logout()`
Log out the current user.

```javascript
Logout();
```

#### `tick1s`
A reactive dependency that triggers every second.

```javascript
Tracker.autorun(() => {
  tick1s.depend();
  // This runs every second
});
```

#### `tick1m`
A reactive dependency that triggers every minute.

```javascript
Tracker.autorun(() => {
  tick1m.depend();
  // This runs every minute
});
```

### Server-Side

#### `ApplicationSessions`
MongoDB collection for session management.

```javascript
// Query sessions
ApplicationSessions.find({ userId: userId });
```

#### `ApplicationInternals`
Collection for tracking application internals.

#### `Devices` (Server only)
Collection for device tracking.

```javascript
Devices.find({ instance: instanceId });
```

#### `Services` (Server only)
Collection for external service tracking.

#### `Secrets` (Server only)
Secure storage for application secrets.

```javascript
Secrets.findOne({ key: 'apiKey' });
```

#### `koad`
Global object with application utilities.

```javascript
koad.instance   // Current instance ID
koad.maintenance  // Maintenance mode flag
```

## Configuration

### Settings Structure

Configure the package via `Meteor.settings.public`:

```javascript
{
  "public": {
    "ident": {
      "instance": "my-instance-id"
    },
    "application": {
      "name": "My App",
      "rootUrl": "https://example.com"
    }
  }
}
```

### Environment Variables

The package respects various environment variables and settings:
- `ROOT_URL` - Application root URL
- `MONGO_URL` - MongoDB connection string
- `METEOR_SETTINGS` - JSON settings string

## Collections

### ApplicationSessions

```javascript
{
  _id: String,
  userId: String,
  instance: String,
  consumable: String,      // One-time use token for auth
  authorizedBy: String,    // User ID who authorized
  authorizedAt: Date,
  createdAt: Date,
  lastSeen: Date,
  userAgent: String,
  ipAddress: String,
  country: String,
  // ... additional fields
}
```

### ApplicationInternals

```javascript
{
  _id: String,
  type: String,            // 'heartbeat', 'event', etc.
  data: Object,
  timestamp: Date
}
```

### Devices

```javascript
{
  _id: String,
  userId: String,
  instance: String,
  type: String,            // 'mobile', 'desktop', 'tablet'
  os: String,
  browser: String,
  lastSeen: Date
}
```

### Services

```javascript
{
  _id: String,
  name: String,
  type: String,
  config: Object,
  enabled: Boolean
}
```

## Middleware

### Manifest Middleware
Serves the PWA manifest for progressive web app support.

### 404 Middleware
Handles unknown routes gracefully.

## Events

### Session Events
The package tracks session lifecycle events:
- Session created
- Session authorized
- Session disconnected
- Session expired

### Heartbeat
Sessions send periodic heartbeats to track activity.

## Security Features

- Token-based authentication
- Server-side secrets management
- Connection tracking
- Rate limiting support via koad:io-accounts

## Usage with Other Packages

This package works seamlessly with other koad:io packages:

```javascript
// Add accounts
meteor add koad:io-accounts

// Add accounts UI
meteor add koad:io-accounts-ui

// Add theme engine
meteor add koad:io-theme-engine

// Add search
meteor add koad:io-search
```
