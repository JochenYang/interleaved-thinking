import { describe, it, expect, beforeEach } from "vitest";
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

  describe("Error handling", () => {
    it("should return error for missing phase", async () => {
      const input = {
        thought: "Test",
        stepNumber: 1,
        totalSteps: 1,
        nextStepNeeded: false,
        // @ts-expect-error - intentionally missing phase
        phase: undefined,
      };

      const result = await server.processStep(input);
      expect(result.isError).toBe(true);

      const data = JSON.parse(result.content[0].text);
      expect(data.error.type).toBe("ValidationError");
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
