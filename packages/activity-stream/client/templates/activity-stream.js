// SPDX-License-Identifier: AGPL-3.0-or-later
//
// activity-stream.js — Template helpers for activityStream and activityStreamEmpty.

import { Template } from 'meteor/templating';

Template.activityStream.helpers({

  /**
   * True while the stream is loading entries.
   */
  isLoading() {
    const stream = Template.currentData().stream;
    if (!stream) return false;
    return typeof stream.isLoading === 'function' ? stream.isLoading() : false;
  },

  /**
   * Error string if load failed, falsy otherwise.
   */
  streamError() {
    const stream = Template.currentData().stream;
    if (!stream) return null;
    return typeof stream.error === 'function' ? stream.error() : null;
  },

  /**
   * True if there are entries to show.
   */
  hasEntries() {
    const data = Template.currentData();
    const stream = data.stream;
    const entries = _getEntries(stream);
    return entries.length > 0;
  },

  /**
   * Template-ready rendered entries (newest first for display).
   */
  renderedEntries() {
    const data = Template.currentData();
    const stream = data.stream;
    const opts = data.opts || null;
    const entries = _getEntries(stream);

    // Apply rendering
    const rendered = ActivityStream.render(entries, opts);

    // Reverse for display: newest first
    return rendered.slice().reverse();
  },

});

/**
 * Extract the raw entry array from a stream instance or direct array.
 */
function _getEntries(stream) {
  if (!stream) return [];
  if (Array.isArray(stream)) return stream;
  if (typeof stream.entries === 'function') return stream.entries();
  return [];
}
