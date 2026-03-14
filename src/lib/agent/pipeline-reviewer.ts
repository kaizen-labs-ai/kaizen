/**
 * Pipeline reviewer phase — multimodal + code-only review of plugin output.
 */

import type { ContentPart } from "@/lib/openrouter/client";
import { textPart } from "@/lib/openrouter/client";
import { callOpenRouterWithRetry } from "@/lib/openrouter/retry";
import { inspectOutputFiles } from "@/lib/tools/output-inspector";
import { createLog } from "@/lib/logs/logger";
import {
  REVIEW_SCHEMA,
  parseJsonResponse,
  jsonFormat,
} from "./schemas";
import { selectReviewerModel } from "./pipeline-utils";
import type { RecordStepFn } from "./schemas";
import path from "node:path";

// ── Review prompt ──────────────────────────────────────────────

const PIPELINE_REVIEW_PROMPT = `You are a quality inspector. You PERCEIVE the output like a human would — you SEE, HEAR, or READ what was produced, and you describe what you observe.

## Your Role

Compare the actual output against the objective. For each requirement, report what you expected vs. what you actually perceive.

## How to Review

### For visual output (PDFs, images, documents):
- Describe the LAYOUT: columns, margins, spacing, alignment
- Describe the TYPOGRAPHY: font sizes, styles, readability
- Describe the CONTENT: what text appears, what is missing, what is cut off
- Describe the VISUAL QUALITY: colors, contrast, professional appearance
- Note rendering defects: overlapping text, broken elements, blank areas

### For audio output:
- Describe what you HEAR: speech clarity, music quality, timing
- Note audio defects: distortion, silence gaps, volume issues

### For text output:
- Describe content accuracy, completeness, and formatting

### For code-only (no output files available):
- Check that the code correctly implements all spec requirements
- Verify proper error handling and input validation
- Check that the output format matches what was specified

## Issue Format — CRITICAL

Each issue MUST follow this pattern:
"REQUIREMENT: [what the spec says] | OBSERVED: [what you actually see/hear] | GAP: [the specific difference]"

Example: "REQUIREMENT: Multi-column newspaper layout | OBSERVED: All text in a single centered column | GAP: No column layout implemented"

## Rules

- Be strict: every spec requirement and REQUIRED enhancement must be checked
- OPTIONAL (aspirational) enhancements are bonus — do NOT fail the review for them. If an OPTIONAL enhancement was attempted but is broken (e.g., buttons that don't work, missing JS functions), mention it as an issue but still PASS if all REQUIRED items work. A partially broken optional feature is not a reason to fail.
- If output is merely adequate but not impressive, FAIL it — but only for REQUIRED items
- NEVER suggest code changes, implementation approaches, or technical fixes
- NEVER reference functions, libraries, methods, or code patterns
- You are a PERCEIVER, not a programmer — describe problems in terms of what the output looks like, sounds like, or reads like
- An empty issues array with passed=true means the output is ready

You MUST respond with ONLY a valid JSON object:
{"passed": true/false, "issues": ["Issue 1", "Issue 2"], "summary": "Brief overall assessment"}`;

// ── Types ──────────────────────────────────────────────────────

export interface ReviewResult {
  passed: boolean;
  issues: string[];
  summary: string;
  reviewedOutput: string;
}

interface ReviewPhaseConfig {
  reviewerConfig: {
    model: string;
    thinking: boolean;
    timeout: number | null;
    imageModel?: string | null;
    fileModel?: string | null;
    audioModel?: string | null;
    videoModel?: string | null;
  };
  objectiveDescription: string;
  pluginContext: string;
  currentScript: string;
  executionOutputFiles: string[];
  attempt: number;
  toolName: string;
  pluginName: string;
  runId: string;
  recordStep: RecordStepFn;
  signal?: AbortSignal;
  /** Test inputs used for pipeline execution — reviewer should ignore placeholder content */
  testInputs?: Record<string, unknown>;
}

// ── Review Phase ───────────────────────────────────────────────

/**
 * Run the review phase — tries multimodal review first, falls back to code-only.
 * Returns review result, or null if both paths fail.
 */
