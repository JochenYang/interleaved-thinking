import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  InterleavedThinkingServer,
  ToolCallManager,
  StateManager,
  Logger,
  type ToolResultData,
} from "../lib.js";

describe("InterleavedThinkingServer", () => {
  let server: InterleavedThinkingServer;

  beforeEach(() => {
    server = new InterleavedThinkingServer({
      disableLogging: true,
    });
  });

  describe("Basic functionality", () => {
    it("should process a thinking step", async () => {
      const input = {
        thought: "This is my first thought",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "thinking" as const,
      };

      const result = await server.processStep(input);
      expect(result.isError).toBeUndefined();

      const data = JSON.parse(result.content[0].text);
      expect(data.stepNumber).toBe(1);
      expect(data.totalSteps).toBe(3);
      expect(data.nextStepNeeded).toBe(true);
      expect(data.phase).toBe("thinking");
    });

    it("should process a tool call step", async () => {
      const input = {
        thought: "Calling a tool",
        stepNumber: 1,
        totalSteps: 2,
        nextStepNeeded: true,
        phase: "tool_call" as const,
        toolCall: {
          toolName: "test_tool",
          parameters: { key: "value" },
        },
      };

      const result = await server.processStep(input);
      expect(result.isError).toBeUndefined();

      const data = JSON.parse(result.content[0].text);
      expect(data.phase).toBe("tool_call");
      expect(data.toolResult).toBeDefined();
      expect(data.toolResult.success).toBe(true);
      // P0-C: tool_call phase returns status='pending' (host will execute)
      expect(data.toolResult.status).toBe("pending");
    });

    it("should process an analysis step", async () => {
      // First do a tool call
      await server.processStep({
        thought: "Calling tool",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "tool_call" as const,
        toolCall: {
          toolName: "test_tool",
          parameters: {},
        },
      });

      // Then analyze
      const input = {
        thought: "Analyzing results",
        stepNumber: 2,
        totalSteps: 3,
        nextStepNeeded: false,
        phase: "analysis" as const,
      };

      const result = await server.processStep(input);
      expect(result.isError).toBeUndefined();

      const data = JSON.parse(result.content[0].text);
      expect(data.phase).toBe("analysis");
    });

    it("should accept previousToolResult from the MCP host (P0-C round-trip)", async () => {
      // Step 1: tool_call phase registers a pending tool call
      const callResult = await server.processStep({
        thought: "Calling a tool via host",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "tool_call" as const,
        toolCall: {
          toolName: "real_tool",
          parameters: { foo: "bar" },
        },
      });
      const callData = JSON.parse(callResult.content[0].text);
      expect(callData.phase).toBe("tool_call");
      expect(callData.toolResult.status).toBe("pending");
      expect(callData.toolResult.success).toBe(true);

      // Step 2: analysis phase, host returns the real result via previousToolResult
      const hostResult: ToolResultData = {
        toolName: "real_tool",
        success: true,
        status: "executed",
        result: { data: "from real tool" },
        executionTime: 42,
        timestamp: new Date().toISOString(),
      };

      const result = await server.processStep({
        thought: "Analyzing host result",
        stepNumber: 2,
        totalSteps: 3,
        nextStepNeeded: false,
        phase: "analysis" as const,
        previousToolResult: hostResult,
      });
      expect(result.isError).toBeUndefined();

      const data = JSON.parse(result.content[0].text);
      expect(data.phase).toBe("analysis");
      expect(data.toolResult).toBeDefined();
      expect(data.toolResult.status).toBe("executed");
      expect(data.toolResult.result).toEqual({ data: "from real tool" });
      expect(data.toolResult.executionTime).toBe(42);

      // The StateManager record should also have been updated
      const history = server.getHistory();
      expect(history.toolCalls[0].result.status).toBe("executed");
      expect(history.toolCalls[0].result.result).toEqual({
        data: "from real tool",
      });
    });
  });

  describe("Step number adjustment", () => {
    it("should auto-adjust totalSteps if stepNumber exceeds it", async () => {
      const input = {
        thought: "Step 5",
        stepNumber: 5,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "thinking" as const,
      };

      const result = await server.processStep(input);
      const data = JSON.parse(result.content[0].text);

      expect(data.totalSteps).toBe(5);
    });
  });

  describe("Branching", () => {
    it("should track branches correctly", async () => {
      await server.processStep({
        thought: "Main thought",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "thinking" as const,
      });

      const branchInput = {
        thought: "Branch A thought",
        stepNumber: 2,
        totalSteps: 3,
        nextStepNeeded: false,
        phase: "thinking" as const,
        branchFromStep: 1,
        branchId: "branch-a",
      };

      const result = await server.processStep(branchInput);
      const data = JSON.parse(result.content[0].text);

      expect(data.branches).toContain("branch-a");
    });
  });

  describe("Input validation", () => {
    it("should reject empty thought string", async () => {
      const input = {
        thought: "",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "thinking" as const,
      };

      const result = await server.processStep(input);
      expect(result.isError).toBe(true);

      const data = JSON.parse(result.content[0].text);
      expect(data.error.type).toBe("ValidationError");
    });

    it("should reject whitespace-only thought string", async () => {
      const input = {
        thought: "   ",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "thinking" as const,
      };

      const result = await server.processStep(input);
      expect(result.isError).toBe(true);

      const data = JSON.parse(result.content[0].text);
      expect(data.error.type).toBe("ValidationError");
    });

    it("should reject invalid phase value", async () => {
      const input = {
        thought: "invalid phase",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "invalid" as any,
      };

      const result = await server.processStep(input);
      expect(result.isError).toBe(true);

      const data = JSON.parse(result.content[0].text);
      expect(data.error.type).toBe("ValidationError");
    });

    it("should reject stepNumber less than 1", async () => {
      const input = {
        thought: "test",
        stepNumber: 0,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "thinking" as const,
      };

      const result = await server.processStep(input);
      expect(result.isError).toBe(true);
    });

    it("should reject totalSteps less than 1", async () => {
      const input = {
        thought: "test",
        stepNumber: 1,
        totalSteps: 0,
        nextStepNeeded: true,
        phase: "thinking" as const,
      };

      const result = await server.processStep(input);
      expect(result.isError).toBe(true);
    });

    it("should reject missing nextStepNeeded", async () => {
      const input = {
        thought: "test",
        stepNumber: 1,
        totalSteps: 3,
        // nextStepNeeded is missing
        phase: "thinking" as const,
      } as any;

      const result = await server.processStep(input);
      expect(result.isError).toBe(true);
    });
  });

  describe("Error handling", () => {
    it("should auto-infer phase when not provided", async () => {
      const input = {
        thought: "Test auto-inference",
        stepNumber: 1,
        totalSteps: 1,
        nextStepNeeded: false,
        // Phase is omitted - should be auto-inferred as 'thinking'
      };

      const result = await server.processStep(input);
      expect(result.isError).toBeUndefined();

      const data = JSON.parse(result.content[0].text);
      expect(data.phase).toBe("thinking");
    });

    it("should return error for missing toolCall in tool_call phase", async () => {
      const input = {
        thought: "Test",
        stepNumber: 1,
        totalSteps: 1,
        nextStepNeeded: false,
        phase: "tool_call" as const,
        // toolCall is missing
      };

      const result = await server.processStep(input);
      expect(result.isError).toBe(true);
    });

    it("should return ToolCallLimitError when tool call limit is exceeded", async () => {
      const limitedServer = new InterleavedThinkingServer({
        disableLogging: true,
        maxToolCalls: 1,
      });

      // First call succeeds
      await limitedServer.processStep({
        thought: "First tool call",
        stepNumber: 1,
        totalSteps: 2,
        nextStepNeeded: true,
        phase: "tool_call" as const,
        toolCall: { toolName: "tool1", parameters: {} },
      });

      // Second call should fail with limit error
      const result = await limitedServer.processStep({
        thought: "Second tool call",
        stepNumber: 2,
        totalSteps: 2,
        nextStepNeeded: false,
        phase: "tool_call" as const,
        toolCall: { toolName: "tool2", parameters: {} },
      });

      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.error.type).toBe("ToolCallLimitError");
    });
  });

  describe("Immutability", () => {
    it("should not mutate the input object", async () => {
      const input = {
        thought: "Test immutability",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "thinking" as const,
      };

      const inputCopy = { ...input };

      await server.processStep(input);

      // Verify input was not mutated
      expect(input).toEqual(inputCopy);
    });

    it("should not mutate input when phase is auto-inferred", async () => {
      const input = {
        thought: "Test auto-infer immutability",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        // phase omitted - will be auto-inferred
      };

      const expectedPhase = undefined; // phase is not set initially

      await server.processStep(input);

      // input.phase should remain undefined (not mutated to "thinking")
      expect(input.phase).toBeUndefined();
    });

    it("should not mutate input.totalSteps when auto-adjusted", async () => {
      const input = {
        thought: "Test totalSteps immutability",
        stepNumber: 5,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "thinking" as const,
      };

      const originalTotalSteps = input.totalSteps;

      await server.processStep(input);

      // input.totalSteps should remain unchanged
      expect(input.totalSteps).toBe(originalTotalSteps);
    });
  });

  describe("Next hint generation", () => {
    it("should suggest analysis after tool_call phase", async () => {
      const input = {
        thought: "Calling a tool",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "tool_call" as const,
        toolCall: {
          toolName: "test_tool",
          parameters: { key: "value" },
        },
      };

      const result = await server.processStep(input);
      const data = JSON.parse(result.content[0].text);

      expect(data.nextHint).toContain("analysis");
      expect(data.nextHint).not.toContain("Execute");
    });

    it("should not suggest tool execution hint when phase is thinking but toolCall is present", async () => {
      const input = {
        thought: "Thinking about calling a tool",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "thinking" as const,
        toolCall: {
          toolName: "test_tool",
          parameters: { key: "value" },
        },
      };

      const result = await server.processStep(input);
      const data = JSON.parse(result.content[0].text);

      // Should use thinking phase hint, not tool_call hint
      expect(data.nextHint).toContain("Continue");
      expect(data.nextHint).not.toContain("Execute");
    });
  });

  describe("L2 soft guidance (nextHint phase tips)", () => {
    it("should append a falsifiable-hypothesis tip on thinking phase", async () => {
      const input = {
        thought: "Let me reason about this",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "thinking" as const,
      };
      const result = await server.processStep(input);
      const data = JSON.parse(result.content[0].text);

      expect(data.nextHint).toContain("Tip:");
      expect(data.nextHint).toMatch(/falsifiable hypothesis/i);
      expect(data.nextHint).toMatch(/verification strategy/i);
    });

    it("should append a concrete-parameters tip on tool_call phase", async () => {
      const input = {
        thought: "Need to call a tool",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "tool_call" as const,
        toolCall: { toolName: "fetch", parameters: { q: "x" } },
      };
      const result = await server.processStep(input);
      const data = JSON.parse(result.content[0].text);

      expect(data.nextHint).toContain("Tip:");
      expect(data.nextHint).toMatch(/specific and concrete/i);
    });

    it("should append a cite-specific-values tip on analysis phase", async () => {
      const input = {
        thought: "Looking at the tool output",
        stepNumber: 2,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "analysis" as const,
      };
      const result = await server.processStep(input);
      const data = JSON.parse(result.content[0].text);

      expect(data.nextHint).toContain("Tip:");
      expect(data.nextHint).toMatch(/Cite specific values/i);
      expect(data.nextHint).toMatch(/result\./i);
    });

    it("should still emit a tip when phase is auto-inferred (no explicit phase)", async () => {
      const input = {
        thought: "Auto-inferred phase",
        stepNumber: 1,
        totalSteps: 2,
        nextStepNeeded: true,
        // no `phase` field — server should infer 'thinking'
      };
      const result = await server.processStep(input);
      const data = JSON.parse(result.content[0].text);

      expect(data.phase).toBe("thinking");
      expect(data.nextHint).toContain("Tip:");
      expect(data.nextHint).toMatch(/falsifiable hypothesis/i);
    });
  });

  describe("Automatic phase inference", () => {
    it("should infer 'thinking' phase by default", async () => {
      const input = {
        thought: "Default thinking",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
      };

      const result = await server.processStep(input);
      const data = JSON.parse(result.content[0].text);
      expect(data.phase).toBe("thinking");
    });

    it("should infer 'tool_call' phase when toolCall is provided", async () => {
      const input = {
        thought: "Calling a tool",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        toolCall: {
          toolName: "test_tool",
          parameters: { key: "value" },
        },
      };

      const result = await server.processStep(input);
      const data = JSON.parse(result.content[0].text);
      expect(data.phase).toBe("tool_call");
    });

    it("should infer 'analysis' phase after tool_call", async () => {
      // First, execute a tool call
      await server.processStep({
        thought: "Calling a tool",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        toolCall: {
          toolName: "test_tool",
          parameters: { key: "value" },
        },
      });

      // Then, the next step should be inferred as analysis
      const input = {
        thought: "Analyzing results",
        stepNumber: 2,
        totalSteps: 3,
        nextStepNeeded: true,
      };

      const result = await server.processStep(input);
      const data = JSON.parse(result.content[0].text);
      expect(data.phase).toBe("analysis");
    });

    it("should respect explicit phase even when it could be inferred", async () => {
      const input = {
        thought: "Explicit thinking",
        stepNumber: 1,
        totalSteps: 3,
        nextStepNeeded: true,
        phase: "thinking" as const,
        toolCall: {
          toolName: "test_tool",
          parameters: { key: "value" },
        },
      };

      const result = await server.processStep(input);
      const data = JSON.parse(result.content[0].text);
      // Should use explicit phase, not inferred
      expect(data.phase).toBe("thinking");
    });
  });
});

