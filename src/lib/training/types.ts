/**
 * Types for the Deep Learning training pipeline.
 */

export interface DeepLearningConfig {
  enabled: boolean;
  status: "idle" | "training" | "optimized";
  objective: string;
  trainEveryN: number;
  runsSinceLastEpoch: number;
  convergenceThreshold: number;
  maxEpochs: number;
}

export const DEFAULT_DL_CONFIG: DeepLearningConfig = {
  enabled: false,
  status: "idle",
  objective: "",
  trainEveryN: 1,
  runsSinceLastEpoch: 0,
  convergenceThreshold: 3,
  maxEpochs: 50,
};

export function parseDeepLearningConfig(raw: string): DeepLearningConfig {
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: parsed.enabled ?? DEFAULT_DL_CONFIG.enabled,
      status: parsed.status ?? DEFAULT_DL_CONFIG.status,
      objective: parsed.objective ?? DEFAULT_DL_CONFIG.objective,
      trainEveryN: parsed.trainEveryN ?? DEFAULT_DL_CONFIG.trainEveryN,
      runsSinceLastEpoch: parsed.runsSinceLastEpoch ?? DEFAULT_DL_CONFIG.runsSinceLastEpoch,
      convergenceThreshold: parsed.convergenceThreshold ?? DEFAULT_DL_CONFIG.convergenceThreshold,
      maxEpochs: parsed.maxEpochs ?? DEFAULT_DL_CONFIG.maxEpochs,
    };
  } catch {
    return { ...DEFAULT_DL_CONFIG };
  }
}

export interface FitnessScores {
  completion_rate: number;
  error_rate: number;
  efficiency: number;
  quality: number;
  data_quality: number;
  composite: number;
}

export interface TrainerResponse {
  hypothesis: string;
  action:
    | "modify_instructions"
    | "add_guardrail"
    | "remove_guardrail"
    | "modify_guardrail"
    | "add_tool"
    | "remove_tool"
    | "create_plugin"
    | "edit_plugin"
    | "modify_db_schema"
    | "no_change";
  mutation: Record<string, unknown>;
  fitness: FitnessScores;
  converged: boolean;
  convergence_reason: string | null;
}

/** Summary of a run for the trainer's analysis context. */
export interface RunSummary {
  runId: string;
  sequence: number;
  status: string;
  startedAt: string;
  endedAt: string | null;
  stepCount: number;
  errorCount: number;
  toolsUsed: string[];
  errors: string[];
  outputSummary: string;
}
