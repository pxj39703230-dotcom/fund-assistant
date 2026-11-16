'use strict';

const config = require('../config/env');
const { HttpError } = require('./errors');

/** 可选口令：.env 里设置了 API_TOKEN 才启用，适合手机/局域网访问时防止误操作 */
function requireToken(req, res, next) {
  if (!config.apiToken) return next();
  const provided = req.get('x-api-token') || req.query.token;
  if (provided && provided.trim() === config.apiToken) return next();
  next(new HttpError(401, '需要访问口令（X-API-Token）'));
}

function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'no-referrer');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'",
  );
  next();
}

module.exports = { requireToken, securityHeaders };