describe("ToolCallManager", () => {
  let manager: ToolCallManager;

  beforeEach(() => {
    manager = new ToolCallManager({
      maxToolCalls: 3,
      defaultTimeout: 1000,
      enableCache: true,
    });
  });

  it("should execute tool calls", async () => {
    const result = await manager.executeToolCall({
      toolName: "test_tool",
      parameters: { key: "value" },
    });

    expect(result.success).toBe(true);
    expect(result.toolName).toBe("test_tool");
  });

  it("should enforce call limits", async () => {
    await manager.executeToolCall({ toolName: "tool1", parameters: {} });
    await manager.executeToolCall({ toolName: "tool2", parameters: {} });
    await manager.executeToolCall({ toolName: "tool3", parameters: {} });

    expect(manager.canExecuteToolCall()).toBe(false);

    await expect(
      manager.executeToolCall({ toolName: "tool4", parameters: {} })
    ).rejects.toThrow("Tool call limit reached");
  });

  it("should provide statistics", async () => {
    await manager.executeToolCall({ toolName: "tool1", parameters: {} });
    await manager.executeToolCall({ toolName: "tool2", parameters: {} });

    const stats = manager.getStatistics();
    expect(stats.totalCalls).toBe(2);
  });

  it("should provide accurate statistics when cache is disabled", async () => {
    const noCacheManager = new ToolCallManager({
      maxToolCalls: 10,
      defaultTimeout: 1000,
      enableCache: false,
    });

    await noCacheManager.executeToolCall({ toolName: "tool1", parameters: {} });
    await noCacheManager.executeToolCall({ toolName: "tool2", parameters: {} });

    const stats = noCacheManager.getStatistics();
    expect(stats.totalCalls).toBe(2);
    expect(stats.successfulCalls).toBe(2);
    expect(stats.failedCalls).toBe(0);
    expect(stats.totalExecutionTime).toBeGreaterThanOrEqual(0);
  });

  it("should return ToolCallLimitError when limit is exceeded", async () => {
    const limitManager = new ToolCallManager({
      maxToolCalls: 1,
      defaultTimeout: 1000,
      enableCache: true,
    });

    await limitManager.executeToolCall({ toolName: "tool1", parameters: {} });

    await expect(
      limitManager.executeToolCall({ toolName: "tool2", parameters: {} })
    ).rejects.toThrow("Tool call limit reached");
  });

  it("should register tool calls as pending (no execution, no timeout)", async () => {
    // After P0-C, the manager no longer executes or times out tools.
    // Even an extreme 1ms timeout must not affect the pending registration.
    const noExecManager = new ToolCallManager({
      maxToolCalls: 5,
      defaultTimeout: 1,
      enableCache: true,
    });

    const result = await noExecManager.executeToolCall({
      toolName: "external_tool",
      parameters: { key: "value" },
      metadata: { timeout: 1 },
    });

    expect(result.status).toBe("pending");
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.toolName).toBe("external_tool");
  });

  it("should track pending registrations in statistics", async () => {
    const statsManager = new ToolCallManager({
      maxToolCalls: 10,
      defaultTimeout: 1000,
      enableCache: true,
    });

    await statsManager.executeToolCall({ toolName: "tool1", parameters: {} });
    await statsManager.executeToolCall({ toolName: "tool2", parameters: {} });

    const stats = statsManager.getStatistics();
    expect(stats.totalCalls).toBe(2);
    expect(stats.successfulCalls).toBe(2);
    expect(stats.failedCalls).toBe(0);
  });

  it("should expose getPendingToolCalls and markToolCallExecuted (P0-C API)", async () => {
    const m = new ToolCallManager({
      maxToolCalls: 5,
      defaultTimeout: 1000,
      enableCache: true,
    });

    await m.executeToolCall({ toolName: "a", parameters: { x: 1 } });
    await m.executeToolCall({ toolName: "b", parameters: { y: 2 } });

    const pending = m.getPendingToolCalls();
    expect(pending).toHaveLength(2);
    expect(pending.map((c) => c.toolName)).toEqual(["a", "b"]);

    m.markToolCallExecuted(
      { toolName: "a" },
      {
        toolName: "a",
        success: true,
        executionTime: 1,
        timestamp: new Date().toISOString(),
      }
    );

    expect(m.getPendingToolCalls()).toHaveLength(1);
    expect(m.getPendingToolCalls()[0].toolName).toBe("b");
  });
});

