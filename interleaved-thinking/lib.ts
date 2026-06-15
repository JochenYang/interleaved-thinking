import chalk from "chalk";

/**
 * Phase of the interleaved thinking process
 */
export type ThoughtPhase = "thinking" | "tool_call" | "analysis";

/**
 * Tool call information
 */
export interface ToolCallData {
  toolName: string;
  parameters: Record<string, any>;
  metadata?: {
    timeout?: number;
    retryCount?: number;
    priority?: "high" | "normal" | "low";
  };
}

/**
 * Tool execution result
 */
export interface ToolResultData {
  toolName: string;
  success: boolean;
  status?: "pending" | "executed" | "error";
  result?: any;
  error?: {
    type: string;
    message: string;
    recoveryStrategy?: string;
  };
  executionTime: number;
  timestamp: string;
}

/**
 * Interleaved step data - extends Sequential Thinking's ThoughtData concept
 */
export interface InterleavedStepData {
  // Core fields (from Sequential Thinking)
  thought: string;
  stepNumber: number;
  totalSteps: number;
  nextStepNeeded: boolean;

  // Revision and branching (from Sequential Thinking)
  isRevision?: boolean;
  revisesStep?: number;
  branchFromStep?: number;
  branchId?: string;
  needsMoreSteps?: boolean;

  // Interleaved thinking specific fields
  // Phase is now optional - will be auto-inferred if not provided
  phase?: ThoughtPhase;
  toolCall?: ToolCallData;
  toolResult?: ToolResultData;

  // Result of a previously registered tool call, passed back by the MCP host
  // after the host has executed the actual tool. The server itself does NOT
  // execute external tools; the host is responsible for forwarding.
  previousToolResult?: ToolResultData;
}

/**
 * Tool call record for history tracking
 */
export interface ToolCallRecord {
  stepNumber: number;
  toolCall: ToolCallData;
  result: ToolResultData;
}

/**
 * Complete step history with statistics
 */
export interface StepHistory {
  steps: InterleavedStepData[];
  branches: Record<string, InterleavedStepData[]>;
  toolCalls: ToolCallRecord[];
  statistics: {
    totalSteps: number;
    totalToolCalls: number;
    successfulToolCalls: number;
    failedToolCalls: number;
    totalExecutionTime: number;
  };
}

/**
 * Server configuration
 */
export interface ServerConfig {
  maxToolCalls: number;
  defaultTimeout: number;
  disableLogging: boolean;
  enableResultCache: boolean;
  testMode?: boolean;
}

/**
 * Tool call manager configuration
 */
export interface ToolCallConfig {
  maxToolCalls: number;
  defaultTimeout: number;
  enableCache: boolean;
}

/**
 * Tool call statistics
 */
export interface ToolCallStatistics {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalExecutionTime: number;
}

/**
 * Process result returned by the server
 */
export interface ProcessResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/**
 * Manages tool call registration, limits, and pending-queue tracking.
 *
 * NOTE: This server does NOT execute external tools. The MCP host
 * (Claude/Cursor/etc.) is responsible for taking a registered tool
 * call, dispatching it to the right tool provider, and feeding the
 * result back via the next call's `previousToolResult` field.
 */
export class ToolCallManager {
  private maxToolCalls: number;
  private defaultTimeout: number;
  private enableCache: boolean;
  private callCount: number = 0;
  private successCount: number = 0;
  private failCount: number = 0;
  private totalExecTime: number = 0;
  private pendingCalls: ToolCallData[] = [];

  constructor(config: ToolCallConfig) {
    this.maxToolCalls = config.maxToolCalls;
    this.defaultTimeout = config.defaultTimeout;
    this.enableCache = config.enableCache;
  }

