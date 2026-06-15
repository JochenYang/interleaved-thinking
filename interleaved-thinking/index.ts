#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { InterleavedThinkingServer } from "./lib.js";

const server = new McpServer({
  name: "interleaved-thinking",
  version: "0.5.0",
});

const thinkingServer = new InterleavedThinkingServer();

server.registerTool(
  "interleaved-thinking",
  {
    title: "Interleaved Sequential Thinking",
    description: `Interleaved sequential thinking tool that interleaves reasoning with tool execution to solve multi-step problems.

When to use: plan, verify, hypothesize, branch, revise, integrate-tools, reflect, reason-about-evidence, decide, course-correct.

Key features:
- Revision support: revise any earlier step via isRevision + revisesStep
- Branching: explore alternative hypotheses in parallel via branchFromStep + branchId
- Automatic phase inference: thinking / tool_call / analysis cycle is auto-detected from input shape
- Host-delegated execution: this server only registers tool calls; the MCP host actually invokes them and feeds results back via previousToolResult
- Quality signals: each response carries convergence / evidence-coverage / hypothesis-coherence scores so the model can self-monitor
- Anti-idle-loop guidance: nextHint flags dead-end patterns (2+ thinking steps without tool call, 3+ revisions of the same step, missing analysis after tool call, budget exhaustion)

Workflow: thinking → tool_call → analysis → repeat until nextStepNeeded=false. Each call appends to an in-memory history; pass the same stepNumber sequence to keep state coherent.

You should:
1. Start each step by stating a falsifiable hypothesis and how you will verify it before jumping to tools.
2. Use phase=thinking to reason, phase=tool_call to register a tool, phase=analysis to interpret a previousToolResult.
3. Pass the host's actual tool result back in previousToolResult on the next analysis call — do not synthesize results yourself.
4. Cite concrete values from toolResult (e.g., "result.count = 42") instead of generic "based on the result".
5. Use isRevision + revisesStep to correct earlier reasoning rather than silently ignoring it; after 3+ revisions of the same step, branch into an alternative hypothesis instead.
6. Use branchFromStep + branchId to explore parallel hypotheses; branches live alongside the main flow and can be merged in later analysis.
7. Keep toolCall.parameters specific and concrete — empty or vague queries waste the host's tool budget.
8. Treat nextHint as a system-level nudge; convergence / evidenceCoverage / hypothesisCoherence < 0.3 means you have not yet integrated enough evidence.
9. If a tool call fails, retry with adjusted parameters or switch tools — do not give up on nextStepNeeded after one failure.
10. Only set nextStepNeeded=false when truly satisfied with the integrated answer; do not stop after a single tool failure.`,
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
        .describe(
          "Tool call information (required when phase='tool_call'). This server registers tool calls but does not execute them. The MCP host is responsible for execution; the result should be passed back via the next call's previousToolResult field."
        ),
      previousToolResult: z
        .object({
          toolName: z.string(),
          success: z.boolean(),
          status: z.enum(["pending", "executed", "error"]).optional(),
          executionTime: z.number(),
          timestamp: z.string(),
          result: z.unknown().optional(),
          error: z
            .object({
              type: z.string(),
              message: z.string(),
              recoveryStrategy: z.string().optional(),
            })
            .optional(),
        })
        .optional()
        .describe(
          "Pass back the result of the previously registered tool call after the MCP host has executed it. Use this on the analysis phase (or any later call) to feed the real payload into the reasoning loop. Omit on a fresh tool_call phase."
        ),
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
          status: z.enum(["pending", "executed", "error"]).optional(),
          toolName: z.string().optional(),
          success: z.boolean(),
          executionTime: z.number(),
          timestamp: z.string().optional(),
          result: z.unknown().optional(),
          error: z
            .object({
              type: z.string(),
              message: z.string(),
              recoveryStrategy: z.string().optional(),
            })
            .optional(),
        })
        .optional()
        .describe(
          "Tool execution result. When status='pending', the host is responsible for executing the tool and passing the real result back via the next call's previousToolResult field. When status='executed' (or undefined), result carries the actual payload."
        ),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
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

// --- MCP Resources (Sprint 2 B-4) -----------------------------------------
// Expose the in-memory history and branch list as MCP resources so any
// MCP-aware client can read them via resources/read without re-running
// processStep. The handlers read the live StateManager snapshot on each
// read, so the resource is always fresh within a single session.
const HISTORY_URI = "interleaved://history/current";
const BRANCHES_URI = "interleaved://branches/list";

server.registerResource(
  "interleaved-history",
  HISTORY_URI,
  {
    title: "Interleaved Thinking History",
    description:
      "Current session history: every step (thought + phase + toolCall + toolResult), branches, and aggregate statistics. Read via resources/read.",
    mimeType: "application/json",
  },
  async () => ({
    contents: [
      {
        uri: HISTORY_URI,
        mimeType: "application/json",
        text: JSON.stringify(thinkingServer.getHistory(), null, 2),
      },
    ],
  })
);

server.registerResource(
  "interleaved-branches",
  BRANCHES_URI,
  {
    title: "Interleaved Thinking Branches",
    description:
      "List of active branch IDs and the steps recorded under each branch. Read via resources/read.",
    mimeType: "application/json",
  },
  async () => {
    const branches = thinkingServer.getHistory().branches;
    const summary = Object.fromEntries(
      Object.entries(branches).map(([id, steps]) => [
        id,
        {
          stepCount: steps.length,
          stepNumbers: steps.map((s) => s.stepNumber),
        },
      ])
    );
    return {
      contents: [
        {
          uri: BRANCHES_URI,
          mimeType: "application/json",
          text: JSON.stringify(summary, null, 2),
        },
      ],
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
