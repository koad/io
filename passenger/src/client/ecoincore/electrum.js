return 

const MINUTES = 60000;


const main = async () => {
  try {
    
    console.log('asserting electrum service for CDN')

    await eCoinCore.fn.assertElectrumConnection('CDN')

    return
    electrum.subscribe.on('blockchain.headers.subscribe', (blob)=>{
      console.log("headers.subscribe", blob);
    });
    
    electrum.subscribe.on('blockchain.scripthash.subscribe', (blob)=>{
      console.log("scripthash.subscribe", blob);
    });

    await electrum.connect()

    const header = await electrum.blockchain_headers_subscribe()
    console.log('Latest header:', header)

    const scripthashStatus = await electrum.blockchain_scripthash_subscribe('f3aa57a41424146327e5c88c25db8953dd16c6ab6273cdb74a4404ed4d0f5714')
    console.log('Latest scripthash status:', scripthashStatus)

    console.log('Waiting for notifications...')

    // Keep connection alive.
    setInterval(async ()=>{
      await electrum.server_ping()
    }, 8 * MINUTES)

  } catch (error) {
    console.error({error})
  }
}

main();






return;

const ElectrumClient = require('@eCoinCore/electrum-client-js');

const ma3in = async () => {
  try {
    const electrum = new ElectrumClient('woolloomooloo.ecoincore.com', 34335, 'wss')
    
    electrum.subscribe.on('blockchain.headers.subscribe', (blob)=>{
      console.log("headers.subscribe", blob);
    });
    
    electrum.subscribe.on('blockchain.scripthash.subscribe', (blob)=>{
      console.log("scripthash.subscribe", blob);
    });

    await electrum.connect()

    const header = await electrum.blockchain_headers_subscribe()
    console.log('Latest header:', header)

    const scripthashStatus = await electrum.blockchain_scripthash_subscribe('f3aa57a41424146327e5c88c25db8953dd16c6ab6273cdb74a4404ed4d0f5714')
    console.log('Latest scripthash status:', scripthashStatus)

    console.log('Waiting for notifications...')

    // Keep connection alive.
    setInterval(async ()=>{
      await electrum.server_ping()
    }, 8 * MINUTES)

  } catch (error) {
    console.error({error})
  }
}

ma3in();



const SLOWDOWN_MARGIN = 100
// const { getScriptHashFromAddress, scriptHash, ioMapper, sum } = require("./utilities");

const TEST_ADDRESS='CYmBPMksnSN4g2xoo6cqdQMfUFgR82tQUv';
const network = {
  messagePrefix: '\x19Canada eCoin Signed Message:\n',
  genesis: 'ceac4f4dc5aa01eb7fe5b36410cd7a1cb0f89856c76401a69d1b30fb8bc0e3bf',
  bech32: 'cdn',
  bip32: {
      public: 0x0488b21e,
      private: 0x0488ade4,
  },
  pubKeyHash: 0x1c,
  scriptHash: 0x05,
  wif: 0x9C,
  dustThreshold: 0,
  isPoS: false,
  dnsSeeds: [
      'seed1.canadaecoin.ca',
      'seed2.canadaecoin.ca',
  ]
};





const electrumWrapper = async function (config) {

  const { ip, host, ssl } = config;
  let upstart = new Date();

    try {
        console.log(`Connecting to ${ip}/${host} on port ${ssl}`)
        const electrum = new ElectrumClient(config.host, config.ssl, 'ssl');

        await electrum.connect();
        console.success('connected!');
        electrum.network = network;
        // this.electrum = electrum;
        return electrum

    } catch(e){ console.error(e) };

};



electrumWrapper({
  ip: '45.76.117.104',
  host: 'woolloomooloo.ecoincore.com',
  ssl: 34333,
  ecoincore: '10.10.10.10',
});
return;













// const history = async function (req, res) {
//   return this.electrum.blockchain_scripthash_getHistory(await scriptHash(req));
// };

