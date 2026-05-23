import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  InterleavedThinkingServer,
  ToolCallManager,
  StateManager,
  Logger,
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

    it("should use injected mock results for tool calls", async () => {
      const mockResults = new Map();
      mockResults.set("mock_tool:{}", {
        toolName: "mock_tool",
        success: true,
        result: { message: "Mocked!" },
        executionTime: 5,
        timestamp: new Date().toISOString(),
      });
      server.injectMockResults(mockResults);

      const input = {
        thought: "Using mock",
        stepNumber: 1,
        totalSteps: 2,
        nextStepNeeded: true,
        phase: "tool_call" as const,
        toolCall: {
          toolName: "mock_tool",
          parameters: {},
        },
      };

      const result = await server.processStep(input);
      expect(result.isError).toBeUndefined();

      const data = JSON.parse(result.content[0].text);
      expect(data.toolResult).toBeDefined();
      expect(data.toolResult.success).toBe(true);
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

  it("should handle timeout errors gracefully", async () => {
    const timeoutManager = new ToolCallManager({
      maxToolCalls: 5,
      defaultTimeout: 1, // Very short timeout
      enableCache: true,
    });

    const result = await timeoutManager.executeToolCall({
      toolName: "slow_tool",
      parameters: {},
      metadata: { timeout: 1 },
    });

    expect(result.success).toBe(false);
    expect(result.error?.type).toBe("TimeoutError");
  });

  it("should track successful and failed calls separately in statistics", async () => {
    const statsManager = new ToolCallManager({
      maxToolCalls: 10,
      defaultTimeout: 1000,
      enableCache: true,
    });

    // First call succeeds
    await statsManager.executeToolCall({ toolName: "tool1", parameters: {} });

    // Second call will fail due to timeout
    const timeoutManager = new ToolCallManager({
      maxToolCalls: 10,
      defaultTimeout: 1, // very short timeout
      enableCache: true,
    });

    const result = await timeoutManager.executeToolCall({
      toolName: "slow_tool",
      parameters: {},
      metadata: { timeout: 1 },
    });
    expect(result.success).toBe(false);

    const stats = timeoutManager.getStatistics();
    expect(stats.totalCalls).toBe(1);
    expect(stats.successfulCalls).toBe(0);
    expect(stats.failedCalls).toBe(1);
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
