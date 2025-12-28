# Interleaved Sequential Thinking MCP Server

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
- **Test Support**: Mock tool results for testing without real tool execution

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

- `DISABLE_THOUGHT_LOGGING`: Set to `true` to disable console logging (default: `false`)

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
