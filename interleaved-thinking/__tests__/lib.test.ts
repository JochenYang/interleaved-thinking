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

      expect(data.nextHint).toContain("💡 Tip:");
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

      expect(data.nextHint).toContain("💡 Tip:");
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

      expect(data.nextHint).toContain("💡 Tip:");
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
      expect(data.nextHint).toContain("💡 Tip:");
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
