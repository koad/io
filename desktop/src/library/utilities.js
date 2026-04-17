const coin = require("bitcoinjs-lib");
const axios = require("axios");
const dns = require('dns');

const path = require('path');
const fs = require('fs');

const sleep = ms => {
	return new Promise(resolve => setTimeout(resolve, ms))
}

const getScriptHashFromAddress = (address, network) => {
	const script = coin.address.toOutputScript(address, network);
	const hash = coin.crypto.sha256(script);
	return new Buffer.from(hash.reverse()).toString("hex");
};

const coinRpc = ({ user, password, host, port }) => {
	const url = `http://${host}:${port}`;
	const auth = `Basic ${Buffer.from(user + ":" + password).toString("base64")}`;
	const id = Date.now();
	const options = { headers: { Authorization: auth } };
	return (method, params) => axios.post(url, { id, method, params }, options);
};

const sumByKey = (arr, key) => arr.reduce((sum, i) => (sum += i[key]), 0);

const sum = (arr) => sumByKey(arr, "value");

const txFee = (inputs, outputs) =>
	inputs.length > 0 ? parseFloat((sum(inputs) - sum(outputs)).toFixed(8)) : 0;

function pick(o, props) {
	return Object.assign({}, ...props.map((prop) => ({ [prop]: o[prop] })));
}


function hexToString (hex) {
    var string = '';
    for (var i = 0; i < hex.length; i += 2) {
      string += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
    }
    return string;
}


const getBitcoinJSLibOptions = (Chainpack)=>{
	if(!Chainpack || !Chainpack.network || !Chainpack.network.base58)
		return;

	const base58 = Chainpack.network.base58
	let blockchain = {
		messagePrefix: String(Chainpack.message), //TODO: prefix needs to be added corresponding to the length of the message ie: '\x19Can...'
		bip32: { public: base58.ext_pub, private: base58.ext_prv },
		pubKeyHash: Number(base58.public),
		scriptHash: Number(base58.script),
		wif: Number(base58.secret)
	} 

	if(!blockchain.messagePrefix || !blockchain.bip32 || !blockchain.bip32.public || 
		!blockchain.bip32.private || !blockchain.pubKeyHash  || !blockchain.scriptHash || 
		!blockchain.wif) return

	if(Chainpack.network.bech32_hrp) blockchain.bech32 = Chainpack.network.bech32_hrp;
	return blockchain;
};

async function lookupDomainForIp(ip) {
		return new Promise((resolve, reject) => {
		dns.reverse(ip,function(err,domains){
			if(err) reject(err);
			resolve(domains);
		});
	});
}

async function lookupIpForDomain(domainName){
	return new Promise((resolve, reject) => {
		dns.lookup(domainName, (err, address, family) => {
			if(err) reject(err);
			resolve(address);
		});
	});
};

function getUserHome() {
	return process.env[(process.platform == 'win32') ? 'USERPROFILE' : 'HOME'];
}

async function ensureDirectoryExists(folder) {
	return fs.statSync(folder);
}

function promiseAllP(items, block) {
	var promises = [];
	items.forEach(function(item,index) {
		promises.push( function(item,i) {
			return new Promise(function(resolve, reject) {
				return block.apply(this,[item,index,resolve,reject]);
			});
		}(item,index))
	});
	return Promise.all(promises);
} 

function readFiles(dirname) {
	return new Promise((resolve, reject) => {
		fs.readdir(dirname, function(err, filenames) {
			if (err) return reject(err);
			promiseAllP(filenames, (filename,index,resolve,reject) =>  {
				fs.readFile(path.resolve(dirname, filename), 'utf-8', function(err, content) {
					if (err) return reject(err);
					return resolve({filename: filename, contents: content});
				});
			})
			.then(results => { return resolve(results) })
			.catch(error => { return reject(error) });
		});
	});
};



const ioMapper = ({ value, scriptPubKey: { addresses } }) => ({
  value,
  addresses,
});




const scriptHash = async ({ params: { address } }) =>
  getScriptHashFromAddress(address, network);




module.exports = {
	getScriptHashFromAddress,
	coinRpc,
	sumByKey,
	txFee,
	sum,
	pick,
	getBitcoinJSLibOptions,
	lookupDomainForIp,
	lookupIpForDomain,
	sleep,
	getUserHome,
	readFiles,
	ensureDirectoryExists,
	ioMapper,
	scriptHash,

};
