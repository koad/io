// harness-bridge.js — mount the harness bridge protocol endpoints
//
// Loads the standalone bridge-server module and mounts its /harness/
// routes on the daemon's WebApp. This replaces the former Meteor package
// at ~/.koad-io/packages/koad-io-harness/ (removed 2026-05-23).
//
// Consumed by: bridge.js (runs alongside opencode sessions, connects to
// these endpoints for inbound command delivery).

const { WebApp } = require('meteor/webapp');
const { mount } = require('./harness-bridge-server');

mount(WebApp.connectHandlers);
