# 基金账本 · Fund Ledger MCP

在 ChatGPT 网页版记录已发生的人民币场外基金交易，按平台查询份额、成本和已披露净值日的收益。账本保存在 PostgreSQL，身份来自 OAuth。只读 ChatGPT 账号可在同一服务的 `/manage` 页面录入。项目没有下单接口。

**仅使用免费资源**可按[零费用部署说明](docs/FREE.md)配置休眠 Web 服务和独立净值同步。

**常驻部署请从 [中文网页部署指南](docs/DEPLOY.md) 开始。** 源码内没有已上线服务的地址。不要把实际持仓、交易导出或密钥提交到仓库。

| 入口 | 用途 |
| --- | --- |
| [使用、记账口径和已知限制](docs/USAGE.md) | 期初导入、申赎、分红、收益率及七个自然语言场景 |
| [工具索引](docs/TOOLS.md) · [完整参数 JSON Schema](docs/tools.json) | MCP 工具、权限、输入、输出与错误 |
| [架构、数据模型和安全](docs/DESIGN.md) | 计算路径、事务、用户隔离、数据来源及上游对照 |
| [部署、备份和恢复](docs/DEPLOY.md) | Railway 网页操作、Auth0、ChatGPT 接入、Render 备选与成本 |
| [实际测试报告](docs/TESTING.md) | PostgreSQL、HTTPS 客户端、Docker、公开数据源及待上线验收项 |

## 运行

需要 Node.js 22.21+（已测试 24）、PostgreSQL 以及 [.env.example](.env.example) 所列环境变量。云端从 Secret 注入。HTTP 启动时自动执行带校验和的迁移。开发机可用 Node 的 `--env-file` 加载文件。

```sh
npm ci --ignore-scripts
node --env-file=.env src/index.js --http
```

`npm run stdio` 启动可信本机 stdio 客户端，必须额外设置 `STDIO_SUBJECT`。HTTP、stdio 与浏览器共享同一用户身份和数据库。`npm run sync` 手动运行独立批处理。`npm test` 要求专用 `TEST_DATABASE_URL` 及 OpenSSL，测试会创建并清理独立 schema。

## 上游与许可

行情适配器源自 smallke 的 cn-funds-mcp，基线提交为 `bb44fbc653bb068f0cacd588f19aed0249bffc3d`。上游 package.json 声明 MIT，未附独立许可证文件。本项目保留作者和原说明，补充 MIT 全文。公开行情的数据权利及使用条件见上游第三方声明。[上游仓库](https://github.com/smallke/cn-funds-mcp) · [原始 README 和数据声明](docs/UPSTREAM.md) · [MIT](LICENSE)
