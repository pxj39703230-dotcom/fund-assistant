'use strict';

class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const badRequest = (message, details) => new HttpError(400, message, details);
const notFound = (message = '资源不存在') => new HttpError(404, message);
const conflict = (message) => new HttpError(409, message);

/** 包装 async 路由，Express 4 不会自动捕获 rejected promise */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, badRequest, notFound, conflict, asyncHandler };
