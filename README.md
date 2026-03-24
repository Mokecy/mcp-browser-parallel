# mcp-browser-parallel

多实例并行浏览器 MCP Server — 在单个 Chrome 进程中管理多个隔离的浏览器实例，支持 Cookie 自动克隆。

## 核心特性

- **多实例隔离**：每个实例拥有独立的 BrowserContext（cookies、storage、缓存完全隔离）
- **零登录克隆**：从用户已登录的 Chrome 自动提取 auth，新实例自动继承登录状态
- **并行友好**：所有操作通过 `instanceId` 路由，无共享全局状态，多 AI 会话可同时操作不同实例
- **CDP 窗口管理**：支持通过 CDP 协议真正最大化窗口

## 工作原理

```
用户的 Chrome（已登录，端口 9222）
         │
         │ connectOverCDP
         ↓
┌─────────────────────────────────┐
│  mcp-browser-parallel Server    │
│                                 │
│  browser_connect                │
│    → 连接 Chrome                │
│    → 提取 storageState          │
│                                 │
│  instance_create("batch-1")     │
│    → 新建 BrowserContext        │
│    → 注入 cookies → 已登录！     │
│    → 导航到目标 URL             │
│                                 │
│  instance_create("batch-2")     │
│    → 又一个独立 Context          │
│    → 同样已登录！                │
│                                 │
│  page_snapshot("batch-1")       │  ← 操作 batch-1
│  page_click("batch-1", "e5")    │  ← 不影响 batch-2
│                                 │
│  page_snapshot("batch-2")       │  ← 操作 batch-2
│  page_click("batch-2", "e3")    │  ← 不影响 batch-1
└─────────────────────────────────┘
```

## 安装

### 方式一：直接使用（推荐）

无需克隆代码，直接通过 npx 使用：

```json
{
  "mcpServers": {
    "browser-parallel": {
      "command": "npx",
      "args": ["mcp-browser-parallel@latest"]
    }
  }
}
```

### 方式二：指定 Chrome CDP 端点

```json
{
  "mcpServers": {
    "browser-parallel": {
      "command": "npx",
      "args": [
        "mcp-browser-parallel@latest",
        "--cdp-endpoint", "http://localhost:9222"
      ]
    }
  }
}
```

### 方式三：从源码构建

```bash
git clone <repo-url>
cd mcp-browser-parallel
npm install
npm run build
```

## 使用

### 1. 启动 Chrome（开启远程调试）

```bash
# Windows
chrome.exe --remote-debugging-port=9222

# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

### 2. 在 Chrome 中登录目标系统

手动在 Chrome 中打开目标系统并完成登录。

### 3. 使用工具

```
Step 1: 连接 Chrome 并提取 auth
→ browser_connect(cdpUrl="http://localhost:9222")

Step 2: 创建隔离实例（自动带登录状态）
→ instance_create(instanceId="batch-1", url="https://your-system.com/module1")
→ instance_create(instanceId="batch-2", url="https://your-system.com/module2")

Step 3: 对每个实例独立操作
→ page_snapshot(instanceId="batch-1")
→ page_click(instanceId="batch-1", ref="e5")
→ page_snapshot(instanceId="batch-2")
→ page_click(instanceId="batch-2", ref="e3")

Step 4: 完成后关闭
→ instance_close_all()
```

## 工具清单

### 实例管理

| 工具 | 说明 |
|------|------|
| `browser_connect` | 连接 Chrome CDP + 提取 auth |
| `instance_create` | 创建隔离实例（自动克隆 auth） |
| `instance_list` | 列出所有活跃实例 |
| `instance_close` | 关闭指定实例 |
| `instance_close_all` | 关闭所有实例 |

### 页面操作（所有操作通过 instanceId 路由）

| 工具 | 说明 |
|------|------|
| `page_navigate` | 导航到 URL |
| `page_snapshot` | 获取可访问性快照（含 ref） |
| `page_click` | 点击元素（by ref） |
| `page_fill` | 填入文本（by ref） |
| `page_type` | 逐字输入（触发 input 事件） |
| `page_select_option` | 下拉选择 |
| `page_hover` | 悬停 |
| `page_press_key` | 按键 |
| `page_screenshot` | 截图 |
| `page_wait` | 等待文本/时间 |
| `page_evaluate` | 执行 JS |
| `page_maximize` | CDP 窗口最大化 |

## 与现有 MCP 对比

| 特性 | Chrome DevTools MCP | Playwright MCP | **本 MCP** |
|------|-------------------|---------------|-----------|
| 多实例隔离 | ❌ 共享 select_page 状态 | ❌ 单实例 | ✅ 独立 Context |
| Auth 克隆 | ❌ | ❌ | ✅ storageState |
| 并行安全 | ❌ 会话间冲突 | ❌ 会话间冲突 | ✅ instanceId 路由 |
| 窗口最大化 | ❌ | ✅ browser_run_code | ✅ 内置 CDP |
| 快照 + Ref | ✅ uid | ✅ ref | ✅ ref |