export async function runReviewPhase(config: ReviewPhaseConfig): Promise<ReviewResult | null> {
  const {
    reviewerConfig, objectiveDescription, pluginContext,
    currentScript, executionOutputFiles, attempt, toolName, pluginName,
    runId, recordStep, signal, testInputs,
  } = config;

  createLog("debug", "orchestrator", `Pipeline review attempt ${attempt}`, { toolName, pluginName }, runId).catch(() => {});

  let specContext = `## Objective\n\n${objectiveDescription}\n\n${pluginContext}`;

  // Caveat: when pipeline runs with auto-generated sample inputs, the reviewer
  // should focus on structure/layout/functionality, not placeholder content.
  if (testInputs && Object.keys(testInputs).length > 0) {
    specContext += `\n\n## IMPORTANT: Sample Test Inputs\n\nThis plugin was executed with AUTO-GENERATED test inputs for validation:\n${JSON.stringify(testInputs, null, 2)}\n\nPlaceholder values like "Sample Document Title", "Sample Name", or generic text are EXPECTED and should NOT be flagged as issues. Focus your review on:\n- Structural correctness (layout, formatting, element positioning)\n- Functional correctness (does the code work as intended?)\n- Visual quality (colors, spacing, readability)\n- Output format correctness (right file type, not corrupt)`;
  }

  let reviewResult: ReviewResult | null = null;

  // Try multimodal review first (when we have output files)
  if (executionOutputFiles.length > 0) {
    try {
      const inspection = await inspectOutputFiles(executionOutputFiles);

      const multimodalModel = selectReviewerModel(
        reviewerConfig as { model: string; imageModel?: string | null; fileModel?: string | null; audioModel?: string | null; videoModel?: string | null },
        inspection.primaryModality,
      );

      const contentParts: ContentPart[] = [
        textPart(specContext),
        textPart("\n## Plugin Output\n\nReview the following output files produced by the plugin:"),
      ];

      for (const insp of inspection.allInspections) {
        if (insp.contentParts.length > 0) {
          contentParts.push(...insp.contentParts);
        }
      }

      contentParts.push(textPart(`\n## Developer Code (reference — may be truncated, do NOT flag truncation as an issue)\n\n\`\`\`\n${currentScript.slice(0, 6000)}\n\`\`\``));

      createLog("debug", "orchestrator", `Multimodal review: ${inspection.primaryModality} modality, ${executionOutputFiles.length} files, model: ${multimodalModel}`, { toolName, attempt }, runId).catch(() => {});

      const reviewResponse = await callOpenRouterWithRetry({
        model: multimodalModel,
        messages: [
          { role: "system", content: PIPELINE_REVIEW_PROMPT },
          { role: "user", content: contentParts },
        ],
        stream: false,
        thinking: reviewerConfig.thinking,
        response_format: jsonFormat(REVIEW_SCHEMA),
        meta: { agentId: "reviewer", runId },
      }, { signal, timeout: (reviewerConfig.timeout ?? 120) * 1000 });

      if (reviewResponse.content) {
        const parsed = parseJsonResponse<{ passed?: boolean; issues?: string[]; summary?: string }>(reviewResponse.content);
        if (parsed) {
          reviewResult = {
            passed: parsed.passed === true,
            issues: Array.isArray(parsed.issues) ? parsed.issues : [],
            summary: parsed.summary ?? "",
            reviewedOutput: "files",
          };
        }
      }
    } catch (multimodalErr) {
      createLog("warn", "orchestrator",
        `Multimodal review failed, falling back to code-only: ${multimodalErr instanceof Error ? multimodalErr.message : String(multimodalErr)}`,
        { toolName, attempt }, runId).catch(() => {});
    }
  }

  // Code-only review (primary path when no output files, or fallback)
  if (!reviewResult) {
    try {
      const codeReviewPrompt = [
        specContext,
        `\n## Developer Output\n\n${currentScript}`,
      ].join("\n\n");

      const reviewResponse = await callOpenRouterWithRetry({
        model: reviewerConfig.model,
        messages: [
          { role: "system", content: PIPELINE_REVIEW_PROMPT },
          { role: "user", content: codeReviewPrompt },
        ],
        stream: false,
        thinking: reviewerConfig.thinking,
        response_format: jsonFormat(REVIEW_SCHEMA),
        meta: { agentId: "reviewer", runId },
      }, { signal, timeout: (reviewerConfig.timeout ?? 120) * 1000 });

      if (reviewResponse.content) {
        const parsed = parseJsonResponse<{ passed?: boolean; issues?: string[]; summary?: string }>(reviewResponse.content);
        if (parsed) {
          reviewResult = {
            passed: parsed.passed === true,
            issues: Array.isArray(parsed.issues) ? parsed.issues : [],
            summary: parsed.summary ?? "",
            reviewedOutput: "code",
          };
        }
      }
    } catch (codeReviewErr) {
      createLog("warn", "orchestrator",
        `Code-only review also failed: ${codeReviewErr instanceof Error ? codeReviewErr.message : String(codeReviewErr)}`,
        { toolName, attempt }, runId).catch(() => {});
    }
  }

  // Record review step
  if (reviewResult) {
    await recordStep("review", {
      agent: "reviewer",
      model: reviewerConfig.model,
      toolName,
      pluginName,
      passed: reviewResult.passed,
      issues: reviewResult.issues,
      summary: reviewResult.summary,
      attempt,
      reviewedOutput: reviewResult.reviewedOutput,
      outputFiles: executionOutputFiles.map((f) => path.basename(f)),
    });
  }

  return reviewResult;
}