  /**
   * Register a tool call. Returns a pending ToolResultData with
   * status='pending'. The host is expected to execute the tool and
   * return the real result via the next call's previousToolResult.
   */
  public async executeToolCall(
    toolCall: ToolCallData
  ): Promise<ToolResultData> {
    if (!this.canExecuteToolCall()) {
      throw new Error("Tool call limit reached");
    }

    this.callCount++;
    this.successCount++;
    this.pendingCalls.push({ ...toolCall });

    return {
      toolName: toolCall.toolName,
      success: true,
      status: "pending",
      result: {
        message:
          "Tool call registered. The MCP host is responsible for executing this tool and passing the result back via the next call's previousToolResult field.",
        parameters: toolCall.parameters,
      },
      executionTime: 0,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * List all tool calls registered but not yet marked as executed.
   */
  public getPendingToolCalls(): ToolCallData[] {
    return [...this.pendingCalls];
  }

  /**
   * Mark a previously registered tool call as executed. Removes it
   * from the pending queue. The actual ToolResultData is stored
   * on the StateManager (see InterleavedThinkingServer).
   */
  public markToolCallExecuted(
    toolCall: Pick<ToolCallData, "toolName">,
    _result: ToolResultData
  ): void {
    this.pendingCalls = this.pendingCalls.filter(
      (c) => c.toolName !== toolCall.toolName
    );
  }

  /**
   * Check if more tool calls can be registered
   */
  public canExecuteToolCall(): boolean {
    return this.callCount < this.maxToolCalls;
  }

  /**
   * Get tool call statistics
   */
  public getStatistics(): ToolCallStatistics {
    return {
      totalCalls: this.callCount,
      successfulCalls: this.successCount,
      failedCalls: this.failCount,
      totalExecutionTime: this.totalExecTime,
    };
  }

  /**
   * Reset the manager state
   */
  public reset(): void {
    this.callCount = 0;
    this.successCount = 0;
    this.failCount = 0;
    this.totalExecTime = 0;
    this.pendingCalls = [];
  }
}

/**
 * Manages step history, branches, and tool call records
 */
export class StateManager {
  private steps: InterleavedStepData[] = [];
  private branches: Record<string, InterleavedStepData[]> = {};
  private toolCalls: ToolCallRecord[] = [];

  /**
   * Add a new step to history
   */
  public addStep(step: InterleavedStepData): void {
    this.steps.push(step);

    // Handle branching
    if (step.branchFromStep && step.branchId) {
      if (!this.branches[step.branchId]) {
        this.branches[step.branchId] = [];
      }
      this.branches[step.branchId].push(step);
    }
  }

  /**
   * Add a tool call record
   */
  public addToolCall(record: ToolCallRecord): void {
    this.toolCalls.push(record);
  }

  /**
   * Replace the result on the most recent tool call record.
   * Used by the analysis phase to attach the host-executed payload
   * to a tool call that was previously registered with status='pending'.
   */
  public updateLastToolResult(result: ToolResultData): void {
    if (this.toolCalls.length === 0) {
      return;
    }
    this.toolCalls[this.toolCalls.length - 1].result = result;
  }

  /**
   * Get complete history with statistics
   */
  public getHistory(): StepHistory {
    const statistics = this.calculateStatistics();

    return {
      steps: [...this.steps],
      branches: { ...this.branches },
      toolCalls: [...this.toolCalls],
      statistics,
    };
  }

  /**
   * Get a specific step by number
   */
  public getStep(stepNumber: number): InterleavedStepData | undefined {
    return this.steps.find((s) => s.stepNumber === stepNumber);
  }

  /**
   * Get the last tool result
   */
  public getLastToolResult(): ToolResultData | undefined {
    if (this.toolCalls.length === 0) {
      return undefined;
    }
    return this.toolCalls[this.toolCalls.length - 1].result;
  }

  /**
   * Calculate statistics from history
   */
  private calculateStatistics() {
    let successfulToolCalls = 0;
    let failedToolCalls = 0;
    let totalExecutionTime = 0;

    for (const record of this.toolCalls) {
      if (record.result.success) {
        successfulToolCalls++;
      } else {
        failedToolCalls++;
      }
      totalExecutionTime += record.result.executionTime;
    }

    return {
      totalSteps: this.steps.length,
      totalToolCalls: this.toolCalls.length,
      successfulToolCalls,
      failedToolCalls,
      totalExecutionTime,
    };
  }
}

/**
 * Handles formatted logging output to stderr
 */
export class Logger {
  private disableLogging: boolean;

  constructor(disableLogging: boolean = false) {
    this.disableLogging = disableLogging;
  }

  /**
   * Log a thinking step
   */
  public logThinkingStep(step: InterleavedStepData): void {
    if (this.disableLogging) return;

    const prefix = chalk.blue("💭 Thinking");
    const context = this.buildContext(step);
    const header = `${prefix} ${step.stepNumber}/${step.totalSteps}${context}`;
    const formatted = this.formatBox(header, step.thought);

    console.error(formatted);
  }

  /**
   * Log a tool call
   */
  public logToolCall(toolCall: ToolCallData): void {
    if (this.disableLogging) return;

    const prefix = chalk.cyan("🔧 Tool Call");
    const content = `${toolCall.toolName}(${JSON.stringify(
      toolCall.parameters
    )})`;
    const formatted = this.formatBox(prefix, content);

    console.error(formatted);
  }

  /**
   * Log a tool result
   */
  public logToolResult(result: ToolResultData): void {
    if (this.disableLogging) return;

    const prefix = result.success
      ? chalk.green("✅ Tool Result")
      : chalk.red("❌ Tool Error");
    const content = result.success
      ? `${result.toolName}: ${JSON.stringify(result.result)} (${
          result.executionTime
        }ms)`
      : `${result.toolName}: ${result.error?.message} (${result.executionTime}ms)`;
    const formatted = this.formatBox(prefix, content);

    console.error(formatted);
  }

  /**
   * Log an analysis step
   */
  public logAnalysisStep(step: InterleavedStepData): void {
    if (this.disableLogging) return;

    const prefix = chalk.magenta("📊 Analysis");
    const context = this.buildContext(step);
    const header = `${prefix} ${step.stepNumber}/${step.totalSteps}${context}`;
    const formatted = this.formatBox(header, step.thought);

    console.error(formatted);
  }

  /**
   * Build context string for step (revision, branch info)
   */
  private buildContext(step: InterleavedStepData): string {
    let context = "";

    if (step.isRevision && step.revisesStep) {
      context += ` ${chalk.yellow(`(revising step ${step.revisesStep})`)}`;
    } else if (step.branchFromStep && step.branchId) {
      context += ` ${chalk.green(
        `(from step ${step.branchFromStep}, ID: ${step.branchId})`
      )}`;
    }

    return context;
  }

  /**
   * Strip ANSI escape codes from a string for length calculation
   */
  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[\d+m/g, "");
  }

  /**
   * Format content in a box
   */
  private formatBox(header: string, content: string): string {
    const visibleHeader = this.stripAnsi(header);
    const maxLength = Math.max(visibleHeader.length, content.length) + 4;
    const border = "─".repeat(maxLength);

    return `
┌${border}┐
│ ${header}${" ".repeat(maxLength - 2 - visibleHeader.length)} │
├${border}┤
│ ${content.padEnd(maxLength - 2)} │
└${border}┘`;
  }
}

/**
 * Main server class for interleaved sequential thinking
 */
export class InterleavedThinkingServer {
  private toolCallManager: ToolCallManager;
  private stateManager: StateManager;
  private logger: Logger;
  private config: ServerConfig;

