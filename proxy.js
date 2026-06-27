// 本地联调代理：同源服务静态文件 + 转发 /whois2.php 到 quyu.net。
// 解决两件事：① 浏览器跨域 CORS；② quyu.net 会话 cookie。
// 用法：  node proxy.js     然后浏览器打开 http://localhost:5174 。
// （生产环境若把 index.html 部署到 quyu.net 同源目录下，可不需要本代理。）

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT = process.env.PORT || 5174;
const ROOT = path.resolve(__dirname);
const HOST = 'www.quyu.net';
const MAX_BODY_BYTES = 64 * 1024;
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
let cookie = '';                       // 缓存的会话 cookie（首次自动获取）

// 向 quyu.net 发起请求，自动收集/带上 cookie，支持传入自定义 Cookie
function quyu(method, urlPath, body, customCookie){
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
    const useCookie = customCookie || cookie;
    if(useCookie) headers['Cookie'] = useCookie;
    const r = https.request({ method: method, hostname: HOST, path: urlPath, headers: headers }, function(res){
      const sc = res.headers['set-cookie'];
      if(sc && !customCookie) cookie = sc.map(function(c){ return c.split(';')[0]; }).join('; ');
      let d = ''; res.on('data', function(c){ d += c; }); res.on('end', function(){ resolve({ status: res.statusCode, body: d }); });
    });
    r.on('error', reject);
    if(body) r.write(body);
    r.end();
  });
}
// 确保有会话 cookie（首次访问 domainchecker.php 获取）
async function ensureSession(){ if(!cookie) await quyu('GET', '/domainchecker.php'); }

function dnsCheck(domain) {
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        req.destroy();
        resolve(false);
      }
    }, 2000);

    const options = {
      hostname: 'cloudflare-dns.com',
      path: '/dns-query?name=' + encodeURIComponent(domain) + '&type=A',
      headers: { 'Accept': 'application/dns-json' }
    };
    const req = https.get(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        clearTimeout(timer);
        if (resolved) return;
        resolved = true;
        try {
          const json = JSON.parse(data);
          if (json.Answer && json.Answer.length > 0) return resolve(true);
          if (json.Status === 0) {
            let nsResolved = false;
            const nsTimer = setTimeout(() => {
              if (!nsResolved) {
                nsResolved = true;
                nsReq.destroy();
                resolve(false);
              }
            }, 2000);

            const nsOptions = {
              hostname: 'cloudflare-dns.com',
              path: '/dns-query?name=' + encodeURIComponent(domain) + '&type=NS',
              headers: { 'Accept': 'application/dns-json' }
            };
            const nsReq = https.get(nsOptions, (nsRes) => {
              let nsData = '';
              nsRes.on('data', (c) => nsData += c);
              nsRes.on('end', () => {
                clearTimeout(nsTimer);
                if (nsResolved) return;
                nsResolved = true;
                try {
                  const nsJson = JSON.parse(nsData);
                  resolve(!!(nsJson.Answer && nsJson.Answer.length > 0));
                } catch(e) { resolve(false); }
              });
            });
            nsReq.on('error', () => {
              clearTimeout(nsTimer);
              if (!nsResolved) {
                nsResolved = true;
                resolve(false);
              }
            });
          } else {
            resolve(false);
          }
        } catch(e) { resolve(false); }
      });
    });
    req.on('error', () => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    });
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function normalizeDomains(domains) {
  if (!Array.isArray(domains) || domains.length > 60) return null;
  const out = [];
  for (let i = 0; i < domains.length; i++) {
    if (typeof domains[i] !== 'string') return null;
    const domain = domains[i].trim().toLowerCase();
    if (!DOMAIN_RE.test(domain)) return null;
    out.push(domain);
  }
  return out;
}

function rejectBadRequest(res, message) {
  res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ error: message }));
}

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };

