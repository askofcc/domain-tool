# 批量域名查询工具 (Batch Domain Query Tool)

一个高效、安全的开源批量域名查询工具。支持 925+ 域名后缀批量组合，支持 `[a-z]`、`AABB`、`ABAB`、豹子、顺子等自定义正则规则批量生成，并提供一键复制与 CSV 导出。

系统内置了 **DNS 预过滤** 与 **低压自适应轮询** 机制，能在查询数千个域名时最大程度降低上游接口的负载，避免触发速率限制。

---

## 🌟 核心特性

- **超强规则生成器**：支持自定义正则匹配，可一键批量生成三位数字、四位字母、前缀/后缀组合、豹子、AABB、ABAB 等规则的域名列表。
- **全内置 925+ 后缀数据库**：内置所有常见 TLD 的首年促销价、普通价格以及特性标签（如自由过户、提供信托、支持字符长度等），提供多维度筛选。
- **轻量级单文件架构**：前端基于纯原生 HTML/CSS/JS 开发，无任何框架依赖，加载极快，交互流畅。
- **DNS 预过滤机制**：在发起 WHOIS 检索前，后台会利用 Cloudflare DoH 先行检测域名的解析状态。对已经拥有 A/NS 记录的域名直接判定为“已注册”，拦截超 80% 的无效 WHOIS 请求。
- **低压自适应轮询（防 WAF 限流）**：
  - 采用 **25 个域名一批** 的串行查询队列（`concurrency = 1`）。
  - 使用 **指数退避时间探测**（2s、3.5s、5s、6.5s...），为 WHOIS 系统留出充足的后台同步时间。
  - 分批查询之间自动应用冷却等待（1800ms），完美规避上游限流或 IP 屏蔽。
- **本地调试代理 (Local Proxy)**：内置 Node.js 代理，自动解决浏览器跨域（CORS）与会话 Cookie 获取问题，并提供路径穿越防护及参数校验。
- **AI Agent / Skill 友好**：提供开放 API 与可选 Skill 说明，便于 Claude Code、Managed Agents 或其它自动化智能体安全分批查询并汇总推荐。

---

## 📂 项目结构

```text
├── build.js             # 编译脚本（将 index.html 编译注入到 worker.js 中）
├── index.html           # 前端单页面主程序
├── package.json         # 本地开发、构建与部署脚本
├── proxy.js             # 本地开发代理服务（Node.js）
├── skills/              # 可选 AI Skill 说明
│   └── domain-availability-checker/SKILL.md
├── worker_template.js   # Cloudflare Workers 代码模板
├── worker.js            # 编译生成的 Cloudflare Workers 部署代码（不会提交）
└── wrangler.toml        # Wrangler 部署配置文件（部署前自动执行 build.js）
```

---

## 🌐 在线体验

- **自定义域名**：https://domain-tool.srint.cn
- **官方域名**：https://domain-tool.sugar-diamond.workers.dev

---

## 🚀 快速开始

### 1. 本地运行与开发联调

在本地运行代理，即可直接调用真实接口进行域名可用性查验：

```bash
# 进入项目目录
cd domain-tool

# 启动本地代理（默认运行在 5174 端口）
npm run dev
```

启动后，在浏览器中打开：**`http://localhost:5174`**，即可开始批量生成并查询域名。

### 2. 编译并部署到 Cloudflare Workers

该项目支持以 Serverless 形式一键部署到 Cloudflare Workers 平台，无需维护物理服务器。

#### 第一步：编译打包

Wrangler 会在部署前自动运行 `node build.js`，也可以手动编译检查生成结果：

```bash
npm run build
```

#### 第二步：部署上线

- **正式环境部署**（需要本地已配置 Cloudflare API Token 或已登录）：
  ```bash
  npm run deploy
  ```

- **临时免密测试部署**（主打推荐 🚀）：
  如果你目前在无凭据环境（例如 CI 容器或临时的 AI 会话中），可以使用 Wrangler 提供的临时沙箱服务。它会为你生成一个临时的 Cloudflare 域名以及一个有效期为 60 分钟的临时账号认领 URL，无需登录即可立即在公网测试：
  ```bash
  npm run deploy:temporary
  ```

---

## 🛠️ AI Agent 智能体 & 开发者接口 (API)

后端 Worker 及 Proxy 提供开放式批量查询接口，已自动处理跨域（CORS）与上游 Session Cookie，允许 AI 智能体或脚本直接调用。项目还附带可选 Skill：`skills/domain-availability-checker/SKILL.md`，用于告诉 AI 如何安全分批、低压轮询、解释结果并输出推荐。

### 什么时候使用 Skill？

- 临时脚本或普通开发者调用：直接使用 `/api/check` 即可。
- Claude Code、Managed Agents 或其它 AI Agent 自动生成候选域名、批量查询、重试超时并做推荐：建议加载 `domain-availability-checker` Skill。
- Skill 不替代 API，它是给 AI 的使用手册，核心约束是：合法域名校验、低压分批、timeout 单独复查、不要高频轮询。

### 接口定义

- **接口地址**：`/api/check`
- **请求方式**：`POST`
- **数据格式**：`application/json`
- **批量上限**：接口最多 60 个域名一批；大量查询建议 25 个一批并串行调用。
- **请求参数**：普通调用只需要传 `domains`；Worker/Proxy 会自动获取上游会话 Cookie。
  ```json
  {
    "domains": ["apple.ai", "banana.co", "testxyz12345.com"]
  }
  ```
- **响应参数**：
  ```json
  [
    {"status":"success","result":"unavailable","domain":"apple.ai"},
    {"status":"success","result":"unavailable","domain":"banana.co"},
    {"status":"success","result":"timeout","domain":"testxyz12345.com"}
  ]
  ```

### 状态语义

- `available`：当前看起来可注册。
- `unavailable`：当前看起来已注册或不可注册。
- `wait`：上游仍在处理，仅在请求中加入 `allowWait: true` 时返回。
- `timeout`：本轮没有落定，不能当成已注册，应单独列为“稍后重试”。

### 高级低压轮询

如果脚本需要接收中间态 `wait`，先调用 `GET /api/session` 获取 `cookie`，同一批初始请求和后续轮询复用相同的 `session` 与 `cookie`。首次请求带 `allowWait: true`，后续只查询仍在等待的域名并加 `isPoll: true`。

```json
{
  "domains": ["testxyz12345.com"],
  "session": "stable_batch_session_001",
  "cookie": "WHMCS...; ipaddress=...",
  "allowWait": true,
  "isPoll": true
}
```

建议轮询间隔使用退避策略：约 2s、3.5s、5s、6.5s；不要高频死循环。

---

## 📝 开源协议与反馈

- **开源地址**：[github.com/askofcc/domain-tool](https://github.com/askofcc/domain-tool)

欢迎提交 Issue 或 Pull Request，一起让批量域名查询变得更简单、更高效！