  private readonly defaultConfig: ServerConfig = {
    maxToolCalls: 50,
    defaultTimeout: 30000,
    disableLogging: process.env.DISABLE_THOUGHT_LOGGING === "true",
    enableResultCache: true,
    testMode: false,
  };

  constructor(config?: Partial<ServerConfig>) {
    // disableLogging precedence: explicit config arg > DISABLE_THOUGHT_LOGGING env var.
    // (defaultConfig.disableLogging already reads the env, so spread order is sufficient.)
    this.config = { ...this.defaultConfig, ...config };

    this.toolCallManager = new ToolCallManager({
      maxToolCalls: this.config.maxToolCalls,
      defaultTimeout: this.config.defaultTimeout,
      enableCache: this.config.enableResultCache,
    });

    this.stateManager = new StateManager();
    this.logger = new Logger(this.config.disableLogging);
  }

  /**
   * Infer the phase based on input and history
   */
  private inferPhase(input: InterleavedStepData): ThoughtPhase {
    // If phase is explicitly provided, use it
    if (input.phase) {
      return input.phase;
    }

    // If toolCall is provided, it's a tool_call phase
    if (input.toolCall) {
      return "tool_call";
    }

    // If previous step was a tool_call, this is analysis phase
    const lastStep = this.stateManager.getStep(input.stepNumber - 1);
    if (lastStep?.phase === "tool_call") {
      return "analysis";
    }

    // Default to thinking phase
    return "thinking";
  }

