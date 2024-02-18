debug = function() { 
	return process.env.DEBUG || false; 
};

allow = function() {
	return true;
};

deny = function() {
  return false;
};

ensureCrypto = function() {
  // Meteor 3 runs node 18, less than 3 == node 14, where our crypto is shit.
  // Avoid using meteor;s node with crypto, wrap that shit up; luckly no user in the
  // terminal generaelly, so no need for many crypto functions.
  if(Meteor.isServer){
      const majorVersion = Meteor.release.split('@')[1].split('.')[0];
      console.log({majorVersion})
      if (majorVersion != "3") {
        console.log('Meteor 3.0 (node 18) required to generate good crypto on the server,');
        return false;
      } else return true;
  } else return true;
};

DEBUG = debug();
ALLOW = allow();
DENY = deny();

if(!koad.calculate) koad.calculate = {};
if(!koad.generate) koad.generate = {};

koad.generate.uuid = function() {
  return Random.id();
};

koad.generate.nonce = function(n = 24) {
  return Random.hexString(n)
};

koad.generate.checksum = function generateChecksum(obj) {
  const jsonStr = JSON.stringify(obj);

  function fallbackSha256(str) {
    // A very basic and not secure hash function as a placeholder
    // Replace this with a proper implementation or library for production use
    let hash = 0, i, chr;
    if (str.length === 0) return '00';
    for (i = 0; i < str.length; i++) {
      chr   = str.charCodeAt(i);
      hash  = ((hash << 5) - hash) + chr;
      hash |= 0; // Convert to 32bit integer
    }
    return hash.toString(16).padStart(64, '0');
  }

  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    // Browser environment
    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(jsonStr))
      .then(hashBuffer => {
        const hashArray = Array.from(new Uint8Array(hashBuffer)); // Convert buffer to byte array
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // Convert bytes to hex string
        return hashHex;
      })
      .catch(error => {
        console.error('Error generating checksum:', error);
        return null;
      });
  } else if (typeof require === 'function' && Meteor.isServer) {
    // Node.js environment
    const crypto = require('crypto');
    const checksum = crypto.createHash('sha256').update(jsonStr).digest('hex');
    return Promise.resolve(checksum);
  } else {
    // Fallback for other environments
    console.warn('Using fallback method for checksum generation');
    const checksum = fallbackSha256(jsonStr);
    return Promise.resolve(checksum);
  }
};



koad.generate.device = async function(device) {
  if(!ensureCrypto()) return console.error('Unsupported environment for device generation');

  device = {
    ...device,
    mnemonic: koad.generate.mnemonic(),
    nonce: koad.generate.nonce(),
    ntime: Math.floor(Date.now() / 1000) // Unix timestamp
  };

  // Wait for the checksum to be generated
  device.checksum = await koad.generate.checksum(device);
  return device;
};


koad.generate.replacer = () => {
  const seen = new WeakSet();
  return (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return;
      }
      seen.add(value);
    }
    return value;
  };
};

koad.calculate.sizeInBytes = function(obj) {
  const sanitizedObj = JSON.parse(JSON.stringify(obj, (key, value) => {
    return typeof value === 'function' ? undefined : value;
  }));

  const jsonString = JSON.stringify(sanitizedObj);
  return new Blob([jsonString], {type: 'application/json'}).size;
};

koad.generate.mnemonic = function(wordCount = 24) {

  if(!ensureCrypto()) return console.error('Unsupported environment for checksum generation');
  try {
    // Map word count to strength (entropy in bits)
    const strengths = { 12: 128, 15: 160, 18: 192, 21: 224, 24: 256 };

    const strength = strengths[wordCount];
    if (!strength) throw new Error('Invalid word count. Must be 12, 15, 18, 21, or 24.');


    import { generateMnemonic } from '@scure/bip39';
    import { wordlist } from '@scure/bip39/wordlists/english';

    // Generate a new BIP39 mnemonic
    const mnemonic = generateMnemonic(wordlist, strength);

    // Return the generated mnemonic
    return mnemonic;

  } catch (error) {
    console.error('Error generating mnemonic:', error);
    return null;
  }
};


koad.collection = function createCollection(name, type) {
    let collection;

    if (type === 'persistent') {

        if(Meteor.isServer && process.env.KOAD_IO_PORTABLE === "true") return new Meteor.error('env KOAD_IO_PORTABLE set to true, cannot make persistent collection!');
        // Standard MongoDB backed collection
        collection = new Mongo.Collection(name);

        // If on the client, persist the collection to localStorage
        if (Meteor.isClient) new LocalPersist(collection, name);

    } else if (type === 'local') {
        // Local collection
        if (Meteor.isServer) {
            collection = new Mongo.Collection(name, { connection: null });
        } else {
            // Named local collection on client
            collection = new Mongo.Collection(null);
            new LocalPersist(collection, name);
        }

    } else {
        // Default behavior based on APP_IS_PORTABLE or name undefined
        if (process.env.KOAD_IO_PORTABLE || name === undefined) {
            if (Meteor.isServer) {
                collection = new Mongo.Collection(name, { connection: null });
            } else {
                collection = new Mongo.Collection(null);
                new LocalPersist(collection, name);
            }
        } else {
            // Standard MongoDB backed collection
            collection = new Mongo.Collection(name);
        }
    }

    return collection;
}


