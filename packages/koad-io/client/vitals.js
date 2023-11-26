/*
  Core Vitals 
  - Largest Contentful Paint (LCP): measures loading performance. To provide a good user experience, LCP should occur within 2.5 seconds of when the page first starts loading.
  - First Input Delay (FID): measures interactivity. To provide a good user experience, pages should have a FID of 100 milliseconds or less.
  - Cumulative Layout Shift (CLS): measures visual stability. To provide a good user experience, pages should maintain a CLS of 0.1. or less.

  Others
  - Time to First Byte (TTFB) 
  - First Contentful Paint (FCP) 
  - Time to Interactive (TTI) 

  Not reported here, but important.
  - Total Blocking Time (TBT); a metric that should be measured in the lab. The best way to measure TBT is to run a Lighthouse performance audit on your site. See the Lighthouse documentation on TBT for usage details.
  
  https://github.com/GoogleChrome/web-vitals#import-web-vitals-from-npm
  https://web.dev/vitals/
  https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon

  Make your shit better...

  Optimize LCP - https://web.dev/optimize-lcp
  Optimize FID - https://web.dev/optimize-fid
  Optimize CLS - https://web.dev/optimize-cls
*/

import {onCLS, onFID, onLCP} from 'web-vitals';

function sendToAnalytics(metric) {
  Meteor.call('analytics.vitals', metric, (error, response)=>{
    // console.log({error, response})
    // console.log({metric});
    // console.log('metric discovered');
  });
  
  // this is how you might do this in a regular (non koad:io) app, instead of calling a meteor method.
  // Use `navigator.sendBeacon()` if available, falling back to `fetch()`.
  /*
    const body = JSON.stringify(metric);
    (navigator.sendBeacon && navigator.sendBeacon('/analytics', body)) || fetch('/analytics', {body, method: 'POST', keepalive: true});
  */
};

if (typeof onCLS === 'function') onCLS(sendToAnalytics); // Cumulative Layout Shift (CLS)
if (typeof onFID === 'function') onFID(sendToAnalytics); // First Input Delay (FID)
if (typeof onLCP === 'function') onLCP(sendToAnalytics); // Largest Contentful Paint (LCP)

if (typeof onFCP === 'function') onFCP(sendToAnalytics); // First Contentful Paint (FCP)
if (typeof onINP === 'function') onINP(sendToAnalytics); // Interaction to next Paint (INP)
if (typeof onTTFB === 'function') onTTFB(sendToAnalytics); // Time to First Byte (TTFB)
