const ws = require("isomorphic-ws");
const { log, chuck, clearConsole } = require("../library/logger");

var EventEmitter = require('./event_emitter');
var inherits = require('./inherits');


module.exports = Socket;

inherits(Socket, EventEmitter);

function Socket() {
  var self = this;
  EventEmitter.call(self);
  self.isConnected = false;
  createWs();

  function createWs() {
    // log.info('opening socket to disco.koad.sh');
    var hostName = 'disco.koad.sh';
    var pathname = '/';
    var isHttps = true;
    var port = 16242;
    var wsProto = isHttps ? "wss:" : "ws:";
    var wsUrl = wsProto + '//' + hostName + ':' + pathname;
    self.ws = new ws(wsUrl);

    self.ws.addEventListener('message', onMessage, false);
    self.ws.addEventListener('error', timeoutThenCreateNew, false);
    self.ws.addEventListener('close', timeoutThenCreateNew, false);
    self.ws.addEventListener('open', onOpen, false);

    function onOpen() {
      self.isConnected = true;
      // log.info('connected to', wsUrl);
      self.emit('connect');
    }


    function onMessage(ev) {
      var msg = JSON.parse(ev.data);
      if(msg.name === "seek") {
        // log.debug('clearStreamBuffer');
        // clearStreamBuffer();
      } else if (msg.name === 'queue') {
        // log.debug('queue updated');
        self.queue = msg.args;
      } else if (msg.name === 'currentTrack') {
        // log.debug('currentTrack updated');
        self.currentTrack = msg.args;
      } else if (msg.name === 'libraryQueue') {
        // log.debug('library updated');
        self.library = msg.args;
        // log.debug(self.library);
      };

      self.emit(msg.name, msg.args);
    }

    function timeoutThenCreateNew() {
      self.ws.removeEventListener('error', timeoutThenCreateNew, false);
      self.ws.removeEventListener('close', timeoutThenCreateNew, false);
      self.ws.removeEventListener('open', onOpen, false);
      if (self.isConnected) {
        self.isConnected = false;
        self.emit('disconnect');
      }
      setTimeout(createWs, 1000);
    }
  }
}

Socket.prototype.send = function(name, args) {
  this.ws.send(JSON.stringify({
    name: name,
    args: args,
  }));
};
