'use strict';

const express = require('express');
const { buildPeerReport } = require('../../services/peer');

const router = express.Router();

const peerCache = new Map();              // code -> { at, data }
const PEER_TTL = 6 * 60 * 60 * 1000;      // 净值 T+1，6 小时足够

router.get('/:code', async (req, res) => {
  const code = String(req.params.code || '');
  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: { message: '基金代码必须是 6 位数字' } });
  }
  const hit = peerCache.get(code);
  if (hit && Date.now() - hit.at < PEER_TTL) {
    return res.json(hit.data);
  }
  try {
    const data = await buildPeerReport(code);
    peerCache.set(code, { at: Date.now(), data });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message || '同类数据获取失败' } });
  }
});

module.exports = router;
