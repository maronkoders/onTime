const EventEmitter = require('events');

const messageEmitter = new EventEmitter();
messageEmitter.setMaxListeners(20);

module.exports = messageEmitter;
