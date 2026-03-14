export interface ToolExecutionResult {
  success: boolean;
  output: unknown;
  error?: string;
}

export type ToolExecutorFn = (input: Record<string, unknown>) => Promise<ToolExecutionResult>;

export interface ExecutionContext {
  objectiveId: string;
  runId: string;
  agentId?: string;
  contactId?: string;
  /** Accumulates secret values filled via use-secret during this run.
   *  All tool results are scrubbed of these values before the LLM sees them. */
  filledSecrets?: Set<string>;
  /** Abort signal from the parent run — tools should check this for cancellation. */
  signal?: AbortSignal;
  /** Step recorder for tools that need to surface internal progress. */
  recordStep?: (type: string, content: unknown, toolId?: string) => Promise<void>;
}

export type ContextualToolExecutorFn = (ctx: ExecutionContext) => ToolExecutorFn;
