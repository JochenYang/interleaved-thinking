# 交错顺序思维 MCP 服务器

[English](./README.md) | [中文](./README_CN.md)

---

一个 MCP 服务器实现，使 AI 能够执行交错顺序思维并动态调用工具。该服务器允许 AI 在推理、工具执行和结果分析之间灵活切换，实现"思考-执行-反思"的循环。

## 特性

- **自动阶段检测**：无需指定阶段 - 根据上下文自动推断
- **简化的 API**：像 sequential-thinking 一样简单，但具备工具执行能力
- **三阶段交错执行**：在思考、工具调用和分析阶段之间无缝切换
- **动态工具调用**：在推理过程中执行外部工具，并根据结果调整策略
- **上下文连续性**：在整个交错循环中保持完整的上下文
- **灵活的策略调整**：支持修正、分支和动态调整步骤数
- **完整的历史追踪**：记录所有思维步骤和工具调用的详细信息
- **资源控制**：内置工具调用次数限制和超时控制，防止无限循环
- **测试支持**：模拟工具结果，无需真实工具执行即可测试

## 使用场景

此工具适用于：
- 需要多个步骤分解的复杂问题
- 推理过程中需要外部信息的任务
- 需要根据中间结果调整策略的问题
- 开始时范围不完全清楚的情况
- 需要迭代验证和信息收集的任务
- 受益于"思考-执行-反思"循环的问题

## 工具

### interleaved-thinking

促进带有动态工具调用的交错顺序思维。

**核心参数：**

- `thought` (字符串): 当前思考内容
- `stepNumber` (整数): 当前步骤编号（从 1 开始）
- `totalSteps` (整数): 预估所需总步骤数
- `nextStepNeeded` (布尔值): 是否需要下一步

**阶段控制（可选 - 省略时自动推断）：**

- `phase` (枚举，可选): 当前阶段 - 'thinking'、'tool_call' 或 'analysis'
  - 如果省略，将自动推断：
    - 提供 `toolCall` → 自动检测为 'tool_call'
    - 在 'tool_call' 之后 → 自动检测为 'analysis'
    - 否则 → 默认为 'thinking'

**工具调用参数（提供时触发工具执行）：**

- `toolCall` (对象，可选):
  - `toolName` (字符串): 要执行的工具名称
  - `parameters` (对象): 工具参数（键值对）
  - `metadata` (对象，可选): timeout、retryCount、priority

**高级参数（可选）：**

- `isRevision` (布尔值): 是否修正之前的推理
- `revisesStep` (整数): 正在重新考虑的步骤编号
- `branchFromStep` (整数): 分支起点步骤编号
- `branchId` (字符串): 分支标识符
- `needsMoreSteps` (布尔值): 是否需要更多步骤

## 配置

### 在 Claude Code CLI 中使用

将以下内容添加到 Claude Code CLI MCP 设置：

```json
{
  "interleaved-thinking": {
    "command": "cmd",
    "args": [
      "/c",
      "npx",
      "@jochenyang/interleaved-thinking@latest"
    ],
    "env": {},
    "type": "stdio"
  }
}
```

### 在 Cursor 中使用

将以下内容添加到 Cursor MCP 设置：

```json
{
  "mcpServers": {
    "interleaved-thinking": {
      "command": "npx",
      "args": [
        "-y",
        "@jochenyang/interleaved-thinking"
      ]
    }
  }
}
```

### 在 Kiro 中使用

将以下内容添加到 Kiro MCP 配置：

```json
{
  "mcpServers": {
    "interleaved-thinking": {
      "command": "npx",
      "args": [
        "-y",
        "@jochenyang/interleaved-thinking"
      ]
    }
  }
}
```

### 在 VS Code 中使用

手动安装时，将配置添加到工作区的 `.vscode/mcp.json`：

```json
{
  "servers": {
    "interleaved-thinking": {
      "command": "npx",
      "args": [
        "-y",
        "@jochenyang/interleaved-thinking"
      ]
    }
  }
}
```

### Docker

```json
{
  "mcpServers": {
    "interleaved-thinking": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "jochenyang/interleaved-thinking"
      ]
    }
  }
}
```

## 环境变量

- `DISABLE_THOUGHT_LOGGING`: 设置为 `true` 以禁用控制台日志（默认：`false`）

## 构建

### NPM

```bash
npm install
npm run build
```

### Docker

```bash
docker build -t jochenyang/interleaved-thinking -f Dockerfile .
```

## 使用示例

### 简单模式（自动阶段检测）

```typescript
// 步骤 1: 纯思考（phase 自动推断为 'thinking'）
{
  "thought": "我需要逐步分析这个问题",
  "stepNumber": 1,
  "totalSteps": 5,
  "nextStepNeeded": true
}

// 步骤 2: 工具调用（因为提供了 toolCall，phase 自动推断为 'tool_call'）
{
  "thought": "现在我需要获取一些数据",
  "stepNumber": 2,
  "totalSteps": 5,
  "nextStepNeeded": true,
  "toolCall": {
    "toolName": "fetch_data",
    "parameters": {
      "query": "示例"
    }
  }
}

// 步骤 3: 分析（因为上一步是 tool_call，phase 自动推断为 'analysis'）
{
  "thought": "根据工具结果，我现在可以得出结论...",
  "stepNumber": 3,
  "totalSteps": 5,
  "nextStepNeeded": false
}
```

### 高级模式（显式阶段控制）

```typescript
// 您仍然可以显式指定 phase 以进行精细控制
{
  "thought": "我想显式控制阶段",
  "stepNumber": 1,
  "totalSteps": 3,
  "nextStepNeeded": true,
  "phase": "thinking"  // 显式设置 phase
}
```

## 许可证

此 MCP 服务器采用 MIT 许可证。详见 LICENSE 文件。
