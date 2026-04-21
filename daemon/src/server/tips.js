// Tips — kingdom fuel pool money mechanic.
//
// Collection: Tips { _id, amount, currency, name, message, stripeSessionId, status, createdAt, completedAt }
//
// REST:
//   POST /api/tips/checkout-webhook — Stripe webhook → mark tip completed
//   GET  /api/tips/recent?limit=N   — last N completed tips for ticker
//   GET  /api/tips/:id              — single receipt data
//
// DDP publications:
//   tips.recent (24h window, public)
//   tips.byId   (single doc, public)

import { WebApp } from 'meteor/webapp';
import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

const os   = Npm.require('os');
const path = Npm.require('path');
const app  = WebApp.connectHandlers;

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

const Tips = new Mongo.Collection('Tips', { connection: null });
globalThis.Tips = Tips;

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

Meteor.publish('tips.recent', function (hoursArg) {
  var hours = (typeof hoursArg === 'number' && hoursArg > 0) ? Math.min(hoursArg, 168) : 24;
  var since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return Tips.find(
    { status: 'completed', completedAt: { $gte: since } },
    { fields: { amount: 1, currency: 1, name: 1, completedAt: 1 } }
  );
});

Meteor.publish('tips.byId', function (tipId) {
  if (typeof tipId !== 'string' || !tipId) return this.ready();
  return Tips.find({ _id: tipId });
});

// ---------------------------------------------------------------------------
// REST helpers
// ---------------------------------------------------------------------------

function pathIs(req, p) {
  return req.url === p || req.url.split('?')[0] === p;
}

function jsonRes(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status);
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// POST /api/tips/checkout-webhook — Stripe webhook
// Verifies signature, marks tip completed, updates FuelPool balance.
// Must be registered BEFORE /api/tips/:id (prefix match order).
// ---------------------------------------------------------------------------
app.use('/api/tips/checkout-webhook', async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Stripe-Signature');
    res.writeHead(204);
    return res.end();
  }
  if (req.method !== 'POST') return next();
  if (!pathIs(req, '/api/tips/checkout-webhook')) return next();

  // Read raw body for signature verification.
  var chunks = [];
  req.on('data', function (c) { chunks.push(c); });
  req.on('end', async function () {
    var rawBody = Buffer.concat(chunks);

    var stripeSecret = process.env.STRIPE_SECRET_KEY;
    var webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!stripeSecret || !webhookSecret) {
      console.warn('[tips/webhook] Stripe not configured — ignoring webhook');
      return jsonRes(res, 200, { received: true });
    }

    var stripe;
    try {
      var Stripe = Npm.require('stripe');
      stripe = new Stripe(stripeSecret, { apiVersion: '2023-10-16' });
    } catch (e) {
      console.error('[tips/webhook] Stripe npm not installed:', e.message);
      return jsonRes(res, 500, { error: 'stripe-not-installed' });
    }

    var sig = req.headers['stripe-signature'];
    var event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      console.error('[tips/webhook] signature verification failed:', err.message);
      return jsonRes(res, 400, { error: 'invalid-signature' });
    }

    if (event.type === 'checkout.session.completed') {
      var session = event.data.object;
      var sessionId = session.id;
      var amountCents = session.amount_total;
      var currency = session.currency || 'usd';
      var meta = session.metadata || {};
      var now = new Date();

      // Upsert: create or complete the tip record.
      try {
        var existing = await Tips.findOneAsync({ stripeSessionId: sessionId });
        if (existing) {
          await Tips.updateAsync(
            { stripeSessionId: sessionId },
            { $set: { status: 'completed', completedAt: now } }
          );
          console.log(`[tips/webhook] marked completed: ${existing._id} ($${(amountCents/100).toFixed(2)})`);
        } else {
          var tipId = sessionId.replace(/^cs_/, 'tip_');
          await Tips.insertAsync({
            _id: tipId,
            amount: amountCents,
            currency: currency,
            name: meta.name || '',
            message: meta.message || '',
            stripeSessionId: sessionId,
            status: 'completed',
            createdAt: now,
            completedAt: now,
          });
          console.log(`[tips/webhook] inserted tip ${tipId} ($${(amountCents/100).toFixed(2)})`);
        }
      } catch (dbErr) {
        console.error('[tips/webhook] DB error:', dbErr.message);
        return jsonRes(res, 500, { error: 'db-error' });
      }
    }

    return jsonRes(res, 200, { received: true });
  });
});

// ---------------------------------------------------------------------------
// GET /api/tips/:id — single receipt (must come before /api/tips)
// ---------------------------------------------------------------------------
app.use('/api/tips', async (req, res, next) => {
  if (req.method !== 'GET') return next();

  // Match /api/tips/<id> where id has no query string and is non-empty.
  var urlPath = req.url.split('?')[0];
  var prefix = '/api/tips/';
  if (urlPath.startsWith(prefix)) {
    var tipId = urlPath.slice(prefix.length);
    if (!tipId || tipId === 'recent') return next();

    try {
      var tip = await Tips.findOneAsync({ _id: tipId });
      if (!tip) return jsonRes(res, 404, { error: 'not-found' });
      return jsonRes(res, 200, tip);
    } catch (e) {
      return jsonRes(res, 500, { error: e.message });
    }
  }
  return next();
});

// ---------------------------------------------------------------------------
// GET /api/tips/recent?limit=N — last N completed tips (24h window)
// ---------------------------------------------------------------------------
app.use('/api/tips', async (req, res, next) => {
  if (req.method !== 'GET') return next();
  var urlPath = req.url.split('?')[0];
  if (urlPath !== '/api/tips' && urlPath !== '/api/tips/recent') return next();

  var qs = {};
  var qPart = req.url.split('?')[1] || '';
  qPart.split('&').forEach(function (p) {
    var parts = p.split('=');
    if (parts[0]) qs[parts[0]] = parts[1] || '';
  });

  var limit = Math.min(parseInt(qs.limit || '20', 10) || 20, 100);
  var since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    var tips = await Tips.find(
      { status: 'completed', completedAt: { $gte: since } },
      { sort: { completedAt: -1 }, limit: limit }
    ).fetchAsync();
    return jsonRes(res, 200, { tips: tips, count: tips.length });
  } catch (e) {
    return jsonRes(res, 500, { error: e.message });
  }
});
