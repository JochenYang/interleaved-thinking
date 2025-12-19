#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { InterleavedThinkingServer } from "./lib.js";

const server = new McpServer({
  name: "interleaved-thinking",
  version: "0.1.0",
});

const thinkingServer = new InterleavedThinkingServer();

server.registerTool(
  "interleavedthinking",
  {
    title: "Interleaved Sequential Thinking",
    description: `A unified tool supporting both sequential thinking and interleaved thinking modes.
This tool adapts to your needs - use it for pure reasoning or combine thinking with tool execution.

DUAL MODE SUPPORT:
1. Sequential Mode (Pure Thinking):
   - Use phase='thinking' throughout without toolCall
   - Perfect for: planning, design, analysis, problem decomposition
   - Like traditional sequential thinking but with revision and branching support

2. Interleaved Mode (Thinking + Tools):
   - Alternate between phase='thinking', 'tool_call', and 'analysis'
   - Perfect for: debugging, exploration, tasks requiring external information
   - Enables dynamic strategy adjustment based on tool results

When to use this tool:
- Breaking down complex problems that require multiple steps
- Pure reasoning tasks (planning, design, analysis)
- Tasks that need external information during the reasoning process
- Problems where strategy needs to be adjusted based on intermediate results
- Situations where the full scope is not clear at the start
- Tasks requiring iterative verification and information gathering
- Problems that benefit from "think-execute-reflect" cycles

Key features:
- Supports both sequential (pure thinking) and interleaved (thinking + tools) modes
- Three distinct phases: thinking, tool_call, and analysis
- Dynamic tool calling with result feedback
- Flexible strategy adjustment based on execution results
- Branch exploration for alternative approaches
- Revision support for correcting previous reasoning
- Complete history tracking of thoughts and tool calls
- Resource limits to prevent infinite loops

Phases explained:
- thinking: Pure reasoning without tool execution. Use this to analyze, plan, or decide next steps.
  * For sequential mode: Use only 'thinking' phase throughout the entire process
  * For interleaved mode: Use 'thinking' between tool calls to plan next actions
- tool_call: Execute external tools to gather information. Specify toolName and parameters.
  * Only use when you need to call external tools (switches to interleaved mode)
- analysis: Analyze tool execution results and decide how to proceed.
  * Use after tool_call to process and reflect on tool outputs

Parameters explained:
- thought: Your current thinking content for this step
- stepNumber: Current step number (starts from 1, can exceed totalSteps)
- totalSteps: Estimated total steps needed (can be adjusted dynamically)
- nextStepNeeded: Whether another step is needed (false to terminate)
- phase: Current phase - must be 'thinking', 'tool_call', or 'analysis'
- toolCall: Tool information (required when phase='tool_call')
  * toolName: Name of the tool to execute
  * parameters: Tool parameters as key-value pairs
  * metadata: Optional timeout, retryCount, priority
- isRevision: Whether this step revises previous reasoning
- revisesStep: Which step number is being reconsidered
- branchFromStep: Branching point step number for exploring alternatives
- branchId: Unique identifier for the branch
- needsMoreSteps: Set true if you realize more steps are needed

You should:
1. Start with an initial estimate of totalSteps
2. Choose your mode:
   - Sequential: Use only phase='thinking' for pure reasoning tasks
   - Interleaved: Use phase='thinking', 'tool_call', 'analysis' when tools are needed
3. Use 'thinking' phase to analyze and plan
4. Use 'tool_call' phase when you need external information (switches to interleaved mode)
5. Use 'analysis' phase to process tool results
6. Adjust totalSteps dynamically if needed
7. Create branches to explore multiple possibilities
8. Mark revisions when correcting previous reasoning
9. Set nextStepNeeded=false when the task is complete
10. Handle tool failures gracefully and adjust strategy
11. Keep track of the cycle: 
    - Sequential: think → think → think → complete
    - Interleaved: think → call → analyze → think → call → analyze → complete`,
    inputSchema: {
      thought: z.string().describe("Your current thinking content"),
      stepNumber: z
        .number()
        .int()
        .min(1)
        .describe("Current step number (e.g., 1, 2, 3)"),
      totalSteps: z
        .number()
        .int()
        .min(1)
        .describe("Estimated total steps needed (e.g., 5, 10)"),
      nextStepNeeded: z.boolean().describe("Whether another step is needed"),
      phase: z
        .union([
          z.literal("thinking"),
          z.literal("tool_call"),
          z.literal("analysis"),
        ])
        .describe(
          "Current phase: 'thinking' for reasoning, 'tool_call' for tool execution, 'analysis' for result processing"
        ),
      toolCall: z
        .object({
          toolName: z.string().describe("Name of the tool to call"),
          parameters: z
            .record(z.string(), z.any())
            .describe("Tool parameters as key-value pairs"),
          metadata: z
            .object({
              timeout: z
                .number()
                .optional()
                .describe("Timeout in milliseconds"),
              retryCount: z.number().optional().describe("Number of retries"),
              priority: z
                .enum(["high", "normal", "low"])
                .optional()
                .describe("Execution priority"),
            })
            .optional()
            .describe("Optional metadata"),
        })
        .optional()
        .describe("Tool call information (required when phase='tool_call')"),
      isRevision: z
        .boolean()
        .optional()
        .describe("Whether this revises previous reasoning"),
      revisesStep: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Which step is being reconsidered"),
      branchFromStep: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Branching point step number"),
      branchId: z.string().optional().describe("Branch identifier"),
      needsMoreSteps: z
        .boolean()
        .optional()
        .describe("If more steps are needed"),
    },
    outputSchema: {
      stepNumber: z.number(),
      totalSteps: z.number(),
      nextStepNeeded: z.boolean(),
      branches: z.array(z.string()),
      stepHistoryLength: z.number(),
      phase: z.string(),
      toolResult: z
        .object({
          success: z.boolean(),
          executionTime: z.number(),
        })
        .optional(),
    },
  },
  async (args) => {
    const result = await thinkingServer.processStep(args);

    // Parse the JSON response to get structured content
    const parsedContent = JSON.parse(result.content[0].text);

    if (result.isError) {
      return {
        content: result.content,
        structuredContent: parsedContent,
      };
    }

    return {
      content: result.content,
      structuredContent: parsedContent,
    };
  }
);

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Interleaved Sequential Thinking MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
