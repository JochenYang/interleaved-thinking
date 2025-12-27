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
 * Manages tool call execution, limits, and result caching
 */
export class ToolCallManager {
  private maxToolCalls: number;
  private defaultTimeout: number;
  private enableCache: boolean;
  private callCount: number = 0;
  private resultCache: Map<string, ToolResultData> = new Map();
  private mockResults?: Map<string, ToolResultData>;

  constructor(config: ToolCallConfig) {
    this.maxToolCalls = config.maxToolCalls;
    this.defaultTimeout = config.defaultTimeout;
    this.enableCache = config.enableCache;
  }

  /**
   * Execute a tool call (currently returns mock results)
   */
  public async executeToolCall(
    toolCall: ToolCallData
  ): Promise<ToolResultData> {
    if (!this.canExecuteToolCall()) {
      throw new Error("Tool call limit reached");
    }

    this.callCount++;
    const startTime = Date.now();

    // Check if we have a mock result (for testing)
    if (this.mockResults) {
      const mockKey = this.getCacheKey(toolCall);
      const mockResult = this.mockResults.get(mockKey);
      if (mockResult) {
        return mockResult;
      }
    }

    // Check cache
    if (this.enableCache) {
      const cacheKey = this.getCacheKey(toolCall);
      const cached = this.resultCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    // Simulate tool execution (mock implementation)
    const timeout = toolCall.metadata?.timeout || this.defaultTimeout;

    try {
      // Execute with timeout
      const result = await Promise.race([
        this.simulateToolExecution(toolCall),
        this.createTimeoutPromise(timeout),
      ]);

      // Cache the result
      if (this.enableCache && result.success) {
        const cacheKey = this.getCacheKey(toolCall);
        this.resultCache.set(cacheKey, result);
      }

      return {
        ...result,
        executionTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      const result: ToolResultData = {
        toolName: toolCall.toolName,
        success: false,
        error: {
          type:
            error instanceof Error && error.message.includes("timeout")
              ? "TimeoutError"
              : "ToolExecutionError",
          message: error instanceof Error ? error.message : String(error),
          recoveryStrategy:
            error instanceof Error && error.message.includes("timeout")
              ? "Use simpler tool or increase timeout"
              : "Retry with adjusted parameters or use alternative tool",
        },
        executionTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };

      return result;
    }
  }

  /**
   * Simulate tool execution (mock implementation)
   */
  private async simulateToolExecution(
    toolCall: ToolCallData
  ): Promise<ToolResultData> {
    // Simulate async work
    await new Promise((resolve) => setTimeout(resolve, 10));

    return {
      toolName: toolCall.toolName,
      success: true,
      result: {
        message: `Mock result for ${toolCall.toolName}`,
        parameters: toolCall.parameters,
      },
      executionTime: 0, // Will be set by caller
      timestamp: "", // Will be set by caller
    };
  }

  /**
   * Create a promise that rejects after timeout
   */
  private createTimeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Tool execution timeout after ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * Check if more tool calls can be executed
   */
  public canExecuteToolCall(): boolean {
    return this.callCount < this.maxToolCalls;
  }

  /**
   * Get tool call statistics
   */
  public getStatistics(): ToolCallStatistics {
    let successfulCalls = 0;
    let failedCalls = 0;
    let totalExecutionTime = 0;

    for (const result of this.resultCache.values()) {
      if (result.success) {
        successfulCalls++;
      } else {
        failedCalls++;
      }
      totalExecutionTime += result.executionTime;
    }

    return {
      totalCalls: this.callCount,
      successfulCalls,
      failedCalls,
      totalExecutionTime,
    };
  }

  /**
   * Reset the manager state
   */
  public reset(): void {
    this.callCount = 0;
    this.resultCache.clear();
  }

  /**
   * Inject mock results for testing
   */
  public injectMockResults(mockResults: Map<string, ToolResultData>): void {
    this.mockResults = mockResults;
  }

  /**
   * Generate cache key for a tool call
   */
  private getCacheKey(toolCall: ToolCallData): string {
    return `${toolCall.toolName}:${JSON.stringify(toolCall.parameters)}`;
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
   * Format content in a box
   */
  private formatBox(header: string, content: string): string {
    const maxLength = Math.max(header.length, content.length) + 4;
    const border = "─".repeat(maxLength);

    return `
┌${border}┐
│ ${header.padEnd(maxLength - 2)} │
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

  constructor(config?: Partial<ServerConfig>) {
    this.config = {
      maxToolCalls: config?.maxToolCalls ?? 50,
      defaultTimeout: config?.defaultTimeout ?? 30000,
      disableLogging: config?.disableLogging ?? false,
      enableResultCache: config?.enableResultCache ?? true,
      testMode: config?.testMode ?? false,
    };

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

      // Auto-infer phase if not provided
      if (!input.phase) {
        input.phase = this.inferPhase(input);
      }

      // Auto-adjust totalSteps if needed
      if (input.stepNumber > input.totalSteps) {
        input.totalSteps = input.stepNumber;
      }

      // Process based on phase
      let toolResult: ToolResultData | undefined;

      switch (input.phase) {
        case "thinking":
          this.logger.logThinkingStep(input);
          break;

        case "tool_call":
          if (!input.toolCall) {
            throw new Error("toolCall is required for tool_call phase");
          }
          this.logger.logToolCall(input.toolCall);
          toolResult = await this.toolCallManager.executeToolCall(
            input.toolCall
          );
          this.logger.logToolResult(toolResult);

          // Record tool call
          this.stateManager.addToolCall({
            stepNumber: input.stepNumber,
            toolCall: input.toolCall,
            result: toolResult,
          });

          // Add result to input for storage
          input.toolResult = toolResult;
          break;

        case "analysis":
          this.logger.logAnalysisStep(input);
          // Provide last tool result if available
          toolResult = this.stateManager.getLastToolResult();
          break;
      }

      // Add step to history
      this.stateManager.addStep(input);

      // Build response
      const history = this.stateManager.getHistory();
      const response = {
        stepNumber: input.stepNumber,
        totalSteps: input.totalSteps,
        nextStepNeeded: input.nextStepNeeded,
        branches: Object.keys(history.branches),
        stepHistoryLength: history.steps.length,
        phase: input.phase,
        ...(toolResult && {
          toolResult: {
            success: toolResult.success,
            executionTime: toolResult.executionTime,
          },
        }),
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
   * Inject mock results for testing
   */
  public injectMockResults(mockResults: Map<string, ToolResultData>): void {
    this.toolCallManager.injectMockResults(mockResults);
  }

  /**
   * Validate input data
   */
  private validateInput(input: InterleavedStepData): void {
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
    } else if (errorMessage.includes("required")) {
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
