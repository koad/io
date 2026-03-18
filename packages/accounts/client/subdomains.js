// from > https://raw.githubusercontent.com/jfrolich/meteor-subdomain-persistent-login/


const expiresAfterDays = 365;
const cookieName = 'meteor_subdomain_token';
const domain = Meteor.settings.public.wildcardRoot;
if(!domain) return;

// based on the kadirahq/fast-render package, might collide!
const defaultOptions = { expiresAfterDays, cookieName }

// parse cookie string and look for the login token
const getToken = () => {
  if (document.cookie.length > 0) {
    for (const cookieKeyValue of document.cookie.split(';')) {
      const cookie = cookieKeyValue && cookieKeyValue.split('=') || []
      if (cookie.length > 1 && cookie[0].trim() === cookieName) {
        return cookie[1].trim()
      }
    }
  }
}

function initSubdomainPersistentLogin( meteor, domains ) {
  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  const setCookieToken = (token, domain, expirationDate) => {
    const expires = expirationDate.toUTCString()
    document.cookie = `${cookieName}=${token}; expires=${expires}; domain=${domain}; path=/`
  }

  const setToken = (loginToken, expires) => {
    domains.map(domain => setCookieToken(loginToken, domain, expires))
  }

  const removeToken = () => setToken(null, new Date('1.1.1970'))


  // --------------------------------------------------------------------------
  // Monkey Patching
  // --------------------------------------------------------------------------

  // override the getter, so in a different subdomain it will get the token
  // from a cookie first when a logintoken in localstorage is not found
  const originalGetItem = meteor._localStorage.getItem
  meteor._localStorage.getItem = (key) => { // eslint-disable-line no-param-reassign
    const original = originalGetItem.call(meteor._localStorage, key)
    if (key === 'Meteor.loginToken') {
      // in case there is no login token in local storage, try get it from a cookie
      if (!original) return getToken()
    }

    return original
  }

  // override Meteor._localStorage methods and resetToken accordingly
  const originalSetItem = meteor._localStorage.setItem
  meteor._localStorage.setItem = (key, value) => { // eslint-disable-line no-param-reassign
    if (key === 'Meteor.loginToken') {
      const loginTokenExpires = meteor._localStorage.getItem('Meteor.loginTokenExpires')

      let date
      if (loginTokenExpires) {
        date = new Date(loginTokenExpires)
      } else {
        date = new Date()
        date.setDate(date.getDate() + expiresAfterDays)
      }

      setToken(value, date)
    }

    originalSetItem.call(meteor._localStorage, key, value)
  }

  const originalRemoveItem = meteor._localStorage.removeItem
  meteor._localStorage.removeItem = (key) => { // eslint-disable-line no-param-reassign
    if (key === 'Meteor.loginToken') removeToken()
    originalRemoveItem.call(meteor._localStorage, key)
  }
}

if(Meteor.settings.public.wildcardRoot) {
  if(DEBUG) console.log('koad:io - patching in subdomain login');
  initSubdomainPersistentLogin( Meteor, [`.${Meteor.settings.public.wildcardRoot}`], { expiresAfterDays, cookieName });
}

// Define a simpler login function, since we will use this soley as our front door.
Login = function(token){
  if(Meteor.user()) return console.log('You are already logged in.,.. :|');
  Meteor.loginWithToken(token);
};

Logout = function(){
  Meteor.logout();
};
