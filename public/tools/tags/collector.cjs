// collector.js —— 本地数据接收服务
// 启动：node collector.js
// 停止：Ctrl + C

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8899;
const OUT_DIR = path.join(process.cwd(), 'collected');

// 确保输出目录存在
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('已创建目录:', OUT_DIR);
}

// 简易 CORS 头
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
}

const server = http.createServer((req, res) => {
  setCors(res);

  // 预检请求
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 健康检查：浏览器访问 http://127.0.0.1:8899 可确认服务在线
  if (req.method === 'GET') {
    res.writeHead(200);
    return res.end(JSON.stringify({
      status: 'ok',
      port: PORT,
      outDir: OUT_DIR,
      time: new Date().toISOString()
    }));
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end(JSON.stringify({ error: '仅支持 POST' }));
  }

  // 接收数据
  let body = '';
  let size = 0;
  req.on('data', chunk => {
    body += chunk;
    size += chunk.length;
    // 防止内存爆掉，限制 20MB
    if (size > 20 * 1024 * 1024) {
      req.destroy();
      res.writeHead(413);
      res.end(JSON.stringify({ error: '数据过大' }));
    }
  });

  req.on('end', () => {
    try {
      const data = JSON.parse(body);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const type = data.type || 'data';
      const filename = `${type}_${stamp}.json`;
      const filepath = path.join(OUT_DIR, filename);

      fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');

      console.log('──────────────────────────────');
      console.log('已保存:', filepath);
      console.log('大小:', (body.length / 1024).toFixed(1), 'KB');
      console.log('条目:', data.count ?? data.items?.length ?? 'N/A');
      console.log('──────────────────────────────');

      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, filename, path: filepath }));
    } catch (e) {
      console.error('解析失败:', e.message);
      res.writeHead(400);
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  req.on('error', e => {
    console.error('请求错误:', e.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n✅ 接收服务已启动`);
  console.log(`   地址: http://127.0.0.1:${PORT}`);
  console.log(`   输出: ${OUT_DIR}`);
  console.log(`   停止: Ctrl + C\n`);
});

// 优雅退出
process.on('SIGINT', () => {
  console.log('\n服务已停止');
  server.close();
  process.exit(0);
});