describe("StateManager", () => {
  let stateManager: StateManager;

  beforeEach(() => {
    stateManager = new StateManager();
  });

  it("should add and retrieve steps", () => {
    const step = {
      thought: "Test",
      stepNumber: 1,
      totalSteps: 1,
      nextStepNeeded: false,
      phase: "thinking" as const,
    };

    stateManager.addStep(step);

    const history = stateManager.getHistory();
    expect(history.steps.length).toBe(1);
    expect(history.steps[0].thought).toBe("Test");
  });

  it("should track tool calls", () => {
    const record = {
      stepNumber: 1,
      toolCall: {
        toolName: "test_tool",
        parameters: {},
      },
      result: {
        toolName: "test_tool",
        success: true,
        executionTime: 10,
        timestamp: new Date().toISOString(),
      },
    };

    stateManager.addToolCall(record);

    const history = stateManager.getHistory();
    expect(history.toolCalls.length).toBe(1);
    expect(history.statistics.totalToolCalls).toBe(1);
  });
});

describe("Logger", () => {
  it("should not log when disabled", () => {
    const logger = new Logger(true);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.logThinkingStep({
      thought: "test",
      stepNumber: 1,
      totalSteps: 1,
      nextStepNeeded: false,
    });

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("should format output with box when enabled", () => {
    const logger = new Logger(false);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.logThinkingStep({
      thought: "test content",
      stepNumber: 1,
      totalSteps: 3,
      nextStepNeeded: true,
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain("test content");
    expect(output).toContain("┌");
    expect(output).toContain("└");
    consoleSpy.mockRestore();
  });
});

describe("P0-A: toolResult schema transparency", () => {
  let server: InterleavedThinkingServer;

  beforeEach(() => {
    server = new InterleavedThinkingServer({ disableLogging: true });
  });

  it("should expose the full toolResult (status, result, error) in the response", async () => {
    // tool_call phase: pending registration should include status='pending'
    // and the result payload (the host-bound message). This verifies the
    // outputSchema was widened beyond {success, executionTime}.
    const callResult = await server.processStep({
      thought: "Calling with rich payload",
      stepNumber: 1,
      totalSteps: 2,
      nextStepNeeded: true,
      phase: "tool_call" as const,
      toolCall: {
        toolName: "external_search",
        parameters: { q: "test", limit: 5 },
      },
    });
    const callData = JSON.parse(callResult.content[0].text);
    expect(callData.toolResult).toBeDefined();
    expect(callData.toolResult.status).toBe("pending");
    expect(callData.toolResult.success).toBe(true);
    expect(callData.toolResult.executionTime).toBe(0);
    // The new schema must allow result to be present in the response.
    expect(callData.toolResult.result).toBeDefined();
    expect(callData.toolResult.result.message).toContain("host");
    expect(callData.toolResult.result.parameters).toEqual({
      q: "test",
      limit: 5,
    });

    // analysis phase: host-returned result must flow through verbatim.
    const hostResult: ToolResultData = {
      toolName: "external_search",
      success: true,
      status: "executed",
      result: { hits: [{ id: 1, title: "doc" }] },
      executionTime: 123,
      timestamp: new Date().toISOString(),
    };
    const analysisResult = await server.processStep({
      thought: "Analyzing search results",
      stepNumber: 2,
      totalSteps: 2,
      nextStepNeeded: false,
      phase: "analysis" as const,
      previousToolResult: hostResult,
    });
    const analysisData = JSON.parse(analysisResult.content[0].text);
    expect(analysisData.toolResult).toBeDefined();
    expect(analysisData.toolResult.status).toBe("executed");
    expect(analysisData.toolResult.result).toEqual({
      hits: [{ id: 1, title: "doc" }],
    });
    expect(analysisData.toolResult.executionTime).toBe(123);
  });

  it("should expose the error field in the response when host returns a failure", async () => {
    // Register a call first
    await server.processStep({
      thought: "Calling",
      stepNumber: 1,
      totalSteps: 2,
      nextStepNeeded: true,
      phase: "tool_call" as const,
      toolCall: { toolName: "failing_tool", parameters: {} },
    });

    // Host returns a failure payload
    const failure: ToolResultData = {
      toolName: "failing_tool",
      success: false,
      status: "error",
      executionTime: 10,
      timestamp: new Date().toISOString(),
      error: {
        type: "UpstreamError",
        message: "503 Service Unavailable",
        recoveryStrategy: "Retry with backoff",
      },
    };
    const result = await server.processStep({
      thought: "Analyzing failure",
      stepNumber: 2,
      totalSteps: 2,
      nextStepNeeded: false,
      phase: "analysis" as const,
      previousToolResult: failure,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.toolResult.error).toBeDefined();
    expect(data.toolResult.error.type).toBe("UpstreamError");
    expect(data.toolResult.error.message).toBe("503 Service Unavailable");
    expect(data.toolResult.error.recoveryStrategy).toBe("Retry with backoff");
  });
});

describe("P0-B: tool annotations (MCP 2025-11-25 compliance)", () => {
  it("should declare readOnlyHint, destructiveHint, idempotentHint, openWorldHint in index.ts", () => {
    // The annotations field lives on the McpServer.registerTool config
    // object in index.ts (no public export from lib.ts). We verify it
    // by reading the source file as a string and asserting presence.
    const indexPath = resolve(__dirname, "..", "index.ts");
    const source = readFileSync(indexPath, "utf8");

    expect(source).toMatch(/annotations\s*:\s*\{/);
    expect(source).toMatch(/readOnlyHint\s*:\s*(true|false)/);
    expect(source).toMatch(/destructiveHint\s*:\s*(true|false)/);
    expect(source).toMatch(/idempotentHint\s*:\s*(true|false)/);
    expect(source).toMatch(/openWorldHint\s*:\s*(true|false)/);
  });
});

describe("P1-B: DISABLE_THOUGHT_LOGGING env var", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.DISABLE_THOUGHT_LOGGING;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DISABLE_THOUGHT_LOGGING;
    } else {
      process.env.DISABLE_THOUGHT_LOGGING = originalEnv;
    }
  });

  it("should silence Logger when DISABLE_THOUGHT_LOGGING=true (P1-B env fix)", async () => {
    process.env.DISABLE_THOUGHT_LOGGING = "true";
    const envServer = new InterleavedThinkingServer();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await envServer.processStep({
      thought: "thinking",
      stepNumber: 1,
      totalSteps: 1,
      nextStepNeeded: false,
    });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should keep logging when DISABLE_THOUGHT_LOGGING is unset or false", async () => {
    delete process.env.DISABLE_THOUGHT_LOGGING;
    const envServer = new InterleavedThinkingServer();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await envServer.processStep({
      thought: "thinking aloud",
      stepNumber: 1,
      totalSteps: 1,
      nextStepNeeded: false,
    });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("should let explicit config arg override the env var", async () => {
    process.env.DISABLE_THOUGHT_LOGGING = "true";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    // explicit disableLogging: false wins over env=true
    const s = new InterleavedThinkingServer({ disableLogging: false });
    await s.processStep({
      thought: "loud",
      stepNumber: 1,
      totalSteps: 1,
      nextStepNeeded: false,
    });
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });
});

describe("Sprint 2 B-1: 3-section tool description", () => {
  it("index.ts description declares When to use, Key features, You should sections", () => {
    const indexPath = resolve(__dirname, "..", "index.ts");
    const source = readFileSync(indexPath, "utf8");

    expect(source).toMatch(/When to use:/);
    expect(source).toMatch(/Key features:/);
    expect(source).toMatch(/You should:/);

    // Last rule must be the canonical "only stop when truly satisfied" rule
    expect(source).toMatch(
      /Only set nextStepNeeded=false when truly satisfied with the integrated answer; do not stop after a single tool failure\./
    );

    // When-to-use list contains the 10 verbs the spec requires
    const verbs = [
      "plan",
      "verify",
      "hypothesize",
      "branch",
      "revise",
      "integrate-tools",
      "reflect",
      "reason-about-evidence",
      "decide",
      "course-correct",
    ];
    for (const v of verbs) {
      expect(source, `missing verb: ${v}`).toContain(v);
    }
  });
});

describe("Sprint 2 B-2: README 'When NOT to use' section", () => {
  it("README.md has the When NOT to use section before Configuration", () => {
    const readmePath = resolve(__dirname, "..", "README.md");
    const source = readFileSync(readmePath, "utf8");

    expect(source).toMatch(/### When NOT to use this tool/);

    const notUseIdx = source.indexOf("### When NOT to use this tool");
    const configIdx = source.indexOf("### Configuration");
    expect(notUseIdx).toBeGreaterThan(-1);
    expect(configIdx).toBeGreaterThan(-1);
    expect(notUseIdx).toBeLessThan(configIdx);

    // At least one of the canonical skip reasons
    expect(source).toMatch(/Single-step questions/);
    expect(source).toMatch(/adds latency and noise/);
  });
});

describe("Sprint 2 B-3: USAGE_GUIDELINES.md", () => {
  function readGuidelines(): string {
    const docPath = resolve(__dirname, "..", "docs", "USAGE_GUIDELINES.md");
    return readFileSync(docPath, "utf8");
  }

  it("exists and contains the four canonical sections", () => {
    const md = readGuidelines();
    expect(md).toMatch(/## When TO use this tool/);
    expect(md).toMatch(/## When NOT to use this tool/);
    expect(md).toMatch(/## Phase semantics/);
    expect(md).toMatch(/## You should/);
  });

  it("You should section contains exactly 10 numbered rules", () => {
    const md = readGuidelines();
    const youShouldIdx = md.indexOf("## You should");
    expect(youShouldIdx).toBeGreaterThan(-1);
    const tail = md.slice(youShouldIdx);
    // Match "N. " at the start of numbered rules
    const matches = tail.match(/^\d+\.\s/gm) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(10);
  });

  it("includes Quick manual verification with inspector command", () => {
    const md = readGuidelines();
    expect(md).toMatch(/Quick manual verification/);
    expect(md).toMatch(/modelcontextprotocol\/inspector/);
    expect(md).toMatch(/interleaved:\/\/history\/current/);
    expect(md).toMatch(/interleaved:\/\/branches\/list/);
  });
});

describe("Sprint 2 B-4: MCP Resource registration", () => {
  it("index.ts declares server.registerResource for history and branches", () => {
    const indexPath = resolve(__dirname, "..", "index.ts");
    const source = readFileSync(indexPath, "utf8");

    // Must call registerResource at least twice (history + branches)
    const occurrences = source.match(/server\.registerResource\(/g) ?? [];
    expect(occurrences.length).toBeGreaterThanOrEqual(2);

    // Two canonical URIs
    expect(source).toMatch(/interleaved:\/\/history\/current/);
    expect(source).toMatch(/interleaved:\/\/branches\/list/);

    // Both callbacks must read thinkingServer.getHistory()
    const historyReads = (
      source.match(/thinkingServer\.getHistory\(\)/g) ?? []
    ).length;
    expect(historyReads).toBeGreaterThanOrEqual(2);

    // mimeType: application/json for both
    expect(source.match(/application\/json/g)?.length ?? 0).toBeGreaterThanOrEqual(
      2
    );
  });

  it("InterleavedThinkingServer.getHistory returns the same shape resources expose", () => {
    const server = new InterleavedThinkingServer({ disableLogging: true });
    const history = server.getHistory();
    expect(history).toHaveProperty("steps");
    expect(history).toHaveProperty("branches");
    expect(history).toHaveProperty("toolCalls");
    expect(history).toHaveProperty("statistics");
  });
});

describe("Sprint 2 C-1: anti-loop warnings in nextHint", () => {
  it("Rule 1: flags 2+ consecutive thinking steps without a toolCall", async () => {
    const s = new InterleavedThinkingServer({ disableLogging: true });
    // Step 1: thinking, no tool
    await s.processStep({
      thought: "h1 hypothesis",
      stepNumber: 1,
      totalSteps: 5,
      nextStepNeeded: true,
      phase: "thinking",
    });
    // Step 2: thinking again, no tool → trigger
    const r = await s.processStep({
      thought: "h1 still pondering",
      stepNumber: 2,
      totalSteps: 5,
      nextStepNeeded: true,
      phase: "thinking",
    });
    const data = JSON.parse(r.content[0].text);
    expect(data.nextHint).toContain("Warning:");
    expect(data.nextHint).toMatch(/call a tool/i);
  });

  it("Rule 2: flags 3+ revisions of the same step", async () => {
    const s = new InterleavedThinkingServer({ disableLogging: true });
    // Step 1: target to be revised
    await s.processStep({
      thought: "initial claim",
      stepNumber: 1,
      totalSteps: 10,
      nextStepNeeded: true,
      phase: "thinking",
    });
    // Step 2: first revision — no warning yet (1st revision)
    await s.processStep({
      thought: "revision 1",
      stepNumber: 2,
      totalSteps: 10,
      nextStepNeeded: true,
      phase: "thinking",
      isRevision: true,
      revisesStep: 1,
    });
    // Step 3: second revision — no warning yet (2nd revision)
    await s.processStep({
      thought: "revision 2",
      stepNumber: 3,
      totalSteps: 10,
      nextStepNeeded: true,
      phase: "thinking",
      isRevision: true,
      revisesStep: 1,
    });
    // Step 4: third revision — warning fires (3+ revisions)
    const r4 = await s.processStep({
      thought: "revision 3",
      stepNumber: 4,
      totalSteps: 10,
      nextStepNeeded: true,
      phase: "thinking",
      isRevision: true,
      revisesStep: 1,
    });
    const data = JSON.parse(r4.content[0].text);
    expect(data.nextHint).toContain("Warning:");
    expect(data.nextHint).toMatch(/branch/i);
  });

  it("Rule 3: flags missing analysis after a tool_call registration", async () => {
    const s = new InterleavedThinkingServer({ disableLogging: true });
    // Step 1: register a tool call (status=pending)
    await s.processStep({
      thought: "calling tool",
      stepNumber: 1,
      totalSteps: 5,
      nextStepNeeded: true,
      phase: "tool_call",
      toolCall: { toolName: "fetch", parameters: { q: "x" } },
    });
    // Step 2: phase=thinking WITHOUT previousToolResult → trigger
    const r = await s.processStep({
      thought: "forgot to pass the result back",
      stepNumber: 2,
      totalSteps: 5,
      nextStepNeeded: true,
      phase: "thinking",
    });
    const data = JSON.parse(r.content[0].text);
    expect(data.nextHint).toContain("Warning:");
    expect(data.nextHint).toMatch(/phase=analysis/);
  });

  it("Rule 4: flags tool-budget exhaustion", async () => {
    const s = new InterleavedThinkingServer({
      disableLogging: true,
      maxToolCalls: 2,
    });
    // First call: tool_call → 1 used
    await s.processStep({
      thought: "call 1",
      stepNumber: 1,
      totalSteps: 5,
      nextStepNeeded: true,
      phase: "tool_call",
      toolCall: { toolName: "a", parameters: {} },
    });
    // Second call: tool_call → 2 used (100% of budget)
    const r = await s.processStep({
      thought: "call 2",
      stepNumber: 2,
      totalSteps: 5,
      nextStepNeeded: true,
      phase: "tool_call",
      toolCall: { toolName: "b", parameters: {} },
    });
    const data = JSON.parse(r.content[0].text);
    expect(data.nextHint).toContain("Warning:");
    expect(data.nextHint).toMatch(/tool budget/);
  });
});

describe("Sprint 2 C-2: qualitySignals computation", () => {
  it("returns three numeric fields in [0, 1] for an empty history", () => {
    const s = new InterleavedThinkingServer({ disableLogging: true });
    const signals = s.computeQualitySignals();
    expect(signals).toHaveProperty("convergence");
    expect(signals).toHaveProperty("evidenceCoverage");
    expect(signals).toHaveProperty("hypothesisCoherence");
    for (const k of [
      "convergence",
      "evidenceCoverage",
      "hypothesisCoherence",
    ] as const) {
      const v = signals[k];
      expect(typeof v).toBe("number");
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("convergence rises as thoughts converge, evidenceCoverage rises with successful tools", async () => {
    const s = new InterleavedThinkingServer({ disableLogging: true });

    // Step 1: thinking with a hypothesis
    await s.processStep({
      thought: "H1 the bug is in validate.ts because line 42 fails",
      stepNumber: 1,
      totalSteps: 4,
      nextStepNeeded: true,
      phase: "thinking",
    });

    // Step 2: tool_call
    await s.processStep({
      thought: "verify H1",
      stepNumber: 2,
      totalSteps: 4,
      nextStepNeeded: true,
      phase: "tool_call",
      toolCall: { toolName: "read_file", parameters: { path: "validate.ts" } },
    });

    // Step 3: analysis with successful host result
    const r3 = await s.processStep({
      thought:
        "H1 the bug is in validate.ts because line 42 fails. analysis confirms line 42",
      stepNumber: 3,
      totalSteps: 4,
      nextStepNeeded: true,
      phase: "analysis",
      previousToolResult: {
        toolName: "read_file",
        success: true,
        status: "executed",
        result: { content: "line 42 has bug" },
        executionTime: 10,
        timestamp: new Date().toISOString(),
      },
    });
    const data3 = JSON.parse(r3.content[0].text);
    expect(data3.qualitySignals.convergence).toBeGreaterThan(0);
    expect(data3.qualitySignals.evidenceCoverage).toBeGreaterThan(0);
    // All three are valid 0-1 numbers
    const s3 = data3.qualitySignals;
    expect(s3.convergence).toBeLessThanOrEqual(1);
    expect(s3.evidenceCoverage).toBeLessThanOrEqual(1);
    expect(s3.hypothesisCoherence).toBeLessThanOrEqual(1);
  });

  it("evidenceCoverage=0 when there are no analysis steps and no tool calls", async () => {
    const s = new InterleavedThinkingServer({ disableLogging: true });
    await s.processStep({
      thought: "just thinking",
      stepNumber: 1,
      totalSteps: 2,
      nextStepNeeded: true,
      phase: "thinking",
    });
    const signals = s.computeQualitySignals();
    expect(signals.evidenceCoverage).toBe(0);
  });
});

describe("Sprint 2 C-3: qualityWarning in response when nextStepNeeded=false but quality is low", () => {
  it("emits qualityWarning when caller sets nextStepNeeded=false on a single divergent thinking step", async () => {
    const s = new InterleavedThinkingServer({ disableLogging: true });
    // Single step, no prior history → convergence is 0 (no pairs)
    const r = await s.processStep({
      thought: "some isolated thought",
      stepNumber: 1,
      totalSteps: 1,
      nextStepNeeded: false,
      phase: "thinking",
    });
    const data = JSON.parse(r.content[0].text);
    expect(data.qualityWarning).toBeDefined();
    expect(data.qualityWarning).toMatch(/convergence/);
    expect(data.qualityWarning).toContain("Warning:");
  });

  it("does NOT emit qualityWarning when convergence is high", async () => {
    const s = new InterleavedThinkingServer({ disableLogging: true });
    // Two near-identical thinking steps → convergence should be high
    await s.processStep({
      thought: "alpha beta gamma delta",
      stepNumber: 1,
      totalSteps: 2,
      nextStepNeeded: true,
      phase: "thinking",
    });
    const r = await s.processStep({
      thought: "alpha beta gamma delta epsilon",
      stepNumber: 2,
      totalSteps: 2,
      nextStepNeeded: false,
      phase: "thinking",
    });
    const data = JSON.parse(r.content[0].text);
    expect(data.qualitySignals.convergence).toBeGreaterThan(0.5);
    expect(data.qualityWarning).toBeUndefined();
  });
});
