'use strict';

/**
 * 有并发上限的任务池。
 * 上游行情站对高频请求会限流，串行又太慢，这里用固定并发 + 由调用方控制间隔。
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  };

  const workers = Array.from({ length: Math.min(Math.max(limit, 1), items.length || 1) }, run);
  await Promise.all(workers);
  return results;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { mapWithConcurrency, sleep };
