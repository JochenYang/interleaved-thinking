import chalk from "chalk";

/**
 * Clamp a number to [0, 1]. Module-level helper for quality-signal scoring.
 */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

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
 * Lightweight quality signals computed from in-memory history.
 * All three scores are normalized to [0, 1]. Thresholds (0.3 / 0.7) are
 * tunable by the caller; the server only emits the raw numbers plus an
 * optional qualityWarning when nextStepNeeded=false while scores are low.
 */
export interface QualitySignals {
  /** How similar the last few thoughts are (consecutive-pair Jaccard). High = converged. */
  convergence: number;
  /** successfulToolCalls / analysis steps. High = analysis is grounded in tool output. */
  evidenceCoverage: number;
  /** Pairwise Jaccard similarity over the last few thoughts. High = consistent vocabulary; low = scattered. */
  hypothesisCoherence: number;
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
      const qualitySignals = this.computeQualitySignals(history);

      // Sprint 2 C-3: soft warning when caller claims completion while
      // quality is still low. Never block — the call has already succeeded;
      // we just surface the signal so the model can decide whether to
      // continue instead of stopping here.
      let qualityWarning: string | undefined;
      if (
        step.nextStepNeeded === false &&
        qualitySignals.convergence < 0.3
      ) {
        qualityWarning = `Warning: nextStepNeeded=false but convergence=${qualitySignals.convergence.toFixed(2)} (<0.3). Evidence may not be integrated yet.`;
      } else if (
        step.nextStepNeeded === false &&
        qualitySignals.evidenceCoverage < 0.3 &&
        history.statistics.totalToolCalls > 0
      ) {
        qualityWarning = `Warning: nextStepNeeded=false but evidenceCoverage=${qualitySignals.evidenceCoverage.toFixed(2)} (<0.3). No analysis step was backed by a successful tool result.`;
      }

