#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { InterleavedThinkingServer } from "./lib.js";

const server = new McpServer({
  name: "interleaved-thinking",
  version: "0.3.1",
});

const thinkingServer = new InterleavedThinkingServer();

server.registerTool(
  "interleaved-thinking",
  {
    title: "Interleaved Sequential Thinking",
    description: `A dynamic and reflective problem-solving tool that combines structured thinking with tool execution.
This tool helps analyze complex problems through a flexible thinking process that adapts and evolves as understanding deepens.
Each step can include pure reasoning, tool calls, or result analysis, creating an iterative "think-execute-reflect" cycle.

When to use this tool:
- Breaking down complex problems that require external information
- Planning and design with room for strategy adjustment based on results
- Analysis that needs verification through tool execution
- Problems where the full scope might not be clear initially
- Tasks requiring multiple tool calls with dynamic information gathering
- Situations where irrelevant information needs to be filtered out
- Debugging and exploration with iterative refinement

Key features:
- Automatic phase detection without manual specification
- Flexible workflow: pure sequential thinking OR interleaved with tools
- Dynamic strategy adjustment based on execution results
- Question or revise previous thoughts as understanding evolves
- Branch exploration for alternative approaches
- Complete history tracking of thoughts and tool executions

Parameters explained:
- thought: Your current reasoning step, which can include:
  * Regular analytical steps
  * Revisions of previous reasoning
  * Questions about previous decisions
  * Realizations about needing more analysis
  * Changes in approach
  * Hypothesis generation and verification
- nextStepNeeded: True if you need more thinking, even if at what seemed like the end
- stepNumber: Current number in sequence (can go beyond initial total if needed)
- totalSteps: Current estimate of steps needed (can be adjusted up/down)
- isRevision: A boolean indicating if this step revises previous thinking
- revisesStep: If isRevision is true, which step number is being reconsidered
- branchFromStep: If branching, which step number is the branching point
- branchId: Identifier for the current branch (if any)
- needsMoreSteps: If reaching end but realizing more steps needed
- toolCall: Tool execution information (auto-inferred when provided)
- phase: Optional phase specification (auto-inferred if omitted)

You should:
1. Start with an initial estimate of needed steps, but be ready to adjust
2. Feel free to question or revise previous reasoning
3. Don't hesitate to add more steps if needed, even at the "end"
4. Express uncertainty when present
5. Mark steps that revise previous thinking or branch into new paths
6. Ignore information that is irrelevant to the current step
7. Generate solution hypotheses when appropriate
8. Verify hypotheses through tool execution when needed
9. Repeat the process until satisfied with the solution
10. Set nextStepNeeded to false when truly done and satisfactory answer is reached`,
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
