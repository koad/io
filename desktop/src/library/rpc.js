const axios = require("axios");
const { log, chuck, clearConsole } = require("./logger");

const axiosWrapper = function (config) {
  const { user, password, host, port } = config;
  const url = `http://${host}:${port}`;
  const auth = `Basic ${Buffer.from(user + ":" + password).toString("base64")}`;

  return {
    insane: false,
    enabled: false,
    cmd: async (method, params) => {
      try{
        const now = new Date();
        const id = Date.now();
        const options = { headers: { Authorization: auth }};
        const res = await axios.post(url, { id, method, params, timeout: 15000  }, options);
        const json = await res.data;
        console.log('time', new Date()-now)
        return json;

      } catch(e){
        method
        log.fatal(method)
        log.fatal(e)

      }
    }
  } 
};

const fetchP = import('node-fetch').then(mod => mod.default)
const fetch = (...args) => fetchP.then(fn => fn(...args))
const fetchWrapper = function (config) {
  const { user, password, host, port } = config;
  const url = `http://${host}:${port}`;
  const auth = `Basic ${Buffer.from(user + ":" + password).toString("base64")}`;

  return {
    insane: false,
    enabled: false,
    cmd: async (method, params) => {
      const id = Date.now();
      const body = JSON.stringify({ id, method, params });

      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": auth,
          "Content-Length": body.length,
        },
        body,
      };

      const res = await fetch(url, options);
      if(res.status == 500) throw new Error(`${res.statusText} [${res.status}]`);
      if(res.status == 404) throw new Error(`not found [${res.status}]`);
      if(res.status == 403){

        // console.log('status', res);
        console.log('status', res.status);
        throw new Error(`old daemon! [${res.status}]`);
      }
      if(res.status != 200) throw new Error(`${res.statusText} [${res.status}]`);

      const json = await res.json();
      return json.result;
    }
  } 
};

const rpcSanityCheck = async function (daemon) {

  const upstart = new Date();
  const info =  await daemon.cmd('getblockchaininfo', []);
  const blockchaininfo = info;

  const getGenesisBlockHash =  await daemon.cmd('getblockhash', [0]);
  const genesisBlockHash = getGenesisBlockHash;
  // log.debug({genesisBlockHash})

  const getGenesisBlock =  await daemon.cmd('getblock', [genesisBlockHash]);
  const genesisBlock = getGenesisBlock;
  // log.debug({genesisBlock})

  const getBlockCount =  await daemon.cmd('getblockcount');
  const blockCount = getBlockCount;
  // log.debug({getBlockCount})

  const getMemoryInfo =  await daemon.cmd('getmemoryinfo');
  const memoryUsageInfo = getMemoryInfo;

  log.info({
    type: 'sanity check',
    time: new Date() - upstart,
    date: new Date(),
    error: false,
    result: {
      genesis: genesisBlockHash,
      time: genesisBlock.time,
      date: new Date(Number(genesisBlock.time) * 1000),
      height: blockchaininfo.blocks,
      network: blockchaininfo.chain,
      memory: memoryUsageInfo,
      getmininginfo: (await daemon.cmd('getmininginfo', [])),
      getconnectioncount: (await daemon.cmd('getconnectioncount', [])),
      getpeerinfo: (await daemon.cmd('getpeerinfo', [])),
      listbanned: (await daemon.cmd('listbanned', [])),
    }
  });

  if(blockchaininfo.verificationprogress < 1){
     log.debug('wallet is syncing');
  }else if(!genesisBlockHash){
    console.log('genesis block hash not found: insane!')
    daemon.insane = true;
  } else if(!genesisBlock.time ){
    console.log('genesis block time not found: insane!')
    daemon.insane = true;
  } else daemon.insane = false;
  return true;
};

module.exports = {
  axios,
  rpcSanityCheck,
  axiosWrapper,
  fetchWrapper
};