      const response: Record<string, unknown> = {
        stepNumber: step.stepNumber,
        totalSteps: step.totalSteps,
        nextStepNeeded: step.nextStepNeeded,
        phase: step.phase,
        nextHint,
        branches: Object.keys(history.branches),
        stepHistoryLength: history.steps.length,
        qualitySignals,
        ...(toolResult && { toolResult }),
        ...(qualityWarning && { qualityWarning }),
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

  /** Hard-rule thresholds (Sprint 2 C-1). Tunable via constant if needed. */
  private static readonly MAX_TOOL_BUDGET_RATIO = 0.8;

  /**
   * Generate next step hint based on current phase and input.
   * Returns: baseHint + Tip + any Warning: hard-rule warnings based on history.
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
    const tipLine = tip ? `\nTip: ${tip}` : "";

    // Sprint 2 C-1: append Warning: hard-rule warnings based on history.
    const warnings = this.collectAntiLoopWarnings(input);

    return warnings.length > 0
      ? `${baseHint}${tipLine}\n${warnings.join("\n")}`
      : `${baseHint}${tipLine}`;
  }

  /**
   * Sprint 2 C-1: hard-rule warnings that prevent the most common failure
   * patterns (idle-loop thinking, revision loops, missing analysis, budget
   * exhaustion). Pure history-derived; never throws; returns [] when nothing
   * to flag.
   */
  private collectAntiLoopWarnings(
    input: InterleavedStepData
  ): string[] {
    const warnings: string[] = [];
    const history = this.stateManager.getHistory();
    const steps = history.steps;

    // Rule 1 (anti-idle): 2+ consecutive thinking phases without any toolCall.
    // The current step is NOT in history yet, so we inspect steps[N-1..N-2].
    if (input.phase === "thinking" || input.phase === undefined) {
      const recent = steps.slice(-2);
      const allThinkingNoTool = recent.length === 2 &&
        recent.every((s) => s.phase === "thinking" && !s.toolCall);
      if (allThinkingNoTool && input.toolCall === undefined) {
        warnings.push(
          "Warning: You have thought 2+ steps without calling a tool. Consider phase=tool_call to verify a hypothesis."
        );
      }
    }

    // Rule 2 (anti-revision-loop): the same revisesStep target has been
    // revised 3+ times across the whole history. Count occurrences on the
    // committed steps (this step is not yet in history).
    if (input.isRevision && input.revisesStep !== undefined) {
      const target = input.revisesStep;
      const sameTargetRevisions = steps.filter(
        (s) => s.isRevision && s.revisesStep === target
      ).length;
      if (sameTargetRevisions + 1 >= 3) {
        warnings.push(
          `Warning: You have revised step ${target} 3+ times. Consider branching into an alternative hypothesis via branchFromStep instead.`
        );
      }
    }

    // Rule 3 (force analysis): model just registered a tool_call (status=pending
    // sits in history) and is now calling again as phase=thinking WITHOUT
    // previousToolResult. Note: the CURRENT step is already committed to history
    // before generateNextHint runs, so we inspect steps[length-2] (the prior
    // committed step) instead of steps[length-1].
    const priorStep = steps.length >= 2 ? steps[steps.length - 2] : undefined;
    if (
      (input.phase === "thinking" || input.phase === undefined) &&
      priorStep?.phase === "tool_call" &&
      input.toolCall === undefined &&
      input.previousToolResult === undefined
    ) {
      warnings.push(
        "Warning: You registered a tool call but did not pass previousToolResult. Please call again with phase=analysis and the real result."
      );
    }

    // Rule 4 (force closure): ratio of tool calls already committed
    // (or about-to-commit for tool_call phase) against the configured budget.
    const stats = history.statistics;
    const budgetMax = this.config.maxToolCalls;
    if (budgetMax > 0) {
      const effectiveCalls =
        input.phase === "tool_call"
          ? stats.totalToolCalls + 1
          : stats.totalToolCalls;
      const ratio = effectiveCalls / budgetMax;
      if (ratio >= InterleavedThinkingServer.MAX_TOOL_BUDGET_RATIO) {
        const usedPct = Math.round(ratio * 100);
        warnings.push(
          `Warning: You have used ${usedPct}% of your tool budget. Consider concluding soon.`
        );
      }
    }

    return warnings;
  }

  /**
   * Sprint 2 C-2: compute lightweight quality signals from history.
   * No embeddings, no external deps. All scores in [0, 1].
   *
   * - convergence: 1 - mean(char-Jaccard distance) over consecutive pairs
   *   in the last 5 thoughts. High = model is settling on an answer.
   * - evidenceCoverage: successfulToolCalls / analysis-phase steps. High =
   *   analysis is grounded by real tool results. 0 when there are no
   *   analysis steps yet (signals "no analysis has happened").
   * - hypothesisCoherence: 1 - mean(char-Jaccard distance) over all pairs
   *   in the last 5 thoughts. With <2 thoughts, defaults to 0 (no signal).
   */
  public computeQualitySignals(history?: StepHistory): QualitySignals {
    const h = history ?? this.stateManager.getHistory();
    const steps = h.steps;
    const last5 = steps.slice(-5);

    // convergence: consecutive pair Jaccard over last 5 thoughts
    let convergence = 0;
    if (last5.length >= 2) {
      let sum = 0;
      let pairs = 0;
      for (let i = 1; i < last5.length; i++) {
        sum += InterleavedThinkingServer.jaccardSimilarity(
          last5[i - 1].thought,
          last5[i].thought
        );
        pairs++;
      }
      convergence = pairs > 0 ? sum / pairs : 0;
    }

    // evidenceCoverage: successful tool calls vs analysis-phase steps
    const analysisCount = steps.filter((s) => s.phase === "analysis").length;
    const evidenceCoverage =
      analysisCount > 0
        ? Math.min(1, h.statistics.successfulToolCalls / analysisCount)
        : 0;

    // hypothesisCoherence: pairwise Jaccard over last 5 thoughts
    let hypothesisCoherence = 0;
    if (last5.length >= 2) {
      let sum = 0;
      let pairs = 0;
      for (let i = 0; i < last5.length; i++) {
        for (let j = i + 1; j < last5.length; j++) {
          sum += InterleavedThinkingServer.jaccardSimilarity(
            last5[i].thought,
            last5[j].thought
          );
          pairs++;
        }
      }
      hypothesisCoherence = pairs > 0 ? sum / pairs : 0;
    }

    return {
      convergence: clamp01(convergence),
      evidenceCoverage: clamp01(evidenceCoverage),
      hypothesisCoherence: clamp01(hypothesisCoherence),
    };
  }

  /**
   * Character-level Jaccard similarity between two strings.
   * Tokens are whitespace-split, lower-cased, deduped via Set.
   * Returns 0 for empty/identical-empty inputs (no overlap to compute).
   */
  private static jaccardSimilarity(a: string, b: string): number {
    const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
    const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
    if (tokensA.size === 0 && tokensB.size === 0) return 0;
    let intersection = 0;
    for (const t of tokensA) {
      if (tokensB.has(t)) intersection++;
    }
    const union = tokensA.size + tokensB.size - intersection;
    return union === 0 ? 0 : intersection / union;
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
