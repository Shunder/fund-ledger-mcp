# 用自己的 AI 客户端打开基金账本

本地演示使用 stdio。每个服务进程都有一份新的内存账本，内置两只虚构基金、两个平台和一段净值历史。服务从 2025-03-31 的持仓开始供查询，可把行情回放到 2025-04-01。安装依赖后，演示工具可以离线运行。自然语言对话所用模型由客户端选择，其数据处理和计费取决于模型提供方。

## DeepSeek Harness

在装有 Node.js 22.21+ 和 DeepSeek Harness CLI 的环境中，进入本仓库，运行以下命令。启动参数适用于实测的 `@deepseek-ai/dsh 0.2.2-rc.5`。

```sh
npm ci --ignore-scripts
dsh web --patch examples/clients/deepseek-demo.yml
```

打开 Harness 在终端显示的本机网页，选择工作目录和已经配置好的模型，发送“回放到 2025-04-01，按平台列出当日收益和仍待披露的基金”。接着问“按上一个完整自然月算 XIRR 和最大回撤”。工具轨迹应包含 `mcp__fund_ledger__refresh_portfolio` 和相应的查询工具。插件会从启动目录解析演示入口，请从仓库根目录运行命令。[Harness 官方运行方式](https://github.com/deepseek-ai/deepseek-harness/tree/master/apps/cli) · [官方 MCP 客户端](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/mcp/mcp-client)

## Claude Desktop、VS Code 与通用 stdio 客户端

在仓库根目录运行以下命令，生成含本机 Node 可执行文件和服务入口**绝对路径**的配置。保留现有服务器条目，将生成的 `fund_ledger` 条目合并到客户端对应配置，再重新加载。Windows 路径会自动转义。

```sh
npm run --silent client-config
npm run --silent client-config -- --vscode
```

第一条输出 `mcpServers` 配置，可合并到 Claude Desktop 的 `claude_desktop_config.json`。第二条输出 VS Code 的 `servers` 配置，可合并到 `.vscode/mcp.json`。其他 stdio 客户端使用同样的 command 和 args。SDK 接入可直接参照仓库中实际运行演示的[标准客户端](../demo/client.js)。

## 远程私人账本

在支持 OAuth 的 MCP 客户端选择 Streamable HTTP，填写自己部署的完整 HTTPS `/mcp` 地址。为客户端在身份提供方登记其实际回调地址，通过浏览器登录。访问令牌须属于白名单用户，受众为完整 MCP 地址，读取须有 `portfolio:read`，记账还须有 `portfolio:write`。具体注册和 ChatGPT 网页端操作见[部署指南](DEPLOY.md)。

对支持请求头的 Harness 版本，仓库提供[远程配置](../examples/clients/deepseek-https.yml)。将保留域名替换为自己的 HTTPS 地址，把用户通过授权流程取得的短期访问令牌放入 Harness 凭据提供程序的 `FUND_LEDGER_ACCESS_TOKEN`，启动 `dsh web --patch examples/clients/deepseek-https.yml`。此配置需要在令牌到期后更新凭据。连接真实持仓前，请核对所选模型及客户端的会话日志设置。

可信本机的持久化 stdio 入口为 `src/index.js`，需要 PostgreSQL 和部署指南中的环境变量，包括白名单内的 `STDIO_SUBJECT`。它与同一身份的远程账号共享账本。本地体验使用独立的 `demo/server.js`，演示进程结束后改动即清空。
