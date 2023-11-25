// TODO: make good crypto exist here
const bip39 = require('bip39');
const bip32 = require('bip32');
const crypto = require('crypto');

let privateKey;

debug = function() { 
	return process.env.DEBUG || false; 
};

allow = function() {
	return true;
};

deny = function() {
	return false;
};

DEBUG = debug();
ALLOW = allow();
DENY = deny();

if(!koad.calculate) koad.calculate = {};
if(!koad.generate) koad.generate = {};
if(!koad.export) koad.export = {};

koad.library.bip32 = bip32;
koad.library.bip39 = bip39;
koad.library.crypto = crypto;

koad.generate.uuid = function() {
  return Random.id();
};

koad.generate.nonce = function() {
  const array = new Uint32Array(4);
  window.crypto.getRandomValues(array);
  return Array.from(array).map(val => val.toString(16)).join('');
};

koad.generate.device = function(device) {
  return {
  	...device,
    nonce: koad.generate.generateNonce(),
    ntime: Math.floor(Date.now() / 1000) // Unix timestamp
  };
};

koad.generate.checksum = function generateChecksum(obj) {
  const jsonStr = JSON.stringify(obj);
  const checksum = crypto.createHash('sha256').update(jsonStr).digest('hex');
  return checksum;
};

koad.generate.mnemonic = function(wordCount = 12) {
  try {
    // Generate a new BIP39 mnemonic
    const mnemonic = bip39.generateMnemonic(256); // 256 bits of entropy for 24 words

    // Return the generated mnemonic
    return mnemonic;
  } catch (error) {
    console.error('Error generating mnemonic:', error);
    return null;
  }
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


// TODO: this would only really work if there is no password on the mnemonic phrase 🤔
koad.export.xpub = async (mnemonic)=>{
  if (bip39.validateMnemonic(mnemonic)) {
    console.log("validated mnemonic");
  } else {
    //Invalid Mnemonic
    console.log("Invalid Mnemonic");
    return;
  };
        
  const bip39Passphrase=""
  const seed = bip39.mnemonicToSeedSync(mnemonic, bip39Passphrase);
  const node = bip32.fromSeed(seed);
  // const node = bip32.fromSeed(seed, networkOptions);
  const strng = node.toBase58();
  const restored = bip32.fromBase58(strng);
  const wif = node.toWIF();
  const xpub = node.neutered().toBase58();
  return xpub;
};

koad.calculate.sizeInBytes = function(obj) {
  const sanitizedObj = JSON.parse(JSON.stringify(obj, (key, value) => {
    return typeof value === 'function' ? undefined : value;
  }));

  const jsonString = JSON.stringify(sanitizedObj);
  return new Blob([jsonString], {type: 'application/json'}).size;
};

