# Usage Guidelines for `interleaved-thinking`

> Audience: the AI model that calls this MCP tool. These guidelines are loaded into the model's context by the MCP host and steer how the tool should be invoked. They are NOT user-facing instructions.

This document complements the tool's `description` field with extended rationale, worked examples, and concrete prompt templates.

## When TO use this tool

Reach for `interleaved-thinking` when the task is any of the following:

- **Multi-step reasoning** where the next step depends on evidence gathered in earlier steps.
- **Hypothesis-driven investigation** that requires testing a claim against real data (files, APIs, DBs, code execution).
- **Branching exploration** where 2+ competing hypotheses need to be evaluated before committing.
- **Revision-heavy tasks** where the model discovers mid-stream that an earlier assumption was wrong.
- **Tool-augmented analysis** where pure reasoning is not enough and external tools are required to ground the answer.
- **Self-correcting loops** where the model needs explicit convergence / coverage / coherence feedback to know when to stop.

If the task matches any of the above, the tool pays for itself in latency by preventing premature conclusions.

## When NOT to use this tool

Skip `interleaved-thinking` when:

- The answer is known up front (lookup, factual recall, single-line translation).
- A dedicated MCP tool already exists and reaches the answer in one call.
- The task is a mechanical edit with zero exploration space.
- The user is just chatting and no tool is needed at all.

In these cases, calling the tool adds latency and noise without improving the answer.

## Phase semantics

The tool operates on a three-phase cycle. The `phase` field is optional; if omitted, it is inferred:

| Phase        | Auto-inference rule                              | Expected next action                              |
| ------------ | ------------------------------------------------ | ------------------------------------------------- |
| `thinking`   | default (no `toolCall`, no prior `tool_call`)    | Reason, hypothesize, plan, or branch              |
| `tool_call`  | `toolCall` field is present                      | Host executes the tool, returns result via next call's `previousToolResult` |
| `analysis`   | previous step was `tool_call`, or `previousToolResult` is present | Interpret the host-returned result, integrate evidence, decide whether more steps are needed |

The host-delegated flow:

```
You (model)                    MCP host (Claude/Cursor)         this server
   |                                   |                            |
   |--- call with toolCall ----------->|                            |
   |                                   |-- register call (pending)->|
   |<-- toolResult.status=pending ------|                            |
   |                                   |                            |
   |--- call with previousToolResult -->|                            |
   |   (after host ran the tool)       |                            |
   |                                   |-- update record ----------->|
   |<-- toolResult.status=executed -----|                            |
```

The server never executes external tools. It only registers the call and tracks the interleaving flow.

## You should

1. **Start with a falsifiable hypothesis.** State it explicitly in the `thought` field, e.g. "H1: the bug is in `validate.ts` because the error message references line 42". A vague thought cannot be verified.
2. **Use the phase field intentionally.** `thinking` for reasoning, `tool_call` for registering a tool, `analysis` for integrating a result. Auto-inference is a fallback, not a substitute for clarity.
3. **Pass the host's actual result back via `previousToolResult`.** Do not synthesize a result yourself; the host's real payload is the only ground truth.
4. **Cite concrete values from `toolResult`** in your next thought (e.g., "result.count = 42" or "result.error.message = '404'"). Generic phrasing like "based on the result" wastes the evidence.
5. **Revise, don't ignore.** Use `isRevision: true` + `revisesStep: N` to correct an earlier step. After 3+ revisions of the same step, branch into an alternative instead.
6. **Branch when stuck.** Use `branchFromStep: N` + `branchId: "alt-1"` to explore a competing hypothesis. Branches live alongside the main flow and can be merged later.
7. **Keep `toolCall.parameters` concrete and minimal.** Empty queries, vague filters, or duplicated parameters waste the host's tool budget.
8. **Read `qualitySignals` on every response.** `convergence` rises as the model converges on an answer; `evidenceCoverage` rises as analysis steps are backed by successful tool calls; `hypothesisCoherence` rises as steps stop oscillating. A score below 0.3 on any of them is a hint to integrate more evidence before stopping.
9. **If a tool call fails, retry or switch tools.** Do not flip `nextStepNeeded` to `false` after a single failure — the `nextHint` for that pattern is explicit.
10. **Only set `nextStepNeeded=false` when truly satisfied with the integrated answer.** Premature termination is the most common failure mode for this tool.

### Tip: prompt template for a fresh call

```
Use interleaved-thinking to solve: <one-sentence problem statement>.

Hypothesis: <state the falsifiable claim you will verify first>.
Verification plan: <which tool + which parameters will confirm or refute>.
If the hypothesis fails: <branch into which alternative hypothesis>.
Stop condition: <what does "integrated answer" look like for this task?>.
```

### Tip: prompt template for handling a tool failure

```
Tool <toolName> returned error: <paste error.message>.
Recovery options:
  (a) Retry with adjusted parameters: <proposed new params>.
  (b) Switch to alternative tool: <toolName + why it would work>.
  (c) Branch into alternative hypothesis: <branchId + new claim>.
Do NOT mark nextStepNeeded=false yet — integrate the failure first.
```

### Tip: prompt template for deciding to branch

```
I have revised step <N> 3+ times without convergence.
Quality signals: convergence=<X>, hypothesisCoherence=<Y> (both low).
Action: branchFromStep=<N>, branchId="<descriptive-id>",
        new hypothesis=<competing claim worth exploring>.
```

## Reading the response

Every response carries:

| Field          | Meaning                                                                 |
| -------------- | ----------------------------------------------------------------------- |
| `stepNumber`   | Echo of your input                                                       |
| `totalSteps`   | Echo (auto-bumped to `stepNumber` if you exceed it)                      |
| `nextStepNeeded` | Echo                                                                       |
| `phase`        | Resolved phase (explicit or inferred)                                    |
| `nextHint`     | System-level guidance for your next call (includes `Tip` and Warning: flags) |
| `branches`     | Active branch IDs                                                        |
| `stepHistoryLength` | Total steps processed (server-side)                                  |
| `toolResult`   | Present after `tool_call` or `analysis`; `status` is `pending`/`executed`/`error` |
| `qualitySignals` | `{convergence, evidenceCoverage, hypothesisCoherence}`, all in [0, 1]    |
| `qualityWarning` | Optional string; present when `nextStepNeeded=false` but quality is low  |

## Quick manual verification

To verify the tool is wired correctly:

```bash
# 1. Install MCP Inspector (one-off)
npx -y @modelcontextprotocol/inspector --help

# 2. Start the inspector pointing at this server
npx -y @modelcontextprotocol/inspector node dist/index.js

# 3. In the inspector UI:
#    - Connect to stdio transport
#    - Open the "Tools" tab → click "List Tools" → expect 1 tool: interleaved-thinking
#    - Open the "Resources" tab → click "List Resources" → expect 2 entries:
#        interleaved://history/current
#        interleaved://branches/list
#    - Open the "Prompts" tab → expect 0 entries (this server registers no prompts)
#    - Switch to "Tools" → call interleaved-thinking with:
#        { "thought": "smoke test", "stepNumber": 1, "totalSteps": 1, "nextStepNeeded": false }
#      → expect phase="thinking", nextHint contains "Tip:", qualitySignals populated
```

If any of the above steps deviate, file a bug at https://github.com/jochenyang/interleaved-thinking/issues.
