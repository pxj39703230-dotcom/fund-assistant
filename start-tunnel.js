const localtunnel = require('localtunnel');

(async () => {
  console.log('正在启动 localtunnel...\n');
  
  const tunnel = await localtunnel({ port: 3456 });
  
  console.log('✅ 临时分享链接已生成：');
  console.log(tunnel.url);
  console.log('\n⚠️  保持此窗口打开，链接才会持续有效...\n');
  
  tunnel.on('close', () => {
    console.log('Tunnel 已关闭');
    process.exit(0);
  });
})();
