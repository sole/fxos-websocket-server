(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.FxOSWebSocket = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

var _interopRequireWildcard = function (obj) { return obj && obj.__esModule ? obj : { 'default': obj }; };

var _classCallCheck = function (instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } };

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _EventDispatcher = require('event-dispatcher-js');

var _EventDispatcher2 = _interopRequireWildcard(_EventDispatcher);

var _WebSocketFrameBuffer = require('./frame-buffer.es6');

var _WebSocketFrameBuffer2 = _interopRequireWildcard(_WebSocketFrameBuffer);

var _WebSocketUtils = require('./utils.es6');

var _WebSocketUtils2 = _interopRequireWildcard(_WebSocketUtils);

/**
 * Sequence used to separate HTTP request headers and body.
 * @const {string}
 */
var CRLF = '\r\n';

/**
 * Magic GUID defined by RFC to concatenate with web socket key during
 * websocket handshake.
 * @const {string}
 */
var WEBSOCKET_KEY_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * Websocket handshake response template string, {web-socket-key} should be
 * replaced with the appropriate key.
 * @const {string}
 */
var WEBSOCKET_HANDSHAKE_RESPONSE = 'HTTP/1.1 101 Switching Protocols' + CRLF + 'Connection: Upgrade' + CRLF + 'Upgrade: websocket' + CRLF + 'Sec-WebSocket-Accept: {web-socket-key}' + CRLF + CRLF;

/**
 * Enumeration of all possible operation codes.
 * @enum {number}
 */
var OperationCode = {
  CONTINUATION_FRAME: 0,
  TEXT_FRAME: 1,
  BINARY_FRAME: 2,
  CONNECTION_CLOSE: 8,
  PING: 9,
  PONG: 10
};

/**
 * Extracts HTTP header map from HTTP header string.
 * @param {string} httpHeaderString HTTP header string.
 * @returns {Map.<string, string>} HTTP header key-value map.
 */
function getHttpHeaders(httpHeaderString) {
  var httpHeaders = httpHeaderString.trim().split(CRLF);
  return new Map(httpHeaders.map(function (httpHeader) {
    return httpHeader.split(':').map(function (entity) {
      return entity.trim();
    });
  }));
}

/**
 * Performs WebSocket HTTP Handshake.
 * @param {TCPSocket} tcpSocket Connection socket.
 * @param {Uint8Array} httpRequestData HTTP Handshake data array.
 * @returns {Map.<string, string>} Parsed http headers
 */
function performHandshake(tcpSocket, httpRequestData) {
  var httpHeaders = getHttpHeaders(_WebSocketUtils2['default'].arrayToString(httpRequestData).split(CRLF + CRLF)[0]);

  var key = _WebSocketUtils2['default'].stringToArray(httpHeaders.get('Sec-WebSocket-Key') + WEBSOCKET_KEY_GUID);

  var subtle = window.crypto.subtle;
  return subtle.digest({ name: 'SHA-1' }, key).then(function (hashArrayBuffer) {
    var webSocketKey = btoa(_WebSocketUtils2['default'].arrayToString(new Uint8Array(hashArrayBuffer)));
    var arrayResponse = _WebSocketUtils2['default'].stringToArray(WEBSOCKET_HANDSHAKE_RESPONSE.replace('{web-socket-key}', webSocketKey));

    tcpSocket.send(arrayResponse.buffer, 0, arrayResponse.byteLength);

    return httpHeaders;
  });
}

/**
 * Creates outgoing websocket message frame.
 * @param {Number} opCode Frame operation code.
 * @param {Uint8Array} data Data array.
 * @param {Boolean} isComplete Indicates if frame is completed.
 * @param {Boolean} isMasked Indicates if frame data should be masked.
 * @returns {Uint8Array} Constructed frame data.
 */
function createMessageFrame(opCode, data, isComplete, isMasked) {
  var dataLength = data && data.length || 0;
  var dataOffset = isMasked ? 6 : 2;

  var secondByte = 0;
  if (dataLength >= 65536) {
    dataOffset += 8;
    secondByte = 127;
  } else if (dataLength > 125) {
    dataOffset += 2;
    secondByte = 126;
  } else {
    secondByte = dataLength;
  }

  var outputBuffer = new Uint8Array(dataOffset + dataLength);

  // Writing OPCODE, FIN and LENGTH
  outputBuffer[0] = isComplete ? opCode | 128 : opCode;
  outputBuffer[1] = isMasked ? secondByte | 128 : secondByte;

  // Writing DATA LENGTH
  switch (secondByte) {
    case 126:
      _WebSocketUtils2['default'].writeUInt16(outputBuffer, dataLength, 2);
      break;
    case 127:
      _WebSocketUtils2['default'].writeUInt32(outputBuffer, 0, 2);
      _WebSocketUtils2['default'].writeUInt32(outputBuffer, dataLength, 6);
      break;
  }

  if (isMasked && dataLength) {
    var mask = _WebSocketUtils2['default'].generateRandomMask();

    // Writing MASK
    outputBuffer.set(mask, dataOffset - 4);

    _WebSocketUtils2['default'].mask(mask, data);
  }

  for (var i = 0; i < dataLength; i++) {
    outputBuffer[dataOffset + i] = data[i];
  }

  return outputBuffer;
}

var privates = {
  tcpServerSocket: Symbol('tcp-socket'),
  onTCPServerSocketConnect: Symbol('onTCPServerSocketConnect'),
  onTCPServerSocketClose: Symbol('onTCPServerSocketClose'),

  tcpSocket: Symbol('tcpSocket'),
  onTCPSocketData: Symbol('onTCPSocketData'),
  onTCPSocketClose: Symbol('onTCPSocketClose'),

  clients: Symbol('clients'),
  frameBuffer: Symbol('frameBuffer'),

  onMessageFrame: Symbol('onMessageFrame')
};

/**
 * WebSocketServer constructor that accepts port to listen on.
 * @param {Number} port Number to listen for websocket connections.
 */

