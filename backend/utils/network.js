'use strict';

const os = require('os');

function lanUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();
  for (const list of Object.values(interfaces)) {
    for (const info of list || []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      urls.push({ ip: info.address, url: `http://${info.address}:${port}` });
    }
  }
  return urls;
}

module.exports = { lanUrls };
