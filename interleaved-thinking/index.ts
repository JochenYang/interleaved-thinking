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
    description: `A powerful tool for dynamic problem-solving through structured thinking and tool execution.
This tool helps analyze complex problems through a flexible process that combines reasoning with action.
Each step can include pure thinking, tool execution, or result analysis as understanding deepens.

When to use this tool:
- Breaking down complex problems that require multiple steps
- Tasks that need external information or tool execution during reasoning
- Problems where strategy needs adjustment based on intermediate results
- Analysis that requires verification through tool calls
- Debugging and exploration tasks
- Problems where the full scope is not clear initially
- Situations requiring iterative "think-execute-reflect" cycles

Key features:
- Flexible three-phase cycle: thinking, tool execution, and analysis
- Can work as pure sequential thinking (no tools) or interleaved mode (with tools)
- Dynamic strategy adjustment based on execution results
- Branch exploration for alternative approaches
- Revision support for correcting previous reasoning
- Complete history tracking of thoughts and tool calls
- Automatic mode selection based on your needs

How it works:
- Use phase='thinking' for pure reasoning steps (like sequential thinking)
- Use phase='tool_call' when you need to execute external tools
- Use phase='analysis' to process and reflect on tool results
- The tool adapts automatically - pure thinking or thinking+tools as needed

Parameters explained:
- thought: Your current thinking content for this step
- stepNumber: Current step number (starts from 1, can exceed totalSteps)
- totalSteps: Estimated total steps needed (can be adjusted dynamically)
- nextStepNeeded: Whether another step is needed (false to terminate)
- phase: Current phase - 'thinking', 'tool_call', or 'analysis'
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
2. Use phase='thinking' for reasoning (works like sequential thinking)
3. Use phase='tool_call' when you need to execute tools
4. Use phase='analysis' to process tool results
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
        .describe(
          "Current phase: 'thinking' for reasoning, 'tool_call' for tool execution, 'analysis' for result processing"
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
          z
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
                  retryCount: z
                    .number()
                    .optional()
                    .describe("Number of retries"),
                  priority: z
                    .enum(["high", "normal", "low"])
                    .optional()
                    .describe("Execution priority"),
                })
                .optional()
                .describe("Optional metadata"),
            })
            .optional()
        )
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
