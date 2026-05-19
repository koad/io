'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var DDPClient = function () {
    // { coll_name => {docId => {doc}, docId => {doc}, ...} }
    // { pub_name => deferred_id }

    function DDPClient(uriOrSocket) {
        var _this = this;

        var _ref = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];

        var collections = _ref.collections;

        _classCallCheck(this, DDPClient);

        this.sock = null;
        this.connected = false;
        this.defs = {};
        this.subs = {};
        this.watchers = {};
        this.collections = {};
        this._trackCollections = true;
        this._connectDeferred = null;
        this._ids = {
            count: 0,
            next: function next() {
                return String(++this.count);
            }
        };

        // process opts first so we're ready before connecting
        if (collections === false) {
            this._trackCollections = false;
        }

        if (typeof uriOrSocket === 'string') {
            this.sock = new WebSocket(uriOrSocket);
        } else {
            this.sock = uriOrSocket;
        }

        var d = this._connectDeferred = new DDPClient.Deferred();

        this.sock.onerror = d.reject.bind(d);

        this.sock.onopen = function () {
            _this.send({
                msg: 'connect',
                version: DDPClient.VERSIONS[0],
                support: DDPClient.VERSIONS
            });
        };

        this.sock.onmessage = function (wsMessage) {
            var data = JSON.parse(wsMessage.data);var msg = data.msg;
            console.log(data);
            if (msg === 'connected') {
                this.connected = true;
                return d.resolve(data);
            } else if (msg) {
                var handler = _this['_on' + msg];
                if (!handler) {
                    console.warn('no handler for message', msg, data);
                    return;
                }
                handler.call(_this, data);
            }
        };
    } // { coll_name => [cb1, cb2, ...] }
    // { deferred_id => deferred_object }


    _createClass(DDPClient, [{
        key: '_onresult',


        // -- message handlers --
        value: function _onresult(data) {
            if (data.error) {
                this.defs[data.id].reject(data.error.reason);
            } else if (typeof data.result !== 'undefined') {
                this.defs[data.id].resolve(data.result);
            }
        }
    }, {
        key: '_onupdated',
        value: function _onupdated(msg) {
            // TODO method call was acked
        }
    }, {
        key: '_onchanged',
        value: function _onchanged(_ref2) {
            var collection = _ref2.collection;
            var id = _ref2.id;
            var fields = _ref2.fields;
            var cleared = _ref2.cleared;
            var msg = _ref2.msg;

            var doc = void 0;
            if (this._trackCollections) {
                doc = this.collections[collection][id];
                if (fields) {
                    Object.assign(doc, fields);
                }
                if (cleared) {
                    cleared.forEach(function (field) {
                        return delete doc[field];
                    });
                }
            } else {
                doc = fields;
            }

            this._notifyWatchers(collection, doc, id, msg);
        }
    }, {
        key: '_onadded',
        value: function _onadded(_ref3) {
            var collection = _ref3.collection;
            var id = _ref3.id;
            var fields = _ref3.fields;
            var msg = _ref3.msg;

            if (this._trackCollections) {
                this.collections[collection] = this.collections[collection] || {};
                this.collections[collection][id] = fields;
            }

            this._notifyWatchers(collection, fields, id, msg);
        }
    }, {
        key: '_onremoved',
        value: function _onremoved(_ref4) {
            var collection = _ref4.collection;
            var id = _ref4.id;
            var msg = _ref4.msg;

            var doc = null;
            if (this._trackCollections) {
                doc = this.collections[collection][id];
                delete this.collections[collection][id];
            }
            this._notifyWatchers(collection, doc, id, msg);
        }
    }, {
        key: '_onready',
        value: function _onready(_ref5) {
            var _this2 = this;

            var subs = _ref5.subs;

            subs.forEach(function (id) {
                return _this2.defs[id].resolve();
            });
        }
    }, {
        key: '_onnosub',
        value: function _onnosub(_ref6) {
            var error = _ref6.error;
            var id = _ref6.id;

            if (error) {
                this.defs[id].reject(error.reason || 'Subscription not found');
            } else {
                this.defs[id].resolve();
            }
        }
    }, {
        key: '_onmovedBefore',
        value: function _onmovedBefore(data) {
            // TODO
        }
    }, {
        key: '_onping',
        value: function _onping(_ref7) {
            var id = _ref7.id;

            var pong = { msg: 'pong' };
            if (id !== undefined) {
                pong.id = id;
            }
            this.send(pong);
        }
        // -- END message handlers--

    }, {
        key: '_notifyWatchers',
        value: function _notifyWatchers(collName, doc, docId, message) {
            doc = Object.assign({}, doc); // make a copy
            doc._id = docId; // id might be useful to watchers, attach it.

            if (!this.watchers[collName]) {
                this.watchers[collName] = [];
            }
            this.watchers[collName].forEach(function (fn) {
                return fn(doc, message);
            });
        }
    }, {
        key: 'connect',
        value: function connect() {
            return this._connectDeferred.promise();
        }
    }, {
        key: '_deferredSend',
        value: function _deferredSend(actionType, name, params) {
            var id = this._ids.next();
            this.defs[id] = new DDPClient.Deferred();

            var args = params || [];

            var o = {
                msg: actionType,
                params: args,
                id: id
            };

            if (actionType === 'method') {
                o.method = name;
            } else if (actionType === 'sub') {
                o.name = name;
                this.subs[name] = id;
            }

            this.send(o);
            return this.defs[id].promise();
        }
    }, {
        key: 'call',
        value: function call(methodName) {
            for (var _len = arguments.length, params = Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
                params[_key - 1] = arguments[_key];
            }

            return this._deferredSend('method', methodName, params);
        }
    }, {
        key: 'subscribe',
        value: function subscribe(pubName) {
            for (var _len2 = arguments.length, params = Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
                params[_key2 - 1] = arguments[_key2];
            }

            return this._deferredSend('sub', pubName, params);
        }
    }, {
        key: 'unsubscribe',
        value: function unsubscribe(pubName) {
            var id = this.subs[pubName];
            if (!id) {
                return Promise.reject(pubName + " was never subscribed");
            }
            this.send({
                msg: 'unsub',
                id: id
            });
            return (this.defs[id] = new DDPClient.Deferred()).promise();
        }
    }, {
        key: 'watch',
        value: function watch(collectionName, cb) {
            if (!this.watchers[collectionName]) {
                this.watchers[collectionName] = [];
            }
            this.watchers[collectionName].push(cb);
        }
    }, {
        key: 'getCollection',
        value: function getCollection(collectionName) {
            if (!this._trackCollections) {
                return null;
            }
            return this.collections[collectionName];
        }
    }, {
        key: 'getDocument',
        value: function getDocument(collectionName, docId) {
            if (!this._trackCollections) {
                return null;
            }
            return this.collections[collectionName][docId];
        }
    }, {
        key: 'send',
        value: function send(msg) {
            this.sock.send(JSON.stringify(msg));
        }
    }, {
        key: 'close',
        value: function close() {
            console.log('closed')
            this.connected = false;
            this.sock.close();
        }

        // -- helpers --

    }]);

    return DDPClient;
}();

DDPClient.VERSIONS = ['1', 'pre2', 'pre1'];

DDPClient.Deferred = function () {
    function _class() {
        var _this3 = this;

        _classCallCheck(this, _class);

        this._p = new Promise(function (resolve, reject) {
            _this3._resolve = resolve;
            _this3._reject = reject;
        });
    }

    _createClass(_class, [{
        key: 'reject',
        value: function reject() {
            return this._reject.apply(this, arguments);
        }
    }, {
        key: 'resolve',
        value: function resolve() {
            return this._resolve.apply(this, arguments);
        }
    }, {
        key: 'promise',
        value: function promise() {
            return this._p;
        }
    }]);

    return _class;
}();

export default DDPClient