var WebSocketServer = (function () {
  function WebSocketServer(port) {
    _classCallCheck(this, WebSocketServer);

    _EventDispatcher2['default'].mixin(this, ['message', 'stop']);

    var tcpServerSocket = navigator.mozTCPSocket.listen(port, {
      binaryType: 'arraybuffer'
    });

    this[privates.tcpServerSocket] = tcpServerSocket;
    this[privates.clients] = new Map();
    this[privates.frameBuffer] = new _WebSocketFrameBuffer2['default']();

    this[privates.onMessageFrame] = this[privates.onMessageFrame].bind(this);

    tcpServerSocket.onconnect = this[privates.onTCPServerSocketConnect].bind(this);
    tcpServerSocket.onerror = this[privates.onTCPServerSocketClose].bind(this);
  }

  _createClass(WebSocketServer, [{
    key: 'send',

    /**
     * Send data to the connected client
     * @param {ArrayBuffer|Array|string} data Data to send.
     */
    value: function send(data) {
      if (!ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer)) {
        if (typeof data === 'string') {
          data = new Uint8Array(_WebSocketUtils2['default'].stringToArray(data));
        } else if (Array.isArray(data)) {
          data = new Uint8Array(data);
        } else {
          throw new Error('Unsupported data type: ' + typeof data);
        }
      }

      var dataFrame = createMessageFrame(2, data, true, false);

      this[privates.tcpSocket].send(dataFrame.buffer, 0, dataFrame.length);
    }
  }, {
    key: 'stop',

    /**
     * Destroys socket connection.
     */
    value: function stop() {
      var tcpSocket = this[privates.tcpSocket];
      if (tcpSocket) {
        tcpSocket.close();
        this[privates.onTCPSocketClose]();
      }

      var tcpServerSocket = this[privates.tcpServerSocket];
      if (tcpServerSocket) {
        tcpServerSocket.close();
        this[privates.onTCPServerSocketClose]();
      }

      this[privates.clients].clear();
    }
  }, {
    key: privates.onTCPServerSocketConnect,
    value: function (tcpSocket) {
      this[privates.tcpSocket] = tcpSocket;

      this[privates.frameBuffer].on('frame', this[privates.onMessageFrame]);

      tcpSocket.ondata = this[privates.onTCPSocketData].bind(this);
      tcpSocket.onclose = tcpSocket.onerror = this[privates.onTCPSocketClose].bind(this);
    }
  }, {
    key: privates.onTCPSocketData,

    /**
     * MozTcpSocket data handler.
     * @param {TCPSocketEvent} socketEvent TCPSocket data event.
     */
    value: function (socketEvent) {
      var clients = this[privates.clients];
      var tcpSocket = this[privates.tcpSocket];

      var frameData = new Uint8Array(socketEvent.data);

      // If we don't have connection info from this host let's perform handshake
      // Currently we support only ONE client from host.
      if (!clients.has(tcpSocket.host)) {
        performHandshake(tcpSocket, frameData).then(function (handshakeResult) {
          if (handshakeResult) {
            clients.set(tcpSocket.host, handshakeResult);
          }
        });
        return;
      }

      this[privates.frameBuffer].put(frameData);
    }
  }, {
    key: privates.onMessageFrame,

    /**
     * Process WebSocket incoming frame.
     * @param {Uint8Array} frame Message frame data in view of Uint8Array.
     */
    value: function (frame) {
      var _this = this;

      var buffer = this[privates.frameBuffer];

      buffer.get(2).then(function (controlData) {
        var state = {
          isCompleted: (controlData[0] & 128) === 128,
          isMasked: (controlData[1] & 128) === 128,
          isCompressed: (controlData[0] & 64) === 64,
          opCode: controlData[0] & 15,
          dataLength: controlData[1] & 127,
          mask: null,
          data: []
        };

        if (state.opCode === OperationCode.CONTINUATION_FRAME) {
          throw new Error('Continuation frame is not yet supported!');
        }

        if (state.opCode === OperationCode.PING) {
          throw new Error('Ping frame is not yet supported!');
        }

        if (state.opCode === OperationCode.PONG) {
          throw new Error('Pong frame is not yet supported!');
        }

        return state;
      }).then(function (state) {
        var dataLengthPromise;
        if (state.dataLength === 126) {
          dataLengthPromise = buffer.get(2).then(function (data) {
            return _WebSocketUtils2['default'].readUInt16(data);
          });
        } else if (state.dataLength == 127) {
          dataLengthPromise = buffer.get(4).then(function (data) {
            return _WebSocketUtils2['default'].readUInt32(data);
          });
        } else {
          dataLengthPromise = Promise.resolve(state.dataLength);
        }

        return dataLengthPromise.then(function (dataLength) {
          state.dataLength = dataLength;
          return state;
        });
      }).then(function (state) {
        if (state.isMasked) {
          return buffer.get(4).then(function (mask) {
            state.mask = mask;
            return state;
          });
        }
        return state;
      }).then(function (state) {
        return state.dataLength ? buffer.get(state.dataLength).then(function (data) {
          state.data = _WebSocketUtils2['default'].mask(state.mask, data);
          return state;
        }) : state;
      }).then(function (state) {
        if (state.opCode === OperationCode.CONNECTION_CLOSE) {
          var code = 0;
          var reason = 'Unknown';

          if (state.dataLength > 0) {
            code = _WebSocketUtils2['default'].readUInt16(state.data);
            if (state.dataLength > 2) {
              reason = _WebSocketUtils2['default'].arrayToString(state.data.subarray(2));
            }
          }

          console.log('Socket is closed: ' + code + ' ' + reason);

          var dataFrame = createMessageFrame(8, state.data, true);
          _this[privates.tcpSocket].send(dataFrame.buffer, 0, dataFrame.length);
          _this[privates.onTCPSocketClose]();
        } else if (state.opCode === OperationCode.TEXT_FRAME || state.opCode === OperationCode.BINARY_FRAME) {
          _this.emit('message', state.data);
        }

        if (!buffer.isEmpty()) {
          _this[privates.onMessageFrame]();
        }
      });
    }
  }, {
    key: privates.onTCPSocketClose,
    value: function () {
      var tcpSocket = this[privates.tcpSocket];

      if (!tcpSocket) {
        return;
      }

      this[privates.clients]['delete'](tcpSocket.host);

      tcpSocket.ondata = tcpSocket.onerror = tcpSocket.onclose = null;

      this[privates.tcpSocket] = null;
    }
  }, {
    key: privates.onTCPServerSocketClose,
    value: function () {
      var tcpServerSocket = this[privates.tcpServerSocket];

      if (!tcpServerSocket) {
        return;
      }

      tcpServerSocket.onconnect = tcpServerSocket.onerror = null;

      this[privates.tcpServerSocket] = null;

      this.emit('stop');
    }
  }]);

  return WebSocketServer;
})();

exports['default'] = {
  Server: WebSocketServer,
  Utils: _WebSocketUtils2['default'],
  FrameBuffer: _WebSocketFrameBuffer2['default']
};
module.exports = exports['default'];

},{"./frame-buffer.es6":3,"./utils.es6":4,"event-dispatcher-js":2}],2:[function(require,module,exports){

},{}],3:[function(require,module,exports){
'use strict';

var _interopRequireWildcard = function (obj) { return obj && obj.__esModule ? obj : { 'default': obj }; };

var _classCallCheck = function (instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } };

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _EventDispatcher = require('event-dispatcher-js');

var _EventDispatcher2 = _interopRequireWildcard(_EventDispatcher);

var privates = {
  data: Symbol('data'),
  pendingDataRequest: Symbol('pendingDataRequest'),
  splice: Symbol('splice')
};

var WebSocketFrameBuffer = (function () {
  function WebSocketFrameBuffer() {
    _classCallCheck(this, WebSocketFrameBuffer);

    _EventDispatcher2['default'].mixin(this, ['frame', 'data']);

    this[privates.data] = new Uint8Array(0);
    this[privates.pendingDataRequest] = null;
    this[privates.splice] = function (length) {
      var data = this[privates.data];

      var splicedData = data.subarray(0, length);
      this[privates.data] = data.subarray(length, data.length);

      return splicedData;
    };
  }

  _createClass(WebSocketFrameBuffer, [{
    key: 'put',
    value: function put(dataToPut) {
      var data = this[privates.data];

      var newData = new Uint8Array(data.length + dataToPut.length);
      newData.set(data);
      newData.set(dataToPut, data.length);
      this[privates.data] = newData;

      this.emit('data');

      // If no one waiting for data, let's signal that we have new frame!
      if (!this[privates.pendingDataRequest]) {
        this.emit('frame');
      }
    }
  }, {
    key: 'get',
    value: function get(dataLength) {
      var _this = this;

      if (this[privates.pendingDataRequest]) {
        throw new Error('Concurrent read is not allowed.');
      }

      this[privates.pendingDataRequest] = new Promise(function (resolve) {
        var data = _this[privates.data];
        if (data.length >= dataLength) {
          return resolve(_this[privates.splice](dataLength));
        }

        var self = _this;
        _this.on('data', function onData() {
          if (data.length < dataLength) {
            return;
          }

          self.off('data', onData);
          resolve(this[privates.splice](dataLength));
        });
      });

      return this[privates.pendingDataRequest].then(function (data) {
        _this[privates.pendingDataRequest] = null;
        return data;
      });
    }
  }, {
    key: 'isEmpty',
    value: function isEmpty() {
      return this[privates.data].length === 0;
    }
  }]);

  return WebSocketFrameBuffer;
})();

exports['default'] = WebSocketFrameBuffer;
module.exports = exports['default'];

},{"event-dispatcher-js":2}],4:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});
var WebSocketUtils = {
  /**
   * Mask every data element with the mask (WebSocket specific algorithm).
   * @param {Array} mask Mask array.
   * @param {Array} array Data array to mask.
   * @returns {Array} Masked data array.
   */
  mask: (function (_mask) {
    function mask(_x, _x2) {
      return _mask.apply(this, arguments);
    }

    mask.toString = function () {
      return _mask.toString();
    };

    return mask;
  })(function (mask, array) {
    if (mask) {
      for (var i = 0; i < array.length; i++) {
        array[i] = array[i] ^ mask[i % 4];
      }
    }
    return array;
  }),

  /**
   * Generates 4-item array, every item of which is element of byte mask.
   * @returns {Uint8Array}
   */
  generateRandomMask: function generateRandomMask() {
    var random = new Uint8Array(4);

    window.crypto.getRandomValues(random);

    return random;
  },

  /**
   * Converts string to Uint8Array.
   * @param {string} stringValue String value to convert.
   * @returns {Uint8Array}
   */
  stringToArray: function stringToArray(stringValue) {
    if (typeof stringValue !== 'string') {
      throw new Error('stringValue should be valid string!');
    }

    var array = new Uint8Array(stringValue.length);
    for (var i = 0; i < stringValue.length; i++) {
      array[i] = stringValue.charCodeAt(i);
    }

    return array;
  },

  /**
   * Converts array to string. Every array element is considered as char code.
   * @param {Uint8Array} array Array with the char codes.
   * @returns {string}
   */
  arrayToString: function arrayToString(array) {
    return String.fromCharCode.apply(null, array);
  },

  /**
   * Reads unsigned 16 bit value from two consequent 8-bit array elements.
   * @param {Uint8Array} array Array to read from.
   * @param {Number} offset Index to start read value.
   * @returns {Number}
   */
  readUInt16: function readUInt16(array, offset) {
    offset = offset || 0;
    return (array[offset] << 8) + array[offset + 1];
  },

  /**
   * Reads unsigned 32 bit value from four consequent 8-bit array elements.
   * @param {Uint8Array} array Array to read from.
   * @param {Number} offset Index to start read value.
   * @returns {Number}
   */
  readUInt32: function readUInt32(array, offset) {
    offset = offset || 0;
    return (array[offset] << 24) + (array[offset + 1] << 16) + (array[offset + 2] << 8) + array[offset + 3];
  },

  /**
   * Writes unsigned 16 bit value to two consequent 8-bit array elements.
   * @param {Uint8Array} array Array to write to.
   * @param {Number} value 16 bit unsigned value to write into array.
   * @param {Number} offset Index to start write value.
   * @returns {Number}
   */
  writeUInt16: function writeUInt16(array, value, offset) {
    array[offset] = (value & 65280) >> 8;
    array[offset + 1] = value & 255;
  },

  /**
   * Writes unsigned 16 bit value to two consequent 8-bit array elements.
   * @param {Uint8Array} array Array to write to.
   * @param {Number} value 16 bit unsigned value to write into array.
   * @param {Number} offset Index to start write value.
   * @returns {Number}
   */
  writeUInt32: function writeUInt32(array, value, offset) {
    array[offset] = (value & 4278190080) >> 24;
    array[offset + 1] = (value & 16711680) >> 16;
    array[offset + 2] = (value & 65280) >> 8;
    array[offset + 3] = value & 255;
  }
};