// const balance = async function (req, res) {
//   return this.electrum.blockchain_scripthash_getBalance(await scriptHash(req));
// };

const getTx = async function (txhash) {
    return this.electrum.blockchain_transaction_get(txhash, true);
};

const getTxDetails = async function (txhash) {
  try{

    const { vin, vout, confirmations, blockhash, time, size, txid, hash } = await getTx(txhash);
    if(!txid) txid = hash;
    const outputs = vout.map(ioMapper);
    const inputs = await Promise.all(
      vin.map(async ({ txid, vout }) => {
        if(!txid || !vout) return;
        return ioMapper((await getTx(txid)).vout[vout])
      })
    );

    const fee = parseFloat((sum(inputs) - sum(outputs)).toFixed(8));
    return { txid, fee, sum: sum(outputs), inputs, outputs, size };

  } catch(e){
    console.fatal('an error occured while getTxDetails')
    console.fatal(e)
    chuck(e)
  }


};

const balance = async function (address) {
  const scriptHash = await getScriptHashFromAddress(address, this.electrum.network);
  const balance = this.electrum.blockchain_scripthash_getBalance(scriptHash);
  return balance;
};

const history = async function (address) {
  const scriptHash = await getScriptHashFromAddress(address, this.electrum.network);
  return this.electrum.blockchain_scripthash_getHistory(scriptHash);
};

const unspent = async function (address) {
  const scriptHash = await getScriptHashFromAddress(address, this.electrum.network);
  return this.electrum.blockchain_scripthash_listunspent(scriptHash);
};

const unconfirmed = async function (address) {
  const scriptHash = await getScriptHashFromAddress(address, this.electrum.network);
  return this.electrum.blockchain_scripthash_getMempool(scriptHash);
};

const all = async function (address) {
  const scriptHash = await getScriptHashFromAddress(address, this.electrum.network);
  const [balance, unspent, history_slim] = await Promise.all(
    [
      "blockchain_scripthash_getBalance",
      "blockchain_scripthash_listunspent",
      "blockchain_scripthash_getHistory",
    ].map((m) => this.electrum[m](scriptHash))
  );

  const history = await Promise.all(
    history_slim.map(({ tx_hash }) => parseTransaction(tx_hash))
  );
  return { balance, unspent, history, scriptHash };
};

const parseBlock = async (blockhash) => {
  const block = (await rpcClient("getblock", [blockhash, 2])).data.result;

  const transaction = async ({ vout, vin, txid, size }) => {
    const outputs = vout.map(ioMapper);
    const inputs = await Promise.all(
      vin
        .filter((t) => !t.coinbase)
        .map(async ({ txid, vout }) => ioMapper((await getTx(txid)).vout[vout]))
    );

    const fee = txFee(inputs, outputs);

    return { txid, fee, sum: sum(outputs), inputs, outputs, size };
  };

  const transactions = await Promise.all(block.tx.map(transaction));

  return {
    ...pick(block, [
      "hash",
      "confirmations",
      "size",
      "height",
      "time",
      "difficulty",
      "previousblockhash",
      "nextblockhash",
      "hash",
    ]),
    transactions,
    transferred: sumByKey(transactions, "sum"),
    totalFees: sumByKey(transactions, "fee"),
  };
};


const parseTransaction = async (txhash) => {
  const { vin, vout, confirmations, blockhash, time, size, txid } = await getTx(
    txhash
  );

  const outputs = vout.map(ioMapper);

  const inputs = await Promise.all(
    vin.map(async ({ txid, vout }) => ioMapper((await getTx(txid)).vout[vout]))
  );

  const fee = parseFloat((sum(inputs) - sum(outputs)).toFixed(8));

  return { txid, fee, sum: sum(outputs), inputs, outputs, size };
};

async function performTests(config) {
    let upstart = new Date();
    let payload = await connectToElectrum(config)
    console.start(server);
    let { electrum, header} = payload;

    const peers = await electrum.server_peers_subscribe();
    console.log(peers)
};

