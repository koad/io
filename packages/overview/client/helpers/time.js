// Time helper functions shared by overview templates.
// Extracted from daemon/src/client/overview.js for package reuse.

KoadOverview = KoadOverview || {};

KoadOverview._relativeTime = function (date) {
  if (!date) return '';
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
};

KoadOverview._elapsed = function (started) {
  if (!started) return '';
  const diff = Math.floor((new Date() - new Date(started)) / 1000);
  if (diff < 60) return diff + 's';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ' + (diff % 60) + 's';
  return Math.floor(diff / 3600) + 'h ' + Math.floor((diff % 3600) / 60) + 'm';
};

KoadOverview._formatElapsed = function (secs) {
  if (secs == null) return '';
  if (secs < 60) return secs + 's';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ' + (secs % 60) + 's';
  return Math.floor(secs / 3600) + 'h ' + Math.floor((secs % 3600) / 60) + 'm';
};

// Compact age string for "last seen" chips. Takes ms.
KoadOverview._lastSeen = function (ageMs) {
  if (ageMs == null || ageMs < 0) return '';
  const sec = Math.floor(ageMs / 1000);
  if (sec < 10) return 'now';
  if (sec < 60) return sec + 's ago';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  const days = Math.floor(hr / 24);
  if (days < 30) return days + 'd ago';
  return Math.floor(days / 30) + 'mo ago';
};

KoadOverview._shortDate = function (date) {
  if (!date) return '';
  const d = new Date(date);
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return mo + '-' + da + ' ' + hh + ':' + mm;
};