  /**
   * Process a step in the interleaved thinking process
   */
  public async processStep(input: InterleavedStepData): Promise<ProcessResult> {
    try {
      // Validate required fields
      this.validateInput(input);

      // Create a shallow copy to avoid mutating the original input
      const step = { ...input };

      // Auto-infer phase if not provided
      if (!step.phase) {
        step.phase = this.inferPhase(step);
      }

      // Auto-adjust totalSteps if needed
      if (step.stepNumber > step.totalSteps) {
        step.totalSteps = step.stepNumber;
      }

      // Process based on phase
      let toolResult: ToolResultData | undefined;

      switch (step.phase) {
        case "thinking":
          this.logger.logThinkingStep(step);
          break;

        case "tool_call":
          if (!step.toolCall) {
            throw new Error("toolCall is required for tool_call phase");
          }
          this.logger.logToolCall(step.toolCall);
          // Register the call; the host is responsible for execution.
          // We receive the real result back in the next call's previousToolResult.
          toolResult = await this.toolCallManager.executeToolCall(
            step.toolCall
          );
          this.logger.logToolResult(toolResult);

          // Record the registration with a pending result placeholder.
          this.stateManager.addToolCall({
            stepNumber: step.stepNumber,
            toolCall: step.toolCall,
            result: toolResult,
          });

          step.toolResult = toolResult;
          break;

        case "analysis":
          this.logger.logAnalysisStep(step);
          if (step.previousToolResult) {
            // Host has returned the real result for a previously registered call.
            // Update the StateManager record so statistics and getLastToolResult
            // reflect the actual outcome, and clear the pending queue entry.
            this.stateManager.updateLastToolResult(step.previousToolResult);
            this.toolCallManager.markToolCallExecuted(
              { toolName: step.previousToolResult.toolName },
              step.previousToolResult
            );
            toolResult = step.previousToolResult;
            step.toolResult = step.previousToolResult;
          } else {
            // No host result supplied - fall back to whatever is in history.
            toolResult = this.stateManager.getLastToolResult();
          }
          break;
      }

      // Add step to history
      this.stateManager.addStep(step);

      // Build response. toolResult is passed through as-is (per MCP 2025-11-25
      // and SEP-1624, structuredContent must not drop fields silently).
      const history = this.stateManager.getHistory();
      const nextHint = this.generateNextHint(step, toolResult);
      const response = {
        stepNumber: step.stepNumber,
        totalSteps: step.totalSteps,
        nextStepNeeded: step.nextStepNeeded,
        phase: step.phase,
        nextHint,
        branches: Object.keys(history.branches),
        stepHistoryLength: history.steps.length,
        ...(toolResult && { toolResult }),
      };

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * L2 soft-guidance tips that nudge the model toward a hypothesis → evidence →
   * conclusion flow without constraining the thought field. These are appended to
   * the phase-specific base hint and never change the schema, so the model can
   * still write free-form thoughts.
   */
  private static readonly PHASE_TIPS: Record<ThoughtPhase, string> = {
    thinking:
      "State your falsifiable hypothesis (e.g., 'H1: X causes Y') and your verification strategy before stepping.",
    tool_call:
      "Ensure toolCall.parameters are specific and concrete; avoid empty queries.",
    analysis:
      "Cite specific values from toolResult (e.g., 'result.count = 42') in your thought, not generic 'based on the result'.",
  };

  /**
   * Generate next step hint based on current phase and input.
   * Returns the base hint plus an L2 soft-guidance tip that nudges the model
   * toward hypothesis → evidence → conclusion flow (no schema constraint).
   */
  private generateNextHint(
    input: InterleavedStepData,
    toolResult?: ToolResultData
  ): string {
    const { phase, stepNumber, nextStepNeeded, toolCall } = input;
    const inferredPhase: ThoughtPhase = phase ?? "thinking";

    let baseHint: string;

    // Phase-specific base hints (host-acknowledged after Sprint 1 P0-C)
    if (inferredPhase === "tool_call") {
      if (toolCall && toolResult) {
        // Tool call has been registered (status=pending).
        // The host should execute it and call back with previousToolResult.
        baseHint = `Call ${toolCall.toolName} on the MCP host, then call interleaved-thinking with phase=analysis and pass the result back via previousToolResult`;
      } else if (toolCall) {
        // Tool is pending execution
        baseHint = `Execute ${toolCall.toolName}, then call this tool again for reflection`;
      } else {
        baseHint = `Continue to next step`;
      }
    } else if (inferredPhase === "thinking") {
      if (nextStepNeeded) {
        baseHint = `Continue to next step (step ${stepNumber + 1}) or call a tool for information`;
      } else {
        baseHint = "Thinking process complete";
      }
    } else {
      // analysis
      if (nextStepNeeded) {
        baseHint = `Continue reasoning or call tools again as needed`;
      } else {
        baseHint = `Reasoning complete - ready to return final answer`;
      }
    }

    const tip = InterleavedThinkingServer.PHASE_TIPS[inferredPhase];
    return tip ? `${baseHint}\n💡 Tip: ${tip}` : baseHint;
  }

  /**
   * Get execution history
   */
  public getHistory(): StepHistory {
    return this.stateManager.getHistory();
  }

  /**
   * Reset server state
   */
  public reset(): void {
    this.toolCallManager.reset();
    this.stateManager = new StateManager();
  }

  /**
   * Validate input data
   */
  private validateInput(input: InterleavedStepData): void {
    if (!input.thought || input.thought.trim().length === 0) {
      throw new Error("thought is required and must be a non-empty string");
    }

    if (!input.stepNumber || input.stepNumber < 1) {
      throw new Error("stepNumber must be a positive integer");
    }

    if (!input.totalSteps || input.totalSteps < 1) {
      throw new Error("totalSteps must be a positive integer");
    }

    if (input.nextStepNeeded === undefined) {
      throw new Error("nextStepNeeded is required");
    }

    // Phase is now optional - will be inferred if not provided
    if (input.phase && !["thinking", "tool_call", "analysis"].includes(input.phase)) {
      throw new Error("phase must be one of: thinking, tool_call, analysis");
    }
  }

  /**
   * Handle errors and return formatted error response
   */
  private handleError(error: unknown): ProcessResult {
    const errorMessage = error instanceof Error ? error.message : String(error);
    let errorType = "Error";
    let recoveryStrategy = "Check input parameters and try again";

    if (errorMessage.includes("limit reached")) {
      errorType = "ToolCallLimitError";
      recoveryStrategy = "Summarize progress and terminate or reset the server";
    } else if (errorMessage.includes("timeout")) {
      errorType = "TimeoutError";
      recoveryStrategy = "Use simpler tool or increase timeout";
    } else if (errorMessage.includes("required") || errorMessage.includes("must be one of")) {
      errorType = "ValidationError";
      recoveryStrategy = "Provide all required fields";
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              error: {
                type: errorType,
                message: errorMessage,
                recoveryStrategy,
              },
              status: "failed",
            },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
}
