// SPDX-License-Identifier: AGPL-3.0-or-later
//
// activity-entry.js — Template helpers for activityEntry.

import { Template } from 'meteor/templating';

Template.activityEntry.helpers({

  /**
   * CSS class derived from entry type (dots replaced with hyphens).
   * e.g. 'koad.bond' → 'koad-bond'
   */
  entryTypeClass() {
    const type = Template.currentData().type || 'unknown';
    return type.replace(/\./g, '-');
  },

  /**
   * Human-readable formatted date.
   * Uses Intl.DateTimeFormat when available; falls back to toLocaleString.
   */
  formattedDate() {
    const date = Template.currentData()._date;
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
      return Template.currentData()._timestamp || '';
    }

    try {
      return new Intl.DateTimeFormat(undefined, {
        year:   'numeric',
        month:  'short',
        day:    'numeric',
        hour:   '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
    } catch (_) {
      return date.toLocaleString();
    }
  },

});
