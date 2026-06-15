# Interleaved Sequential Thinking MCP Server

[![npm version](https://img.shields.io/npm/v/@jochenyang/interleaved-thinking)](https://www.npmjs.com/package/@jochenyang/interleaved-thinking)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP Version](https://img.shields.io/badge/MCP-2025--11--25-brightgreen)](https://modelcontextprotocol.io)

[English](./README.md) | [中文](./README_CN.md)

---

An MCP server implementation that enables AI to perform interleaved sequential thinking with dynamic tool calling. This server allows AI to alternate between reasoning, tool execution, and result analysis in a flexible "think-execute-reflect" cycle.

### Features

- **Three-Phase Interleaved Execution**: Seamlessly switch between thinking, tool calling, and analysis phases
- **Dynamic Tool Calling**: Execute external tools during the reasoning process and adjust strategy based on results
- **Context Continuity**: Maintain complete context across the entire interleaved cycle
- **Flexible Strategy Adjustment**: Support for revisions, branching, and dynamic step count adjustment
- **Complete History Tracking**: Record all thinking steps and tool calls with detailed information
- **Resource Control**: Built-in limits for tool calls and timeout control to prevent infinite loops
- **Host-Delegated Execution**: The server registers tool calls and tracks the interleaving flow; the MCP host is responsible for actually executing tools and passing the result back via `previousToolResult`

### Use Cases

This tool is designed for:
- Breaking down complex problems that require multiple steps
- Tasks that need external information during the reasoning process
- Problems where strategy needs to be adjusted based on intermediate results
- Situations where the full scope is not clear at the start
- Tasks requiring iterative verification and information gathering
- Problems that benefit from "think-execute-reflect" cycles

### Tool

#### interleaved-thinking

Facilitates interleaved sequential thinking with dynamic tool calling.

**Core Parameters:**
- `thought` (string): Your current thinking content
- `stepNumber` (integer): Current step number (starts from 1)
- `totalSteps` (integer): Estimated total steps needed
- `nextStepNeeded` (boolean): Whether another step is needed
- `phase` (enum): Current phase - 'thinking', 'tool_call', or 'analysis'

**Tool Call Parameters (when phase='tool_call'):**
- `toolCall` (object):
  - `toolName` (string): Name of the tool to execute
  - `parameters` (object): Tool parameters as key-value pairs
  - `metadata` (object, optional): timeout, retryCount, priority

**Optional Parameters:**
- `isRevision` (boolean): Whether this revises previous reasoning
- `revisesStep` (integer): Which step is being reconsidered
- `branchFromStep` (integer): Branching point step number
- `branchId` (string): Branch identifier
- `needsMoreSteps` (boolean): If more steps are needed

### When NOT to use this tool

Skip `interleaved-thinking` for:
- Single-step questions, pure translations, or lookups where the answer is known up front
- Tasks that already have a dedicated MCP tool that gets there in one call
- Mechanical edits where there is zero exploration space
- Pure chat that does not need any tool at all

In these cases, calling this tool adds latency and noise without improving the answer.

### Configuration

#### Usage with Claude Code CLI

Add this to your Claude Code CLI MCP settings:

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

#### Usage with Cursor

Add this to your Cursor MCP settings:

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

#### Usage with Kiro

Add this to your Kiro MCP configuration:

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

#### Usage with VS Code

For manual installation, add the configuration to `.vscode/mcp.json` in your workspace:

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

#### Docker

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

### Environment Variables

- `DISABLE_THOUGHT_LOGGING`: Set to `true` to disable console logging (default: `false`). Read at server startup; takes effect on the next `InterleavedThinkingServer` instance construction.

### How Tool Execution Works

This server is a **flow controller**, not a tool executor. It registers tool calls and tracks the interleaved think→tool_call→analysis loop, but it does NOT actually invoke external tools.

**Round-trip protocol:**

1. **tool_call phase** — your model supplies a `toolCall` (tool name + parameters). The server records the registration and responds with `toolResult.status === "pending"`. The tool itself is NOT executed by the server.
2. **Host dispatches** — the MCP host (Claude/Cursor/etc.) takes the registered `toolCall`, invokes the actual tool on the appropriate provider, and obtains the real `result`.
3. **analysis phase** — the host calls this tool again, now with `phase: "analysis"` and a `previousToolResult` field carrying the real payload. The server attaches the result to the in-memory history and exposes it to your model for reflection.

The `previousToolResult` field carries the standard tool-result shape: `toolName`, `success`, `executionTime`, `timestamp`, optional `result`, optional `error` (with `type`, `message`, `recoveryStrategy`).

This design keeps the reasoning loop and tool execution cleanly separated, so the same thinking flow can drive any tool provider the host supports.

### Building

#### NPM

```bash
npm install
npm run build
```

#### Docker

```bash
docker build -t jochenyang/interleaved-thinking -f Dockerfile .
```

### Example Usage

```typescript
// Phase 1: Thinking
{
  "thought": "I need to analyze this problem step by step",
  "stepNumber": 1,
  "totalSteps": 5,
  "nextStepNeeded": true,
  "phase": "thinking"
}

// Phase 2: Tool Call
{
  "thought": "Now I need to fetch some data",
  "stepNumber": 2,
  "totalSteps": 5,
  "nextStepNeeded": true,
  "phase": "tool_call",
  "toolCall": {
    "toolName": "fetch_data",
    "parameters": {
      "query": "example"
    }
  }
}

// Phase 3: Analysis
{
  "thought": "Based on the tool results, I can now conclude...",
  "stepNumber": 3,
  "totalSteps": 5,
  "nextStepNeeded": false,
  "phase": "analysis"
}
```

### License

This MCP server is licensed under the MIT License. See the LICENSE file for details.
