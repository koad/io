const { log, chuck, clearConsole } = require("./logger");
const ElectrumClient = require('@eCoinCore/electrum-client-js');

const SLOWDOWN_MARGIN = 100
const { getScriptHashFromAddress, scriptHash, ioMapper, sum } = require("./utilities");

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
    log.fatal('an error occured while getTxDetails')
    log.fatal(e)
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

const electrumWrapper = async function (config) {

  const { ip, host, ssl, ecoincore } = config;
  let upstart = new Date();

    try {
        const electrum = new ElectrumClient(config.host, config.ssl, 'ssl');
        log.debug(`Connecting to ${ip}/${host} on port ${ssl}`)

        await electrum.connect();
        log.success('connected!', ecoincore);
        electrum.network = network;
        this.electrum = electrum;
        return electrum

    } catch(e){ chuck(e) };

};

async function performTests(config) {
    let upstart = new Date();
    let payload = await connectToElectrum(config)
    log.start(server);
    let { electrum, header} = payload;

    const peers = await electrum.server_peers_subscribe();
    console.log(peers)
};

module.exports = {
  electrumWrapper,
  ElectrumClient,
  performTests,
  unconfirmed, 
  balance, 
  history, 
  unspent, 
  all,
  getTx, getTxDetails,
  parseBlock,
  parseTransaction,
};