http.createServer(async function(req, res){
  const u = req.url.split('?')[0];

  // 获取动态 session cookie 接口
  if(u === '/api/session' && req.method === 'GET'){
    try {
      await ensureSession();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ cookie: cookie }));
    } catch(e) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // 聚合查询接口（内置 DNS 预过滤 + 客户端轮询）
  if(u === '/api/check' && req.method === 'POST'){
    try{
      const body = await readBody(req, MAX_BODY_BYTES);
      const payload = JSON.parse(body);
      const domains = normalizeDomains(payload.domains);
      const sessionCookie = payload.cookie || ('WHMCSuOQfKxKVe7YU=' + (payload.session || 'local_proxy_session_' + Math.floor(Math.random() * 100000)));
      const isPoll = payload.isPoll === true;
      const allowWait = payload.allowWait === true;

      if (!domains) {
        rejectBadRequest(res, 'domains must be an array of max 60 valid domain names');
        return;
      }

      const finalResults = {};

      if (!isPoll) {
        // 1. DNS 预过滤
        const dnsFlags = await Promise.all(domains.map(dnsCheck));
          const unresolvedDomains = [];

          for (let i = 0; i < domains.length; i++) {
            const domain = domains[i];
            if (dnsFlags[i]) {
              finalResults[domain] = { status: 'success', result: 'unavailable', domain: domain };
            } else {
              unresolvedDomains.push(domain);
              finalResults[domain] = { status: 'success', result: 'wait', domain: domain };
            }
          }

          // 2. 仅请求一次 WHOIS 接口 (不带 &wait=wait)
          if (unresolvedDomains.length > 0) {
            const postBody = 'domain=' + encodeURIComponent(unresolvedDomains.join(',')) + '&ajax=1';
            try {
              const r = await quyu('POST', '/whois2.php', postBody, sessionCookie);
              const initRes = JSON.parse(r.body);
              (Array.isArray(initRes) ? initRes : []).forEach(r => {
                if (r && r.domain && finalResults[r.domain]) finalResults[r.domain] = r;
              });
            } catch(e) {
              unresolvedDomains.forEach(d => { finalResults[d] = { status: 'success', result: 'timeout', domain: d }; });
            }
          }
        } else {
          // 轮询请求：直接向 whois2.php 发送带 wait=wait 的请求，不进行 DNS 检测
          const postBody = 'domain=' + encodeURIComponent(domains.join(',')) + '&ajax=1&wait=wait';
          try {
            const r = await quyu('POST', '/whois2.php', postBody, sessionCookie);
            const pollRes = JSON.parse(r.body);
            (Array.isArray(pollRes) ? pollRes : []).forEach(r => {
              if (r && r.domain) finalResults[r.domain] = r;
            });
          } catch(e) {
            domains.forEach(d => { finalResults[d] = { status: 'success', result: 'timeout', domain: d }; });
          }
        }

        const responseData = domains.map(d => {
          const item = finalResults[d] || { status: 'success', result: 'wait', domain: d };
          if (!allowWait && item.result === 'wait') return { status: 'success', result: 'timeout', domain: d };
          return item;
        });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(responseData));
    }catch(e){
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // 转发 whois2.php（与原站同构：domain=...&ajax=1 [&wait=wait]）
  if(u === '/whois2.php' && req.method === 'POST'){
    try{
      const body = await readBody(req, MAX_BODY_BYTES);
      await ensureSession();
      const r = await quyu('POST', '/whois2.php', body);
      res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*' });
      res.end(r.body);
    }catch(e){
      res.writeHead(502, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // 其余按静态文件服务
  let f;
  try {
    f = path.resolve(ROOT, u === '/' ? 'index.html' : decodeURIComponent(u).replace(/^\/+/, ''));
  } catch(e) {
    res.writeHead(400); res.end('Bad request'); return;
  }
  if(f !== ROOT && !f.startsWith(ROOT + path.sep)){ res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(f, function(e, data){
    if(e){ res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, function(){
  console.log('域名工具 + whois2 代理已启动： http://localhost:' + PORT);
  console.log('打开页面即可联调真实 whois2.php。');
});