exports['default'] = WebSocketUtils;
module.exports = exports['default'];

},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIvcHJvamVjdHMvZ2l0aHViL2Z4b3Mtd2Vic29ja2V0LXNlcnZlci9zcmMvc2VydmVyLmVzNi5qcyIsIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L2xpYi9fZW1wdHkuanMiLCIvcHJvamVjdHMvZ2l0aHViL2Z4b3Mtd2Vic29ja2V0LXNlcnZlci9zcmMvZnJhbWUtYnVmZmVyLmVzNi5qcyIsIi9wcm9qZWN0cy9naXRodWIvZnhvcy13ZWJzb2NrZXQtc2VydmVyL3NyYy91dGlscy5lczYuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7Ozs7Ozs7K0JDQTRCLHFCQUFxQjs7OztvQ0FDaEIsb0JBQW9COzs7OzhCQUMxQixhQUFhOzs7Ozs7OztBQU14QyxJQUFNLElBQUksR0FBRyxNQUFNLENBQUM7Ozs7Ozs7QUFPcEIsSUFBTSxrQkFBa0IsR0FBRyxzQ0FBc0MsQ0FBQzs7Ozs7OztBQU9sRSxJQUFNLDRCQUE0QixHQUNoQyxrQ0FBa0MsR0FBRyxJQUFJLEdBQ3pDLHFCQUFxQixHQUFHLElBQUksR0FDNUIsb0JBQW9CLEdBQUcsSUFBSSxHQUMzQix3Q0FBd0MsR0FBRyxJQUFJLEdBQUcsSUFBSSxDQUFDOzs7Ozs7QUFNekQsSUFBTSxhQUFhLEdBQUc7QUFDcEIsb0JBQWtCLEVBQUUsQ0FBQztBQUNyQixZQUFVLEVBQUUsQ0FBQztBQUNiLGNBQVksRUFBRSxDQUFDO0FBQ2Ysa0JBQWdCLEVBQUUsQ0FBQztBQUNuQixNQUFJLEVBQUUsQ0FBQztBQUNQLE1BQUksRUFBRSxFQUFFO0NBQ1QsQ0FBQzs7Ozs7OztBQU9GLFNBQVMsY0FBYyxDQUFDLGdCQUFnQixFQUFFO0FBQ3hDLE1BQUksV0FBVyxHQUFHLGdCQUFnQixDQUFDLElBQUksRUFBRSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztBQUN0RCxTQUFPLElBQUksR0FB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Q0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLEtBQUssR0FBRyxVQUFVLENBQUEsSUFBSyxFQUFFLENBQUM7QUFDM0MsU0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEtBQUssR0FBRyxRQUFRLENBQUEsSUFBSyxFQUFFLENBQUM7QUFDN0MsU0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLEtBQUssR0FBRyxLQUFNLENBQUEsSUFBSyxDQUFDLENBQUM7QUFDMUMsU0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsR0FBRyxLQUFLLEdBQUcsR0FBSSxDQUFDO0dBQ2xDO0NBQ0YsQ0FBQzs7cUJBRWEsY0FBYyIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJpbXBvcnQgRXZlbnREaXNwYXRjaGVyIGZyb20gJ2V2ZW50LWRpc3BhdGNoZXItanMnO1xuaW1wb3J0IFdlYlNvY2tldEZyYW1lQnVmZmVyIGZyb20gJy4vZnJhbWUtYnVmZmVyLmVzNic7XG5pbXBvcnQgV2ViU29ja2V0VXRpbHMgZnJvbSAnLi91dGlscy5lczYnO1xuXG4vKipcbiAqIFNlcXVlbmNlIHVzZWQgdG8gc2VwYXJhdGUgSFRUUCByZXF1ZXN0IGhlYWRlcnMgYW5kIGJvZHkuXG4gKiBAY29uc3Qge3N0cmluZ31cbiAqL1xuY29uc3QgQ1JMRiA9ICdcXHJcXG4nO1xuXG4vKipcbiAqIE1hZ2ljIEdVSUQgZGVmaW5lZCBieSBSRkMgdG8gY29uY2F0ZW5hdGUgd2l0aCB3ZWIgc29ja2V0IGtleSBkdXJpbmdcbiAqIHdlYnNvY2tldCBoYW5kc2hha2UuXG4gKiBAY29uc3Qge3N0cmluZ31cbiAqL1xuY29uc3QgV0VCU09DS0VUX0tFWV9HVUlEID0gJzI1OEVBRkE1LUU5MTQtNDdEQS05NUNBLUM1QUIwREM4NUIxMSc7XG5cbi8qKlxuICogV2Vic29ja2V0IGhhbmRzaGFrZSByZXNwb25zZSB0ZW1wbGF0ZSBzdHJpbmcsIHt3ZWItc29ja2V0LWtleX0gc2hvdWxkIGJlXG4gKiByZXBsYWNlZCB3aXRoIHRoZSBhcHByb3ByaWF0ZSBrZXkuXG4gKiBAY29uc3Qge3N0cmluZ31cbiAqL1xuY29uc3QgV0VCU09DS0VUX0hBTkRTSEFLRV9SRVNQT05TRSA9XG4gICdIVFRQLzEuMSAxMDEgU3dpdGNoaW5nIFByb3RvY29scycgKyBDUkxGICtcbiAgJ0Nvbm5lY3Rpb246IFVwZ3JhZGUnICsgQ1JMRiArXG4gICdVcGdyYWRlOiB3ZWJzb2NrZXQnICsgQ1JMRiArXG4gICdTZWMtV2ViU29ja2V0LUFjY2VwdDoge3dlYi1zb2NrZXQta2V5fScgKyBDUkxGICsgQ1JMRjtcblxuLyoqXG4gKiBFbnVtZXJhdGlvbiBvZiBhbGwgcG9zc2libGUgb3BlcmF0aW9uIGNvZGVzLlxuICogQGVudW0ge251bWJlcn1cbiAqL1xuY29uc3QgT3BlcmF0aW9uQ29kZSA9IHtcbiAgQ09OVElOVUFUSU9OX0ZSQU1FOiAwLFxuICBURVhUX0ZSQU1FOiAxLFxuICBCSU5BUllfRlJBTUU6IDIsXG4gIENPTk5FQ1RJT05fQ0xPU0U6IDgsXG4gIFBJTkc6IDksXG4gIFBPTkc6IDEwXG59O1xuXG4vKipcbiAqIEV4dHJhY3RzIEhUVFAgaGVhZGVyIG1hcCBmcm9tIEhUVFAgaGVhZGVyIHN0cmluZy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBodHRwSGVhZGVyU3RyaW5nIEhUVFAgaGVhZGVyIHN0cmluZy5cbiAqIEByZXR1cm5zIHtNYXAuPHN0cmluZywgc3RyaW5nPn0gSFRUUCBoZWFkZXIga2V5LXZhbHVlIG1hcC5cbiAqL1xuZnVuY3Rpb24gZ2V0SHR0cEhlYWRlcnMoaHR0cEhlYWRlclN0cmluZykge1xuICB2YXIgaHR0cEhlYWRlcnMgPSBodHRwSGVhZGVyU3RyaW5nLnRyaW0oKS5zcGxpdChDUkxGKTtcbiAgcmV0dXJuIG5ldyBNYXAoaHR0cEhlYWRlcnMubWFwKChodHRwSGVhZGVyKSA9PiB7XG4gICAgcmV0dXJuIGh0dHBIZWFkZXIuc3BsaXQoJzonKS5tYXAoKGVudGl0eSkgPT4gZW50aXR5LnRyaW0oKSk7XG4gIH0pKTtcbn1cblxuLyoqXG4gKiBQZXJmb3JtcyBXZWJTb2NrZXQgSFRUUCBIYW5kc2hha2UuXG4gKiBAcGFyYW0ge1RDUFNvY2tldH0gdGNwU29ja2V0IENvbm5lY3Rpb24gc29ja2V0LlxuICogQHBhcmFtIHtVaW50OEFycmF5fSBodHRwUmVxdWVzdERhdGEgSFRUUCBIYW5kc2hha2UgZGF0YSBhcnJheS5cbiAqIEByZXR1cm5zIHtNYXAuPHN0cmluZywgc3RyaW5nPn0gUGFyc2VkIGh0dHAgaGVhZGVyc1xuICovXG5mdW5jdGlvbiBwZXJmb3JtSGFuZHNoYWtlKHRjcFNvY2tldCwgaHR0cFJlcXVlc3REYXRhKSB7XG4gIHZhciBodHRwSGVhZGVycyA9IGdldEh0dHBIZWFkZXJzKFxuICAgIFdlYlNvY2tldFV0aWxzLmFycmF5VG9TdHJpbmcoaHR0cFJlcXVlc3REYXRhKS5zcGxpdChDUkxGICsgQ1JMRilbMF1cbiAgKTtcblxuICB2YXIga2V5ID0gV2ViU29ja2V0VXRpbHMuc3RyaW5nVG9BcnJheShcbiAgICBodHRwSGVhZGVycy5nZXQoJ1NlYy1XZWJTb2NrZXQtS2V5JykgKyBXRUJTT0NLRVRfS0VZX0dVSURcbiAgKTtcblxuICB2YXIgc3VidGxlID0gd2luZG93LmNyeXB0by5zdWJ0bGU7XG4gIHJldHVybiBzdWJ0bGUuZGlnZXN0KHsgbmFtZTogJ1NIQS0xJyB9LCBrZXkpLnRoZW4oKGhhc2hBcnJheUJ1ZmZlcikgPT4ge1xuICAgIHZhciB3ZWJTb2NrZXRLZXkgPSBidG9hKFdlYlNvY2tldFV0aWxzLmFycmF5VG9TdHJpbmcoXG4gICAgICBuZXcgVWludDhBcnJheShoYXNoQXJyYXlCdWZmZXIpXG4gICAgKSk7XG4gICAgdmFyIGFycmF5UmVzcG9uc2UgPSBXZWJTb2NrZXRVdGlscy5zdHJpbmdUb0FycmF5KFxuICAgICAgV0VCU09DS0VUX0hBTkRTSEFLRV9SRVNQT05TRS5yZXBsYWNlKCd7d2ViLXNvY2tldC1rZXl9Jywgd2ViU29ja2V0S2V5KVxuICAgICk7XG5cbiAgICB0Y3BTb2NrZXQuc2VuZChhcnJheVJlc3BvbnNlLmJ1ZmZlciwgMCwgYXJyYXlSZXNwb25zZS5ieXRlTGVuZ3RoKTtcblxuICAgIHJldHVybiBodHRwSGVhZGVycztcbiAgfSk7XG59XG5cbi8qKlxuICogQ3JlYXRlcyBvdXRnb2luZyB3ZWJzb2NrZXQgbWVzc2FnZSBmcmFtZS5cbiAqIEBwYXJhbSB7TnVtYmVyfSBvcENvZGUgRnJhbWUgb3BlcmF0aW9uIGNvZGUuXG4gKiBAcGFyYW0ge1VpbnQ4QXJyYXl9IGRhdGEgRGF0YSBhcnJheS5cbiAqIEBwYXJhbSB7Qm9vbGVhbn0gaXNDb21wbGV0ZSBJbmRpY2F0ZXMgaWYgZnJhbWUgaXMgY29tcGxldGVkLlxuICogQHBhcmFtIHtCb29sZWFufSBpc01hc2tlZCBJbmRpY2F0ZXMgaWYgZnJhbWUgZGF0YSBzaG91bGQgYmUgbWFza2VkLlxuICogQHJldHVybnMge1VpbnQ4QXJyYXl9IENvbnN0cnVjdGVkIGZyYW1lIGRhdGEuXG4gKi9cbmZ1bmN0aW9uIGNyZWF0ZU1lc3NhZ2VGcmFtZShvcENvZGUsIGRhdGEsIGlzQ29tcGxldGUsIGlzTWFza2VkKSB7XG4gIHZhciBkYXRhTGVuZ3RoID0gKGRhdGEgJiYgZGF0YS5sZW5ndGgpIHx8IDA7XG4gIHZhciBkYXRhT2Zmc2V0ID0gaXNNYXNrZWQgPyA2IDogMjtcblxuICB2YXIgc2Vjb25kQnl0ZSA9IDA7XG4gIGlmIChkYXRhTGVuZ3RoID49IDY1NTM2KSB7XG4gICAgZGF0YU9mZnNldCArPSA4O1xuICAgIHNlY29uZEJ5dGUgPSAxMjc7XG4gIH0gZWxzZSBpZiAoZGF0YUxlbmd0aCA+IDEyNSkge1xuICAgIGRhdGFPZmZzZXQgKz0gMjtcbiAgICBzZWNvbmRCeXRlID0gMTI2O1xuICB9IGVsc2Uge1xuICAgIHNlY29uZEJ5dGUgPSBkYXRhTGVuZ3RoO1xuICB9XG5cbiAgdmFyIG91dHB1dEJ1ZmZlciA9IG5ldyBVaW50OEFycmF5KGRhdGFPZmZzZXQgKyBkYXRhTGVuZ3RoKTtcblxuICAvLyBXcml0aW5nIE9QQ09ERSwgRklOIGFuZCBMRU5HVEhcbiAgb3V0cHV0QnVmZmVyWzBdID0gaXNDb21wbGV0ZSA/IG9wQ29kZSB8IDB4ODAgOiBvcENvZGU7XG4gIG91dHB1dEJ1ZmZlclsxXSA9IGlzTWFza2VkID8gc2Vjb25kQnl0ZSB8IDB4ODAgOiBzZWNvbmRCeXRlO1xuXG4gIC8vIFdyaXRpbmcgREFUQSBMRU5HVEhcbiAgc3dpdGNoIChzZWNvbmRCeXRlKSB7XG4gICAgY2FzZSAxMjY6XG4gICAgICBXZWJTb2NrZXRVdGlscy53cml0ZVVJbnQxNihvdXRwdXRCdWZmZXIsIGRhdGFMZW5ndGgsIDIpO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAxMjc6XG4gICAgICBXZWJTb2NrZXRVdGlscy53cml0ZVVJbnQzMihvdXRwdXRCdWZmZXIsIDAsIDIpO1xuICAgICAgV2ViU29ja2V0VXRpbHMud3JpdGVVSW50MzIob3V0cHV0QnVmZmVyLCBkYXRhTGVuZ3RoLCA2KTtcbiAgICAgIGJyZWFrO1xuICB9XG5cbiAgaWYgKGlzTWFza2VkICYmIGRhdGFMZW5ndGgpIHtcbiAgICB2YXIgbWFzayA9IFdlYlNvY2tldFV0aWxzLmdlbmVyYXRlUmFuZG9tTWFzaygpO1xuXG4gICAgLy8gV3JpdGluZyBNQVNLXG4gICAgb3V0cHV0QnVmZmVyLnNldChtYXNrLCBkYXRhT2Zmc2V0IC0gNCk7XG5cbiAgICBXZWJTb2NrZXRVdGlscy5tYXNrKG1hc2ssIGRhdGEpO1xuICB9XG5cbiAgZm9yKHZhciBpID0gMDsgaSA8IGRhdGFMZW5ndGg7IGkrKykge1xuICAgIG91dHB1dEJ1ZmZlcltkYXRhT2Zmc2V0ICsgaV0gPSBkYXRhW2ldO1xuICB9XG5cbiAgcmV0dXJuIG91dHB1dEJ1ZmZlcjtcbn1cblxudmFyIHByaXZhdGVzID0ge1xuICB0Y3BTZXJ2ZXJTb2NrZXQ6IFN5bWJvbCgndGNwLXNvY2tldCcpLFxuICBvblRDUFNlcnZlclNvY2tldENvbm5lY3Q6IFN5bWJvbCgnb25UQ1BTZXJ2ZXJTb2NrZXRDb25uZWN0JyksXG4gIG9uVENQU2VydmVyU29ja2V0Q2xvc2U6IFN5bWJvbCgnb25UQ1BTZXJ2ZXJTb2NrZXRDbG9zZScpLFxuXG4gIHRjcFNvY2tldDogU3ltYm9sKCd0Y3BTb2NrZXQnKSxcbiAgb25UQ1BTb2NrZXREYXRhOiBTeW1ib2woJ29uVENQU29ja2V0RGF0YScpLFxuICBvblRDUFNvY2tldENsb3NlOiBTeW1ib2woJ29uVENQU29ja2V0Q2xvc2UnKSxcblxuICBjbGllbnRzOiBTeW1ib2woJ2NsaWVudHMnKSxcbiAgZnJhbWVCdWZmZXI6IFN5bWJvbCgnZnJhbWVCdWZmZXInKSxcblxuICBvbk1lc3NhZ2VGcmFtZTogU3ltYm9sKCdvbk1lc3NhZ2VGcmFtZScpXG59O1xuXG4vKipcbiAqIFdlYlNvY2tldFNlcnZlciBjb25zdHJ1Y3RvciB0aGF0IGFjY2VwdHMgcG9ydCB0byBsaXN0ZW4gb24uXG4gKiBAcGFyYW0ge051bWJlcn0gcG9ydCBOdW1iZXIgdG8gbGlzdGVuIGZvciB3ZWJzb2NrZXQgY29ubmVjdGlvbnMuXG4gKi9cbmNsYXNzIFdlYlNvY2tldFNlcnZlciB7XG4gIGNvbnN0cnVjdG9yKHBvcnQpIHtcbiAgICBFdmVudERpc3BhdGNoZXIubWl4aW4odGhpcywgWydtZXNzYWdlJywgJ3N0b3AnXSk7XG5cbiAgICB2YXIgdGNwU2VydmVyU29ja2V0ID0gbmF2aWdhdG9yLm1velRDUFNvY2tldC5saXN0ZW4ocG9ydCwge1xuICAgICAgYmluYXJ5VHlwZTogJ2FycmF5YnVmZmVyJ1xuICAgIH0pO1xuXG4gICAgdGhpc1twcml2YXRlcy50Y3BTZXJ2ZXJTb2NrZXRdID0gdGNwU2VydmVyU29ja2V0O1xuICAgIHRoaXNbcHJpdmF0ZXMuY2xpZW50c10gPSBuZXcgTWFwKCk7XG4gICAgdGhpc1twcml2YXRlcy5mcmFtZUJ1ZmZlcl0gPSBuZXcgV2ViU29ja2V0RnJhbWVCdWZmZXIoKTtcblxuICAgIHRoaXNbcHJpdmF0ZXMub25NZXNzYWdlRnJhbWVdID0gdGhpc1twcml2YXRlcy5vbk1lc3NhZ2VGcmFtZV0uYmluZCh0aGlzKTtcblxuICAgIHRjcFNlcnZlclNvY2tldC5vbmNvbm5lY3QgPVxuICAgICAgdGhpc1twcml2YXRlcy5vblRDUFNlcnZlclNvY2tldENvbm5lY3RdLmJpbmQodGhpcyk7XG4gICAgdGNwU2VydmVyU29ja2V0Lm9uZXJyb3IgPSB0aGlzW3ByaXZhdGVzLm9uVENQU2VydmVyU29ja2V0Q2xvc2VdLmJpbmQodGhpcyk7XG4gIH1cblxuICAvKipcbiAgICogU2VuZCBkYXRhIHRvIHRoZSBjb25uZWN0ZWQgY2xpZW50XG4gICAqIEBwYXJhbSB7QXJyYXlCdWZmZXJ8QXJyYXl8c3RyaW5nfSBkYXRhIERhdGEgdG8gc2VuZC5cbiAgICovXG4gIHNlbmQoZGF0YSkge1xuICAgIGlmICghQXJyYXlCdWZmZXIuaXNWaWV3KGRhdGEpICYmICEoZGF0YSBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSkge1xuICAgICAgaWYgKHR5cGVvZiBkYXRhID09PSAnc3RyaW5nJykge1xuICAgICAgICBkYXRhID0gbmV3IFVpbnQ4QXJyYXkoV2ViU29ja2V0VXRpbHMuc3RyaW5nVG9BcnJheShkYXRhKSk7XG4gICAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoZGF0YSkpIHtcbiAgICAgICAgZGF0YSA9IG5ldyBVaW50OEFycmF5KGRhdGEpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbnN1cHBvcnRlZCBkYXRhIHR5cGU6ICcgKyB0eXBlb2YgZGF0YSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdmFyIGRhdGFGcmFtZSA9IGNyZWF0ZU1lc3NhZ2VGcmFtZSgweDIsIGRhdGEsIHRydWUsIGZhbHNlKTtcblxuICAgIHRoaXNbcHJpdmF0ZXMudGNwU29ja2V0XS5zZW5kKGRhdGFGcmFtZS5idWZmZXIsIDAsIGRhdGFGcmFtZS5sZW5ndGgpO1xuICB9XG5cbiAgLyoqXG4gICAqIERlc3Ryb3lzIHNvY2tldCBjb25uZWN0aW9uLlxuICAgKi9cbiAgc3RvcCgpIHtcbiAgICB2YXIgdGNwU29ja2V0ID0gdGhpc1twcml2YXRlcy50Y3BTb2NrZXRdO1xuICAgIGlmICh0Y3BTb2NrZXQpIHtcbiAgICAgIHRjcFNvY2tldC5jbG9zZSgpO1xuICAgICAgdGhpc1twcml2YXRlcy5vblRDUFNvY2tldENsb3NlXSgpO1xuICAgIH1cblxuICAgIHZhciB0Y3BTZXJ2ZXJTb2NrZXQgPSB0aGlzW3ByaXZhdGVzLnRjcFNlcnZlclNvY2tldF07XG4gICAgaWYgKHRjcFNlcnZlclNvY2tldCkge1xuICAgICAgdGNwU2VydmVyU29ja2V0LmNsb3NlKCk7XG4gICAgICB0aGlzW3ByaXZhdGVzLm9uVENQU2VydmVyU29ja2V0Q2xvc2VdKCk7XG4gICAgfVxuXG4gICAgdGhpc1twcml2YXRlcy5jbGllbnRzXS5jbGVhcigpO1xuICB9XG5cbiAgW3ByaXZhdGVzLm9uVENQU2VydmVyU29ja2V0Q29ubmVjdF0odGNwU29ja2V0KSB7XG4gICAgdGhpc1twcml2YXRlcy50Y3BTb2NrZXRdID0gdGNwU29ja2V0O1xuXG4gICAgdGhpc1twcml2YXRlcy5mcmFtZUJ1ZmZlcl0ub24oJ2ZyYW1lJywgdGhpc1twcml2YXRlcy5vbk1lc3NhZ2VGcmFtZV0pO1xuXG4gICAgdGNwU29ja2V0Lm9uZGF0YSA9IHRoaXNbcHJpdmF0ZXMub25UQ1BTb2NrZXREYXRhXS5iaW5kKHRoaXMpO1xuICAgIHRjcFNvY2tldC5vbmNsb3NlID0gdGNwU29ja2V0Lm9uZXJyb3IgPVxuICAgICAgdGhpc1twcml2YXRlcy5vblRDUFNvY2tldENsb3NlXS5iaW5kKHRoaXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIE1velRjcFNvY2tldCBkYXRhIGhhbmRsZXIuXG4gICAqIEBwYXJhbSB7VENQU29ja2V0RXZlbnR9IHNvY2tldEV2ZW50IFRDUFNvY2tldCBkYXRhIGV2ZW50LlxuICAgKi9cbiAgW3ByaXZhdGVzLm9uVENQU29ja2V0RGF0YV0oc29ja2V0RXZlbnQpIHtcbiAgICB2YXIgY2xpZW50cyA9IHRoaXNbcHJpdmF0ZXMuY2xpZW50c107XG4gICAgdmFyIHRjcFNvY2tldCA9IHRoaXNbcHJpdmF0ZXMudGNwU29ja2V0XTtcblxuICAgIHZhciBmcmFtZURhdGEgPSBuZXcgVWludDhBcnJheShzb2NrZXRFdmVudC5kYXRhKTtcblxuICAgIC8vIElmIHdlIGRvbid0IGhhdmUgY29ubmVjdGlvbiBpbmZvIGZyb20gdGhpcyBob3N0IGxldCdzIHBlcmZvcm0gaGFuZHNoYWtlXG4gICAgLy8gQ3VycmVudGx5IHdlIHN1cHBvcnQgb25seSBPTkUgY2xpZW50IGZyb20gaG9zdC5cbiAgICBpZiAoIWNsaWVudHMuaGFzKHRjcFNvY2tldC5ob3N0KSkge1xuICAgICAgcGVyZm9ybUhhbmRzaGFrZSh0Y3BTb2NrZXQsIGZyYW1lRGF0YSkudGhlbigoaGFuZHNoYWtlUmVzdWx0KSA9PiB7XG4gICAgICAgIGlmIChoYW5kc2hha2VSZXN1bHQpIHtcbiAgICAgICAgICBjbGllbnRzLnNldCh0Y3BTb2NrZXQuaG9zdCwgaGFuZHNoYWtlUmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpc1twcml2YXRlcy5mcmFtZUJ1ZmZlcl0ucHV0KGZyYW1lRGF0YSk7XG4gIH1cblxuICAvKipcbiAgICogUHJvY2VzcyBXZWJTb2NrZXQgaW5jb21pbmcgZnJhbWUuXG4gICAqIEBwYXJhbSB7VWludDhBcnJheX0gZnJhbWUgTWVzc2FnZSBmcmFtZSBkYXRhIGluIHZpZXcgb2YgVWludDhBcnJheS5cbiAgICovXG4gIFtwcml2YXRlcy5vbk1lc3NhZ2VGcmFtZV0oZnJhbWUpIHtcbiAgICB2YXIgYnVmZmVyID0gdGhpc1twcml2YXRlcy5mcmFtZUJ1ZmZlcl07XG5cbiAgICBidWZmZXIuZ2V0KDIpLnRoZW4oKGNvbnRyb2xEYXRhKSA9PiB7XG4gICAgICB2YXIgc3RhdGUgPSB7XG4gICAgICAgIGlzQ29tcGxldGVkOiAoY29udHJvbERhdGFbMF0gJiAweDgwKSA9PT0gMHg4MCxcbiAgICAgICAgaXNNYXNrZWQ6IChjb250cm9sRGF0YVsxXSAmIDB4ODApID09PSAweDgwLFxuICAgICAgICBpc0NvbXByZXNzZWQ6IChjb250cm9sRGF0YVswXSAmIDB4NDApID09PSAweDQwLFxuICAgICAgICBvcENvZGU6IGNvbnRyb2xEYXRhWzBdICYgMHhmLFxuICAgICAgICBkYXRhTGVuZ3RoOiBjb250cm9sRGF0YVsxXSAmIDB4N2YsXG4gICAgICAgIG1hc2s6IG51bGwsXG4gICAgICAgIGRhdGE6IFtdXG4gICAgICB9O1xuXG4gICAgICBpZiAoc3RhdGUub3BDb2RlID09PSBPcGVyYXRpb25Db2RlLkNPTlRJTlVBVElPTl9GUkFNRSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbnRpbnVhdGlvbiBmcmFtZSBpcyBub3QgeWV0IHN1cHBvcnRlZCEnKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHN0YXRlLm9wQ29kZSA9PT0gT3BlcmF0aW9uQ29kZS5QSU5HKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignUGluZyBmcmFtZSBpcyBub3QgeWV0IHN1cHBvcnRlZCEnKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHN0YXRlLm9wQ29kZSA9PT0gT3BlcmF0aW9uQ29kZS5QT05HKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignUG9uZyBmcmFtZSBpcyBub3QgeWV0IHN1cHBvcnRlZCEnKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHN0YXRlO1xuICAgIH0pLnRoZW4oKHN0YXRlKSA9PiB7XG4gICAgICB2YXIgZGF0YUxlbmd0aFByb21pc2U7XG4gICAgICBpZiAoc3RhdGUuZGF0YUxlbmd0aCA9PT0gMTI2KSB7XG4gICAgICAgIGRhdGFMZW5ndGhQcm9taXNlID0gYnVmZmVyLmdldCgyKS50aGVuKFxuICAgICAgICAgIChkYXRhKSA9PiBXZWJTb2NrZXRVdGlscy5yZWFkVUludDE2KGRhdGEpXG4gICAgICAgICk7XG4gICAgICB9IGVsc2UgaWYgKHN0YXRlLmRhdGFMZW5ndGggPT0gMTI3KSB7XG4gICAgICAgIGRhdGFMZW5ndGhQcm9taXNlID0gYnVmZmVyLmdldCg0KS50aGVuKFxuICAgICAgICAgIChkYXRhKSA9PiBXZWJTb2NrZXRVdGlscy5yZWFkVUludDMyKGRhdGEpXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkYXRhTGVuZ3RoUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZShzdGF0ZS5kYXRhTGVuZ3RoKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGRhdGFMZW5ndGhQcm9taXNlLnRoZW4oKGRhdGFMZW5ndGgpID0+IHtcbiAgICAgICAgc3RhdGUuZGF0YUxlbmd0aCA9IGRhdGFMZW5ndGg7XG4gICAgICAgIHJldHVybiBzdGF0ZTtcbiAgICAgIH0pO1xuICAgIH0pLnRoZW4oKHN0YXRlKSA9PiB7XG4gICAgICBpZiAoc3RhdGUuaXNNYXNrZWQpIHtcbiAgICAgICAgcmV0dXJuIGJ1ZmZlci5nZXQoNCkudGhlbigobWFzaykgPT4ge1xuICAgICAgICAgIHN0YXRlLm1hc2sgPSBtYXNrO1xuICAgICAgICAgIHJldHVybiBzdGF0ZTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gc3RhdGU7XG4gICAgfSkudGhlbigoc3RhdGUpID0+IHtcbiAgICAgIHJldHVybiBzdGF0ZS5kYXRhTGVuZ3RoID8gYnVmZmVyLmdldChzdGF0ZS5kYXRhTGVuZ3RoKS50aGVuKChkYXRhKSA9PiB7XG4gICAgICAgIHN0YXRlLmRhdGEgPSBXZWJTb2NrZXRVdGlscy5tYXNrKHN0YXRlLm1hc2ssIGRhdGEpO1xuICAgICAgICByZXR1cm4gc3RhdGU7XG4gICAgICB9KSA6IHN0YXRlO1xuICAgIH0pLnRoZW4oKHN0YXRlKSA9PiB7XG4gICAgICBpZiAoc3RhdGUub3BDb2RlID09PSBPcGVyYXRpb25Db2RlLkNPTk5FQ1RJT05fQ0xPU0UpIHtcbiAgICAgICAgdmFyIGNvZGUgPSAwO1xuICAgICAgICB2YXIgcmVhc29uID0gJ1Vua25vd24nO1xuXG4gICAgICAgIGlmIChzdGF0ZS5kYXRhTGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNvZGUgPSAgV2ViU29ja2V0VXRpbHMucmVhZFVJbnQxNihzdGF0ZS5kYXRhKTtcbiAgICAgICAgICBpZiAoc3RhdGUuZGF0YUxlbmd0aCA+IDIpIHtcbiAgICAgICAgICAgIHJlYXNvbiA9IFdlYlNvY2tldFV0aWxzLmFycmF5VG9TdHJpbmcoc3RhdGUuZGF0YS5zdWJhcnJheSgyKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc29sZS5sb2coJ1NvY2tldCBpcyBjbG9zZWQ6ICcgKyBjb2RlICsgJyAnICsgcmVhc29uKTtcblxuICAgICAgICB2YXIgZGF0YUZyYW1lID0gY3JlYXRlTWVzc2FnZUZyYW1lKDB4OCwgc3RhdGUuZGF0YSwgdHJ1ZSk7XG4gICAgICAgIHRoaXNbcHJpdmF0ZXMudGNwU29ja2V0XS5zZW5kKGRhdGFGcmFtZS5idWZmZXIsIDAsIGRhdGFGcmFtZS5sZW5ndGgpO1xuICAgICAgICB0aGlzW3ByaXZhdGVzLm9uVENQU29ja2V0Q2xvc2VdKCk7XG4gICAgICB9IGVsc2UgaWYgKHN0YXRlLm9wQ29kZSA9PT0gT3BlcmF0aW9uQ29kZS5URVhUX0ZSQU1FIHx8XG4gICAgICAgICAgICAgICAgIHN0YXRlLm9wQ29kZSA9PT0gT3BlcmF0aW9uQ29kZS5CSU5BUllfRlJBTUUpIHtcbiAgICAgICAgdGhpcy5lbWl0KCdtZXNzYWdlJywgc3RhdGUuZGF0YSk7XG4gICAgICB9XG5cbiAgICAgIGlmICghYnVmZmVyLmlzRW1wdHkoKSkge1xuICAgICAgICB0aGlzW3ByaXZhdGVzLm9uTWVzc2FnZUZyYW1lXSgpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgW3ByaXZhdGVzLm9uVENQU29ja2V0Q2xvc2VdKCkge1xuICAgIHZhciB0Y3BTb2NrZXQgPSB0aGlzW3ByaXZhdGVzLnRjcFNvY2tldF07XG5cbiAgICBpZiAoIXRjcFNvY2tldCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXNbcHJpdmF0ZXMuY2xpZW50c10uZGVsZXRlKHRjcFNvY2tldC5ob3N0KTtcblxuICAgIHRjcFNvY2tldC5vbmRhdGEgPSB0Y3BTb2NrZXQub25lcnJvciA9IHRjcFNvY2tldC5vbmNsb3NlID0gbnVsbDtcblxuICAgIHRoaXNbcHJpdmF0ZXMudGNwU29ja2V0XSA9IG51bGw7XG4gIH1cblxuICBbcHJpdmF0ZXMub25UQ1BTZXJ2ZXJTb2NrZXRDbG9zZV0oKSB7XG4gICAgdmFyIHRjcFNlcnZlclNvY2tldCA9IHRoaXNbcHJpdmF0ZXMudGNwU2VydmVyU29ja2V0XTtcblxuICAgIGlmICghdGNwU2VydmVyU29ja2V0KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGNwU2VydmVyU29ja2V0Lm9uY29ubmVjdCA9IHRjcFNlcnZlclNvY2tldC5vbmVycm9yID0gbnVsbDtcblxuICAgIHRoaXNbcHJpdmF0ZXMudGNwU2VydmVyU29ja2V0XSA9IG51bGw7XG5cbiAgICB0aGlzLmVtaXQoJ3N0b3AnKTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCB7XG4gIFNlcnZlcjogV2ViU29ja2V0U2VydmVyLFxuICBVdGlsczogV2ViU29ja2V0VXRpbHMsXG4gIEZyYW1lQnVmZmVyOiBXZWJTb2NrZXRGcmFtZUJ1ZmZlclxufTtcbiIsbnVsbCwiaW1wb3J0IEV2ZW50RGlzcGF0Y2hlciBmcm9tICdldmVudC1kaXNwYXRjaGVyLWpzJztcblxudmFyIHByaXZhdGVzID0ge1xuICBkYXRhOiBTeW1ib2woJ2RhdGEnKSxcbiAgcGVuZGluZ0RhdGFSZXF1ZXN0OiBTeW1ib2woJ3BlbmRpbmdEYXRhUmVxdWVzdCcpLFxuICBzcGxpY2U6IFN5bWJvbCgnc3BsaWNlJylcbn07XG5cbmNsYXNzIFdlYlNvY2tldEZyYW1lQnVmZmVyIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgRXZlbnREaXNwYXRjaGVyLm1peGluKHRoaXMsIFsnZnJhbWUnLCAnZGF0YSddKTtcblxuICAgIHRoaXNbcHJpdmF0ZXMuZGF0YV0gPSBuZXcgVWludDhBcnJheSgwKTtcbiAgICB0aGlzW3ByaXZhdGVzLnBlbmRpbmdEYXRhUmVxdWVzdF0gPSBudWxsO1xuICAgIHRoaXNbcHJpdmF0ZXMuc3BsaWNlXSA9IGZ1bmN0aW9uKGxlbmd0aCkge1xuICAgICAgdmFyIGRhdGEgPSB0aGlzW3ByaXZhdGVzLmRhdGFdO1xuXG4gICAgICB2YXIgc3BsaWNlZERhdGEgPSBkYXRhLnN1YmFycmF5KDAsIGxlbmd0aCk7XG4gICAgICB0aGlzW3ByaXZhdGVzLmRhdGFdID0gZGF0YS5zdWJhcnJheShsZW5ndGgsIGRhdGEubGVuZ3RoKTtcblxuICAgICAgcmV0dXJuIHNwbGljZWREYXRhO1xuICAgIH07XG4gIH1cblxuICBwdXQoZGF0YVRvUHV0KSB7XG4gICAgdmFyIGRhdGEgPSB0aGlzW3ByaXZhdGVzLmRhdGFdO1xuXG4gICAgdmFyIG5ld0RhdGEgPSBuZXcgVWludDhBcnJheShkYXRhLmxlbmd0aCArIGRhdGFUb1B1dC5sZW5ndGgpO1xuICAgIG5ld0RhdGEuc2V0KGRhdGEpO1xuICAgIG5ld0RhdGEuc2V0KGRhdGFUb1B1dCwgZGF0YS5sZW5ndGgpO1xuICAgIHRoaXNbcHJpdmF0ZXMuZGF0YV0gPSBuZXdEYXRhO1xuXG4gICAgdGhpcy5lbWl0KCdkYXRhJyk7XG5cbiAgICAvLyBJZiBubyBvbmUgd2FpdGluZyBmb3IgZGF0YSwgbGV0J3Mgc2lnbmFsIHRoYXQgd2UgaGF2ZSBuZXcgZnJhbWUhXG4gICAgaWYgKCF0aGlzW3ByaXZhdGVzLnBlbmRpbmdEYXRhUmVxdWVzdF0pIHtcbiAgICAgIHRoaXMuZW1pdCgnZnJhbWUnKTtcbiAgICB9XG4gIH1cblxuICBnZXQoZGF0YUxlbmd0aCkge1xuICAgIGlmICh0aGlzW3ByaXZhdGVzLnBlbmRpbmdEYXRhUmVxdWVzdF0pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ29uY3VycmVudCByZWFkIGlzIG5vdCBhbGxvd2VkLicpO1xuICAgIH1cblxuICAgIHRoaXNbcHJpdmF0ZXMucGVuZGluZ0RhdGFSZXF1ZXN0XSA9IG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICB2YXIgZGF0YSA9IHRoaXNbcHJpdmF0ZXMuZGF0YV07XG4gICAgICBpZiAoZGF0YS5sZW5ndGggPj0gZGF0YUxlbmd0aCkge1xuICAgICAgICByZXR1cm4gcmVzb2x2ZSh0aGlzW3ByaXZhdGVzLnNwbGljZV0oZGF0YUxlbmd0aCkpO1xuICAgICAgfVxuXG4gICAgICB2YXIgc2VsZiA9IHRoaXM7XG4gICAgICB0aGlzLm9uKCdkYXRhJywgZnVuY3Rpb24gb25EYXRhKCkge1xuICAgICAgICBpZiAoZGF0YS5sZW5ndGggPCBkYXRhTGVuZ3RoKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgc2VsZi5vZmYoJ2RhdGEnLCBvbkRhdGEpO1xuICAgICAgICByZXNvbHZlKHRoaXNbcHJpdmF0ZXMuc3BsaWNlXShkYXRhTGVuZ3RoKSk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiB0aGlzW3ByaXZhdGVzLnBlbmRpbmdEYXRhUmVxdWVzdF0udGhlbigoZGF0YSkgPT4ge1xuICAgICAgdGhpc1twcml2YXRlcy5wZW5kaW5nRGF0YVJlcXVlc3RdID0gbnVsbDtcbiAgICAgIHJldHVybiBkYXRhO1xuICAgIH0pO1xuICB9XG5cbiAgaXNFbXB0eSgpIHtcbiAgICByZXR1cm4gdGhpc1twcml2YXRlcy5kYXRhXS5sZW5ndGggPT09IDA7XG4gIH07XG59XG5cbmV4cG9ydCBkZWZhdWx0IFdlYlNvY2tldEZyYW1lQnVmZmVyO1xuIiwidmFyIFdlYlNvY2tldFV0aWxzID0ge1xuICAvKipcbiAgICogTWFzayBldmVyeSBkYXRhIGVsZW1lbnQgd2l0aCB0aGUgbWFzayAoV2ViU29ja2V0IHNwZWNpZmljIGFsZ29yaXRobSkuXG4gICAqIEBwYXJhbSB7QXJyYXl9IG1hc2sgTWFzayBhcnJheS5cbiAgICogQHBhcmFtIHtBcnJheX0gYXJyYXkgRGF0YSBhcnJheSB0byBtYXNrLlxuICAgKiBAcmV0dXJucyB7QXJyYXl9IE1hc2tlZCBkYXRhIGFycmF5LlxuICAgKi9cbiAgbWFzayhtYXNrLCBhcnJheSkge1xuICAgIGlmIChtYXNrKSB7XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFycmF5Lmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGFycmF5W2ldID0gYXJyYXlbaV0gXiBtYXNrW2kgJSA0XTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGFycmF5O1xuICB9LFxuXG4gIC8qKlxuICAgKiBHZW5lcmF0ZXMgNC1pdGVtIGFycmF5LCBldmVyeSBpdGVtIG9mIHdoaWNoIGlzIGVsZW1lbnQgb2YgYnl0ZSBtYXNrLlxuICAgKiBAcmV0dXJucyB7VWludDhBcnJheX1cbiAgICovXG4gIGdlbmVyYXRlUmFuZG9tTWFzaygpIHtcbiAgICB2YXIgcmFuZG9tID0gbmV3IFVpbnQ4QXJyYXkoNCk7XG5cbiAgICB3aW5kb3cuY3J5cHRvLmdldFJhbmRvbVZhbHVlcyhyYW5kb20pO1xuXG4gICAgcmV0dXJuIHJhbmRvbTtcbiAgfSxcblxuICAvKipcbiAgICogQ29udmVydHMgc3RyaW5nIHRvIFVpbnQ4QXJyYXkuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBzdHJpbmdWYWx1ZSBTdHJpbmcgdmFsdWUgdG8gY29udmVydC5cbiAgICogQHJldHVybnMge1VpbnQ4QXJyYXl9XG4gICAqL1xuICBzdHJpbmdUb0FycmF5KHN0cmluZ1ZhbHVlKSB7XG4gICAgaWYgKHR5cGVvZiBzdHJpbmdWYWx1ZSAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignc3RyaW5nVmFsdWUgc2hvdWxkIGJlIHZhbGlkIHN0cmluZyEnKTtcbiAgICB9XG5cbiAgICB2YXIgYXJyYXkgPSBuZXcgVWludDhBcnJheShzdHJpbmdWYWx1ZS5sZW5ndGgpO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyaW5nVmFsdWUubGVuZ3RoOyBpKyspIHtcbiAgICAgIGFycmF5W2ldID0gc3RyaW5nVmFsdWUuY2hhckNvZGVBdChpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYXJyYXk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGFycmF5IHRvIHN0cmluZy4gRXZlcnkgYXJyYXkgZWxlbWVudCBpcyBjb25zaWRlcmVkIGFzIGNoYXIgY29kZS5cbiAgICogQHBhcmFtIHtVaW50OEFycmF5fSBhcnJheSBBcnJheSB3aXRoIHRoZSBjaGFyIGNvZGVzLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfVxuICAgKi9cbiAgYXJyYXlUb1N0cmluZyhhcnJheSkge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KG51bGwsIGFycmF5KTtcbiAgfSxcblxuICAvKipcbiAgICogUmVhZHMgdW5zaWduZWQgMTYgYml0IHZhbHVlIGZyb20gdHdvIGNvbnNlcXVlbnQgOC1iaXQgYXJyYXkgZWxlbWVudHMuXG4gICAqIEBwYXJhbSB7VWludDhBcnJheX0gYXJyYXkgQXJyYXkgdG8gcmVhZCBmcm9tLlxuICAgKiBAcGFyYW0ge051bWJlcn0gb2Zmc2V0IEluZGV4IHRvIHN0YXJ0IHJlYWQgdmFsdWUuXG4gICAqIEByZXR1cm5zIHtOdW1iZXJ9XG4gICAqL1xuICByZWFkVUludDE2KGFycmF5LCBvZmZzZXQpIHtcbiAgICBvZmZzZXQgPSBvZmZzZXQgfHwgMDtcbiAgICByZXR1cm4gKGFycmF5W29mZnNldF0gPDwgOCkgKyBhcnJheVtvZmZzZXQgKyAxXTtcbiAgfSxcblxuICAvKipcbiAgICogUmVhZHMgdW5zaWduZWQgMzIgYml0IHZhbHVlIGZyb20gZm91ciBjb25zZXF1ZW50IDgtYml0IGFycmF5IGVsZW1lbnRzLlxuICAgKiBAcGFyYW0ge1VpbnQ4QXJyYXl9IGFycmF5IEFycmF5IHRvIHJlYWQgZnJvbS5cbiAgICogQHBhcmFtIHtOdW1iZXJ9IG9mZnNldCBJbmRleCB0byBzdGFydCByZWFkIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7TnVtYmVyfVxuICAgKi9cbiAgcmVhZFVJbnQzMihhcnJheSwgb2Zmc2V0KSB7XG4gICAgb2Zmc2V0ID0gb2Zmc2V0IHx8IDA7XG4gICAgcmV0dXJuIChhcnJheVtvZmZzZXRdIDw8IDI0KSArXG4gICAgICAoYXJyYXlbb2Zmc2V0ICsgMV0gPDwgMTYpICtcbiAgICAgIChhcnJheSBbb2Zmc2V0ICsgMl0gPDwgOCkgK1xuICAgICAgYXJyYXlbb2Zmc2V0ICsgM107XG4gIH0sXG5cbiAgLyoqXG4gICAqIFdyaXRlcyB1bnNpZ25lZCAxNiBiaXQgdmFsdWUgdG8gdHdvIGNvbnNlcXVlbnQgOC1iaXQgYXJyYXkgZWxlbWVudHMuXG4gICAqIEBwYXJhbSB7VWludDhBcnJheX0gYXJyYXkgQXJyYXkgdG8gd3JpdGUgdG8uXG4gICAqIEBwYXJhbSB7TnVtYmVyfSB2YWx1ZSAxNiBiaXQgdW5zaWduZWQgdmFsdWUgdG8gd3JpdGUgaW50byBhcnJheS5cbiAgICogQHBhcmFtIHtOdW1iZXJ9IG9mZnNldCBJbmRleCB0byBzdGFydCB3cml0ZSB2YWx1ZS5cbiAgICogQHJldHVybnMge051bWJlcn1cbiAgICovXG4gIHdyaXRlVUludDE2KGFycmF5LCB2YWx1ZSwgb2Zmc2V0KSB7XG4gICAgYXJyYXlbb2Zmc2V0XSA9ICh2YWx1ZSAmIDB4ZmYwMCkgPj4gODtcbiAgICBhcnJheVtvZmZzZXQgKyAxXSA9IHZhbHVlICYgMHhmZjtcbiAgfSxcblxuICAvKipcbiAgICogV3JpdGVzIHVuc2lnbmVkIDE2IGJpdCB2YWx1ZSB0byB0d28gY29uc2VxdWVudCA4LWJpdCBhcnJheSBlbGVtZW50cy5cbiAgICogQHBhcmFtIHtVaW50OEFycmF5fSBhcnJheSBBcnJheSB0byB3cml0ZSB0by5cbiAgICogQHBhcmFtIHtOdW1iZXJ9IHZhbHVlIDE2IGJpdCB1bnNpZ25lZCB2YWx1ZSB0byB3cml0ZSBpbnRvIGFycmF5LlxuICAgKiBAcGFyYW0ge051bWJlcn0gb2Zmc2V0IEluZGV4IHRvIHN0YXJ0IHdyaXRlIHZhbHVlLlxuICAgKiBAcmV0dXJucyB7TnVtYmVyfVxuICAgKi9cbiAgd3JpdGVVSW50MzIoYXJyYXksIHZhbHVlLCBvZmZzZXQpIHtcbiAgICBhcnJheVtvZmZzZXRdID0gKHZhbHVlICYgMHhmZjAwMDAwMCkgPj4gMjQ7XG4gICAgYXJyYXlbb2Zmc2V0ICsgMV0gPSAodmFsdWUgJiAweGZmMDAwMCkgPj4gMTY7XG4gICAgYXJyYXlbb2Zmc2V0ICsgMl0gPSAodmFsdWUgJiAweGZmMDApID4+IDg7XG4gICAgYXJyYXlbb2Zmc2V0ICsgM10gPSB2YWx1ZSAmIDB4ZmY7XG4gIH1cbn07XG5cbmV4cG9ydCBkZWZhdWx0IFdlYlNvY2tldFV0aWxzO1xuIl19
