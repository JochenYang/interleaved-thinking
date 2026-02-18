#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { InterleavedThinkingServer } from "./lib.js";

const server = new McpServer({
  name: "interleaved-thinking",
  version: "0.4.0",
});

const thinkingServer = new InterleavedThinkingServer();

server.registerTool(
  "interleaved-thinking",
  {
    title: "Interleaved Sequential Thinking",
    description: `Interleaved sequential thinking tool for structured problem analysis.

Use cases: analyze complex problems, generate and verify hypotheses, need tool assistance (e.g., read files/execute commands), reflect on results and adjust strategy.

Workflow: thinking → tool_call → analysis → repeat until complete. Generate hypotheses, verify them through tools, revise based on results.`,
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
      stepNumber: z.number().describe("Current step number"),
      totalSteps: z.number().describe("Estimated total steps"),
      nextStepNeeded: z.boolean().describe("Whether another step is needed"),
      phase: z.enum(["thinking", "tool_call", "analysis"]).describe("Current phase"),
      nextHint: z.string().describe("Next step guidance for the model"),
      branches: z.array(z.string()).describe("Active branch IDs"),
      stepHistoryLength: z.number().describe("Total steps processed"),
      toolResult: z
        .object({
          success: z.boolean(),
          executionTime: z.number(),
        })
        .optional()
        .describe("Tool execution result (when phase=tool_call)"),
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
