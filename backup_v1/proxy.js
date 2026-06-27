// 本地联调代理：同源服务静态文件 + 转发 /whois2.php 到 quyu.net。
// 解决两件事：① 浏览器跨域 CORS；② quyu.net 会话 cookie。
// 用法：  node proxy.js     然后浏览器打开 http://localhost:5174 ，结果区数据源选「真实接口」。
// （生产环境若把 index.html 部署到 quyu.net 同源目录下，可不需要本代理。）

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = process.env.PORT || 5174;
const ROOT = __dirname;
const HOST = 'www.quyu.net';
let cookie = '';                       // 缓存的会话 cookie（首次自动获取）

// 向 quyu.net 发起请求，自动收集/带上 cookie
function quyu(method, urlPath, body){
  return new Promise(function(resolve, reject){
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
      'Referer': 'https://' + HOST + '/domainchecker.php',
      'Accept': 'application/json, text/javascript, */*; q=0.01'
    };
    if(method === 'POST'){
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      headers['X-Requested-With'] = 'XMLHttpRequest';
      headers['Content-Length'] = Buffer.byteLength(body || '');
    }
    if(cookie) headers['Cookie'] = cookie;
    const r = https.request({ method: method, hostname: HOST, path: urlPath, headers: headers }, function(res){
      const sc = res.headers['set-cookie'];
      if(sc) cookie = sc.map(function(c){ return c.split(';')[0]; }).join('; ');
      let d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ resolve({ status: res.statusCode, body: d }); });
    });
    r.on('error', reject);
    if(body) r.write(body);
    r.end();
  });
}
// 确保有会话 cookie（首次访问 domainchecker.php 获取）
async function ensureSession(){ if(!cookie) await quyu('GET', '/domainchecker.php'); }

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };

http.createServer(function(req, res){
  const u = req.url.split('?')[0];

  // 转发 whois2.php（与原站同构：domain=...&ajax=1 [&wait=wait]）
  if(u === '/whois2.php' && req.method === 'POST'){
    let body = ''; req.on('data', function(c){ body += c; });
    req.on('end', async function(){
      try{
        await ensureSession();
        const r = await quyu('POST', '/whois2.php', body);
        res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*' });
        res.end(r.body);
      }catch(e){
        res.writeHead(502, { 'Content-Type':'application/json' });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }

  // 其余按静态文件服务
  const f = path.join(ROOT, u === '/' ? 'index.html' : decodeURIComponent(u));
  if(f.indexOf(ROOT) !== 0){ res.writeHead(403); res.end('Forbidden'); return; }   // 防目录穿越
  fs.readFile(f, function(e, data){
    if(e){ res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, function(){
  console.log('域名工具 + whois2 代理已启动： http://localhost:' + PORT);
  console.log('打开后在「查询结果」区把数据源切到「真实接口」即可联调真实 whois2.php。');
});
