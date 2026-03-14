/**
 * CLI Run Runner — test the full orchestration pipeline without a browser.
 *
 * Usage:
 *   npx tsx scripts/run.ts "what tools do you have?"
 *   npx tsx scripts/run.ts --keep "build a weather plugin"
 *   npx tsx scripts/run.ts --verbose "hello"
 *   npx tsx scripts/run.ts --chat <chatId> "follow-up message"
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load env BEFORE any app imports (need DATABASE_URL + OPENROUTER_API_KEY).
// Static imports are hoisted, so app modules must be dynamically imported below.
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
config({ path: resolve(root, ".env"), quiet: true });
config({ path: resolve(root, ".env.local"), override: true, quiet: true });

// ── Arg parsing ──────────────────────────────────────────────

const args = process.argv.slice(2);
let keep = false;
let verbose = false;
let chatId: string | undefined;

const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--keep") { keep = true; continue; }
  if (args[i] === "--verbose" || args[i] === "-v") { verbose = true; continue; }
  if (args[i] === "--chat" && args[i + 1]) { chatId = args[++i]; continue; }
  positional.push(args[i]);
}

const message = positional.join(" ").trim();
if (!message) {
  console.error("Usage: npx tsx scripts/run.ts [--keep] [--verbose] [--chat <id>] \"message\"");
  process.exit(1);
}

// ── Step formatting ──────────────────────────────────────────

function summarizeStep(type: string, content: unknown): string {
  const c = content as Record<string, unknown>;
  try {
    switch (type) {
      case "routing": {
        const raw = typeof c.raw === "string" ? JSON.parse(c.raw) : c;
        return `${raw.complexity ?? "?"} · ${raw.skillId || "no skill"} · ${raw.startPhase ?? "?"}`;
      }
      case "memory_retrieval":
        return `${c.lineCount ?? "?"} lines`;
      case "agent_handoff":
        return `→ ${c.agent ?? "?"} (${c.phase ?? "?"})`;
      case "agent_skipped":
        return `${c.agent ?? "?"} disabled`;
      case "tool_call":
        return `${c.name ?? c.tool ?? "?"}(${truncate(JSON.stringify(c.arguments ?? c.args ?? {}), 60)})`;
      case "tool_result":
        return truncate(JSON.stringify(c.result ?? c.output ?? c), 80);
      case "search": {
        const skill = c.matchedSkill as Record<string, unknown> | undefined;
        return skill ? `skill: ${skill.name ?? skill.id}` : `${c.toolsFound ?? "?"} tools`;
      }
      case "result":
        return truncate(JSON.stringify(c.data ?? c), 80);
      case "reasoning":
        return `${String(c.text ?? "").length} chars`;
      case "research":
        return `${c.agent ?? "researcher"} · ${c.researchToolCount ?? "?"} lookups`;
      case "reflection":
        return `${c.satisfied ? "pass" : "gaps found"}`;
      case "executor_summary":
        return `${String(c.text ?? "").length} chars`;
      case "developer_enhancement":
        return `attempt ${c.attempt ?? "?"}`;
      case "pipeline_execution":
        return `${c.success ? "pass" : "fail"}`;
      case "review":
        return `${c.verdict ?? c.passed ? "pass" : "fail"}`;
      case "pipeline_summary":
        return `${c.status ?? "?"}`;
      default:
        return truncate(JSON.stringify(content), 80);
    }
  } catch {
    return truncate(JSON.stringify(content), 80);
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function elapsed(start: number): string {
  return ((performance.now() - start) / 1000).toFixed(1).padStart(5) + "s";
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  // Dynamic imports — env vars are set by now
  const { prisma } = await import("@/lib/db/prisma");
  const { executeRun } = await import("@/lib/agent/orchestrator");
  type OrchestratorCallbacks = Parameters<typeof executeRun>[1];

  const LINE = "─".repeat(47);

  console.log(`─── run ${LINE.slice(8)}`);
  console.log(message);
  console.log();

  // Create objective
  const objective = await prisma.objective.create({
    data: { title: message.slice(0, 100), description: message },
  });

  // If --chat, save the user message into that chat
  if (chatId) {
    await prisma.message.create({
      data: { chatId, role: "user", content: message },
    });
  }

  const start = performance.now();
  let responseText = "";
  let stepCount = 0;
  let toolCalls = 0;
  let artifactCount = 0;
  let runId = "";

  const callbacks: OrchestratorCallbacks = {
    onRunCreated: (id) => { runId = id; },

    onStep: (step) => {
      stepCount++;
      if (step.type === "tool_call") toolCalls++;

      const time = elapsed(start);
      const type = step.type.padEnd(20);
      const summary = summarizeStep(step.type, step.content);
      console.log(`${time}  ${type}${summary}`);

      if (verbose) {
        const json = JSON.stringify(step.content, null, 2);
        for (const line of json.split("\n")) {
          console.log(`        ${line}`);
        }
      }
    },

    onDelta: (text) => { responseText += text; },

    onComplete: async (id) => {
      // Count artifacts
      try {
        const arts = await prisma.artifact.findMany({
          where: { runId: id, intermediate: false, category: "file" },
          select: { id: true, filename: true },
        });
        artifactCount = arts.length;
        if (arts.length > 0) {
          console.log();
          console.log(`─── artifacts ${LINE.slice(14)}`);
          for (const a of arts) console.log(`  ${a.filename}`);
        }
      } catch { /* best effort */ }

      // Print response
      console.log();
      console.log(`─── response ${LINE.slice(13)}`);
      console.log(responseText || "(no response text)");

      // Summary
      const total = elapsed(start);
      console.log();
      console.log(`─── done ${LINE.slice(9)}`);
      console.log(`${total} · ${stepCount} steps · ${toolCalls} tool calls · ${artifactCount} artifacts`);
      console.log(LINE);
    },

    onError: async (error) => {
      console.log();
      console.log(`─── error ${LINE.slice(10)}`);
      console.log(error);
      console.log(LINE);
    },
  };

  try {
    await executeRun({ objectiveId: objective.id, chatId }, callbacks);
  } catch (err) {
    console.error("\nFatal:", err);
  }

  // Cleanup unless --keep
  if (!keep) {
    await prisma.objective.delete({ where: { id: objective.id } }).catch(() => {});
  } else {
    console.log(`\nKept: objective ${objective.id}` + (runId ? ` · run ${runId}` : ""));
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
