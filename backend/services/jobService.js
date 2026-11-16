'use strict';

const db = require('../config/database');
const { todayString, dateTimeLabel } = require('../utils/date');

/** 任务执行记录：让"同步/复盘"从"发出去就不知道结果"变成可查询 */
function start(name) {
  const startedAt = new Date();
  const info = db.run('INSERT INTO job_runs (name, status, started_at) VALUES (?, ?, ?)', [
    name,
    'running',
    new Date().toISOString(),
  ]);
  return { id: info.id, name, startedAt };
}

function finish(job, status, stats = null, message = null) {
  if (!job) return;
  const duration = Date.now() - job.startedAt.getTime();
  db.run('UPDATE job_runs SET status = ?, finished_at = ?, duration_ms = ?, stats = ?, message = ? WHERE id = ?', [
    status,
    new Date().toISOString(),
    duration,
    stats ? JSON.stringify(stats) : null,
    message,
    job.id,
  ]);
}

function latest(name) {
  const row = name
    ? db.get('SELECT * FROM job_runs WHERE name = ? ORDER BY id DESC LIMIT 1', [name])
    : db.get('SELECT * FROM job_runs ORDER BY id DESC LIMIT 1');
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    stats: row.stats ? safeParse(row.stats) : null,
    message: row.message,
    label: `${row.name} ${dateTimeLabel(new Date(row.started_at))}`,
  };
}

function recent(limit = 10) {
  return db.all('SELECT * FROM job_runs ORDER BY id DESC LIMIT ?', [limit]).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    stats: row.stats ? safeParse(row.stats) : null,
    message: row.message,
  }));
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

module.exports = { start, finish, latest, recent, todayString };
