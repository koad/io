const { pathToRegexp } = Npm.require("path-to-regexp");
const useragent = require('useragent');
const hostname = new URL(Meteor.absoluteUrl()).hostname;

// if(!process.env.KOAD_IO_ENFORCE_VALID_ROUTES) return console.log('[koad:io] KOAD_IO_ENFORCE_VALID_ROUTES not set, lowering routing restrictions.');
// if(!process.env.KOAD_IO_ENFORCE_VALID_HOSTS) return console.log('[koad:io] KOAD_IO_ENFORCE_VALID_HOSTS not set, lowering routing restrictions.');
if(!Meteor.settings?.public?.ident?.instance) return console.log('[koad:io] no ident found, lowering routing restrictions.');

// TODO: no mo hard coded shis bro...
if(hostname == "127.0.0.1") return log.debug('running on localhost, no need for restrictions');
if(isPrivateIP(hostname)) return log.debug('running on local network, no need for restrictions');

const paths = [ // add the paths NOT loaded within the router logically
  '/probes/application', 
  '/probes/instance', 
  '/robots.txt',
];

if(koad.manifest) paths.push('/manifest.json');
if(koad.features?.oembed) paths.push('/oembed');

const hosts = [
  Meteor.settings.public.ident.hostname,
  `www.${Meteor.settings.public.ident.hostname}`
];

// Function to check if the hostname is a private IP
function isPrivateIP(ip) {
  const parts = ip.split('.').map(Number);
  return (
    parts[0] === 10 || 
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

const isValidHost = function(requestHostname){
  return hosts.includes(requestHostname);
};

const isValidRoute = function (requestUrl) {
  if (!requestUrl) return false;

  const splitUrl = requestUrl.split('?')[0];
  let valid_route = false;
  paths.forEach(function (path) {
    if (pathToRegexp(path).test(splitUrl)) {
      valid_route = true;
      return false;
    }
  });
  return valid_route;
};

const isValidUseragent = function (requestUserAgent) {
  if (!requestUserAgent) return false;
  let valid_useragent = true; // Assume user agent is valid (not a crawler)

  // Detect crawlers
  if (requestUserAgent) {
    const ua = useragent.parse(requestUserAgent);
    const isCrawler = ua.isBot || ua.isCurl || ua.isPhantomJS || ua.isSelenium;
    if (isCrawler) valid_useragent = false; // User agent is a crawler
  }

  return valid_useragent;
};

const logConnectionError = function (payload, req) {

  if(typeof req === 'object' && typeof req.headers === 'object'){
    payload.host = req.headers['x-forwarded-host'] || req.headers['host'];
    payload.connection = req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(",")[0] || 
       req.connection.remoteAddress || 
       req.socket.remoteAddress ||
       req.connection.socket.remoteAddress;
  };

  var event = {
      timestamp: koad.format.timestamp(new Date()),
      environment: koad.environment,
      created: new Date(),
      class: "danger",
      icon: 'fa fa-warning',
      method: `SERVER::${payload.code}`,
      ...payload
  };
  log.warning(`${payload.code}: ${payload.host}: ${payload.message}`);
  log.debug({event})
  ApplicationErrors.insert( event );

};

Meteor.startup(() => {

  let routeList = Router.routes;
  routeList.forEach(function(route){
    if(route && route._path && (paths.indexOf(route._path) == -1)) paths.push(route._path);
  });

  // Return a 404 HTTP response if the route doesn't exist
  // TODO: Create error pages in /public/errorpages/ and use one here.
  WebApp.connectHandlers.use('/', (req, res, next) => {
  
    if(!isValidUseragent(req.headers['user-agent'])){
      logConnectionError({
        code: 403,
        type: 'invalid useragent',
        message: `useragent invalid for ${req.headers['user-agent']}`
      }, req);

      // TODO: is this a Crawler?
      // TODO: Handle crawler requests
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('403 Forbidden - Crawlers are not allowed on this page.');
      return;

      // TODO: Check and see if we are dealing with an oembed, and if so, SSR some metadata and pass it back.

    } else if(!req.headers["host"] || !isValidHost(req.headers["host"])){

      logConnectionError({
        code: 400,
        type: 'invalid hostname',
        message: `host invalid for ${req.headers["host"]}`
      }, req);

      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('400 Bad Request');

    } else if(req.url && isValidRoute(req.url)){
      // Route exists,
      // useragent is not crawler
      // let iron router render it    
      return next(); 

    } else {
      // console.log('', req.url);

      logConnectionError({
        code: 404,
        type: 'not found',
        message: `File not found for ${req.url}`
      }, req);

      res.writeHead(404, {'Content-Type': 'text/html'});
      res.end();

      // If you want to leave a message, otherwise the browsers default 404 shit will appear
      // html = "404"; 
      // res.end(html);
    }
  });

  log.start('serving /oembed')
  // Serve oEmbed metadata for specific crawlers (e.g., Discord and Twitter)
  WebApp.connectHandlers.use('/oembed', (req, res) => {

    const oEmbedUrl = req.query.url; // Get the content URL from the 'url' query parameter
    const useragentString = req.headers['user-agent'];
    const ua = useragent.parse(useragentString);

    // Detect Discord and Twitter crawlers
    if (oEmbedUrl && (ua.isDiscord || ua.isTwitter)) {

      // TODO: Implement logic to fetch and generate oEmbed data based on the oEmbedUrl
      // For example, you can use an oEmbed library or make an HTTP request to fetch oEmbed data.
      // For the purpose of this example, we'll return a placeholder oEmbed response.

      // const oEmbedData = {
      //   // Customize oEmbed metadata based on the content URL
      //   type: "rich",
      //   version: "1.0",
      //   title: "Your Title",
      //   description: "Your Description",
      //   // Add more fields as needed based on the specific requirements of your oEmbed implementation
      // };

      logConnectionError({
        code: 500,
        type: 'oembed unready',
        message: `embed accessed, twitter or discord type`

      }, req);

      // res.writeHead(200, {'Content-Type': 'application/json'});
      // res.end(JSON.stringify(oEmbedData));
      res.writeHead(404, {'Content-Type': 'text/html'});
      res.end();
    } else {
      // Other crawlers, serve a 404 response
      logConnectionError({
        code: 500,
        type: 'unknown crawler',
        message: `embed accessed, but unknown crawler type`,
        useragent: ua
      }, req);

      res.writeHead(404, {'Content-Type': 'text/html'});
      res.end();
    }
  });

});
