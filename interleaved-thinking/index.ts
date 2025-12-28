#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { InterleavedThinkingServer } from "./lib.js";

const server = new McpServer({
  name: "interleaved-thinking",
  version: "0.3.0",
});

const thinkingServer = new InterleavedThinkingServer();

server.registerTool(
  "interleaved-thinking",
  {
    title: "Interleaved Sequential Thinking",
    description: `A powerful tool for dynamic problem-solving through structured thinking and tool execution.
This tool helps analyze complex problems through a flexible process that combines reasoning with action.
Each step can include pure thinking, tool execution, or result analysis as understanding deepens.

When to use this tool:
RECOMMENDED for:
- Tasks that need external information or tool execution during reasoning
- Problems where strategy needs adjustment based on intermediate results
- Situations requiring iterative "think-execute-reflect" cycles
- Analysis that requires verification through tool calls
- Debugging and exploration tasks with dynamic information gathering

NOT RECOMMENDED for:
- Pure logical reasoning without tool calls (use sequential-thinking instead)
- Direct execution of a single tool (call that tool directly)
- Simple linear tasks that don't require iteration

Key features:
- Automatic phase detection: No need to specify phase - it's inferred automatically
- Flexible workflow: Can work as pure sequential thinking or interleaved mode with tools
- Dynamic strategy adjustment: Adapt based on execution results
- Branch exploration: Explore alternative approaches
- Revision support: Correct previous reasoning
- Complete history tracking: Record all thoughts and tool calls

How it works (SIMPLIFIED):
1. Just thinking: Provide thought + step info, automatically enters 'thinking' phase
2. Need a tool: Add toolCall parameter, automatically enters 'tool_call' phase
3. After tool execution: Next step automatically enters 'analysis' phase
4. Advanced control: Optionally specify phase explicitly for fine-grained control

Parameters explained:
- thought: Your current thinking content for this step
- stepNumber: Current step number (starts from 1, can exceed totalSteps)
- totalSteps: Estimated total steps needed (can be adjusted dynamically)
- nextStepNeeded: Whether another step is needed (false to terminate)
- phase (OPTIONAL): Current phase - 'thinking', 'tool_call', or 'analysis'
  * If omitted, phase is automatically inferred based on context
  * Provide toolCall: auto-detected as 'tool_call'
  * After tool_call: auto-detected as 'analysis'
  * Otherwise: defaults to 'thinking'
- toolCall (OPTIONAL): Tool information - when provided, automatically triggers tool execution
  * toolName: Name of the tool to execute
  * parameters: Tool parameters as key-value pairs
  * metadata: Optional timeout, retryCount, priority
- isRevision (OPTIONAL): Whether this step revises previous reasoning
- revisesStep (OPTIONAL): Which step number is being reconsidered
- branchFromStep (OPTIONAL): Branching point step number for exploring alternatives
- branchId (OPTIONAL): Unique identifier for the branch
- needsMoreSteps (OPTIONAL): Set true if you realize more steps are needed

You should:
1. Start with an initial estimate of totalSteps
2. For pure thinking: Just provide thought + step info (phase auto-inferred)
3. For tool execution: Add toolCall parameter (phase auto-inferred)
4. For explicit control: Optionally specify phase parameter
5. Adjust totalSteps dynamically if needed
6. Create branches to explore multiple possibilities
7. Mark revisions when correcting previous reasoning
8. Set nextStepNeeded=false when the task is complete
9. Handle tool failures gracefully and adjust strategy`,
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
        .optional()
        .describe(
          "OPTIONAL: Current phase - auto-inferred if not provided. 'thinking' for reasoning, 'tool_call' for tool execution, 'analysis' for result processing. If omitted: toolCall present → 'tool_call', after tool_call → 'analysis', otherwise → 'thinking'"
        ),
      toolCall: z
        .preprocess(
          (val) => {
            // If toolCall is a string, try to parse it as JSON
            if (typeof val === "string") {
              try {
                return JSON.parse(val);
              } catch {
                // If parsing fails, return as-is and let validation handle it
                return val;
              }
            }
            // If it's an object, check nested fields
            if (val && typeof val === "object") {
              const obj: any = { ...val };
              // Parse parameters if it's a string
              if (typeof obj.parameters === "string") {
                try {
                  obj.parameters = JSON.parse(obj.parameters);
                } catch {
                  // Keep as-is
                }
              }
              // Parse metadata if it's a string
              if (typeof obj.metadata === "string") {
                try {
                  obj.metadata = JSON.parse(obj.metadata);
                } catch {
                  // Keep as-is
                }
              }
              return obj;
            }
            return val;
          },
          z.object({
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
        )
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
    // Args are already preprocessed by Zod, no need for manual parsing
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
