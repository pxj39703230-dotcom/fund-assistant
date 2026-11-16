'use strict';

const config = require('../config/env');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] || LEVELS.info;
const TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: config.timezone,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function stamp() {
  return TIME_FORMATTER.format(new Date()).replace(/\//g, '-');
}

function emit(level, scope, args) {
  if (LEVELS[level] < threshold) return;
  const prefix = `[${stamp()}] ${level.toUpperCase()} ${scope ? `(${scope}) ` : ''}`;
  const sink = console[level === 'debug' ? 'log' : level] || console.log;
  sink(prefix, ...args);
}

function createLogger(scope = '') {
  return {
    debug: (...args) => emit('debug', scope, args),
    info: (...args) => emit('info', scope, args),
    warn: (...args) => emit('warn', scope, args),
    error: (...args) => emit('error', scope, args),
    child: (sub) => createLogger(sub),
  };
}

module.exports = createLogger('app');
module.exports.createLogger = createLogger;
