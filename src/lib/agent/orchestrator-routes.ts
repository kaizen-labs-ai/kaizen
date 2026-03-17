/**
 * Orchestrator route handlers: triage/routing + image generation short-circuit.
 * Extracted from orchestrator.ts to keep the main coordinator under 800 lines.
 */

import { prisma } from "@/lib/db/prisma";
import {
  callOpenRouter,
  type ChatMessage,
  type ContentPart,
  textPart,
  imagePart,
} from "@/lib/openrouter/client";
import { OutputRouter } from "./output-router";
import { extractImageParts, saveImageArtifacts, findPreviousImageArtifacts, detectAspectRatio } from "./image-utils";
import { callRouter } from "./phase-machine";
import { getAllSkills } from "@/lib/skills/registry";
import { createLog } from "@/lib/logs/logger";
import type { RunContactProfile } from "@/lib/extensions/contacts";

// ── Shared context for route handlers ─────────────────────────

export interface RouteContext {
  objective: { id: string; title: string; description: string };
  runId: string;
  chatId?: string;
  model?: string;
  objConfigModel?: string;
  chatHistory: ChatMessage[];
  uploadParts: ContentPart[];
  buildUserContent: (text: string) => string | ContentPart[];
  dbTools: Array<{
    id: string;
    name: string;
    description: string;
    type: string;
    inputSchema: string;
    memory: string | null;
  }>;
  getAgent: (id: string) => {
    model: string;
    systemPrompt: string;
    thinking: boolean;
    timeout: number | null;
    imageModel?: string | null;
    videoModel?: string | null;
    audioModel?: string | null;
  } | undefined;
  outputRouter: OutputRouter;
  recordStep: (type: string, content: unknown, toolId?: string) => Promise<void>;
  signal?: AbortSignal;
  contactProfile?: RunContactProfile;
  attachments?: Array<{ mimeType: string }>;
}

// ── Triage result ──────────────────────────────────────────────

export interface TriageResult {
  cancelled?: true;
  currentPhase: string;
  skillId: string | null;
  complexity: "simple" | "complex" | "image_generation";
  skillContextOnly: boolean;
  isConversational: boolean;
}

// ── Triage / routing phase ─────────────────────────────────────

/**
 * Handle the triage phase: classify the objective via router, skill shortcut,
 * or plugin shortcut. Mutates `objective` and `uploadParts` in-place when
 * audio transcription occurs.
 */
export async function handleTriagePhase(params: {
  objective: { id: string; title: string; description: string; phase: string | null; skillId: string | null };
  config: {
    skillId?: string;
    pluginId?: string;
    signal?: AbortSignal;
    attachments?: Array<{ uploadId: string; filename: string; mimeType: string }>;
    contactProfile?: RunContactProfile;
  };
  objConfig: Record<string, unknown>;
  runId: string;
  isFollowUp: boolean;
  uploadParts: ContentPart[];
  chatHistory: ChatMessage[];
  getAgent: (id: string) => { model: string; thinking: boolean; timeout: number; systemPrompt: string; audioModel?: string | null } | undefined;
  recordStep: (type: string, content: unknown, toolId?: string) => Promise<void>;
  onComplete: (runId: string) => void | Promise<void>;
}): Promise<TriageResult> {
  const { objective, config, objConfig, runId, isFollowUp, uploadParts, chatHistory, getAgent, recordStep, onComplete } = params;

  let currentPhase = objective.phase ?? "triage";
  let skillId = objective.skillId;
  let complexity: "simple" | "complex" | "image_generation" = "simple";
  let skillContextOnly = false;
  let isConversational = false;

  // Not in triage or follow-up — return current state as-is
  if (currentPhase !== "triage" || isFollowUp) {
    return { currentPhase, skillId, complexity, skillContextOnly, isConversational };
  }

  // Check for cancellation before routing
  if (config.signal?.aborted) {
    await recordStep("cancelled", { message: "Stopped by user" });
    await prisma.run.update({
      where: { id: runId },
      data: { status: "cancelled", endedAt: new Date() },
    });
    await onComplete(runId);
    return { cancelled: true, currentPhase, skillId, complexity, skillContextOnly, isConversational };
  }

  // If skillId was explicitly provided (slash command), skip router
  if (config.skillId && !skillId) {
    skillId = config.skillId;
    currentPhase = "executing";
    complexity = "simple";

    await prisma.objective.update({
      where: { id: objective.id },
      data: {
        phase: currentPhase,
        skillId,
        config: JSON.stringify({ ...objConfig, complexity }),
      },
    });

    createLog("info", "router", `Skill forced via slash command: ${skillId}`, {
      objectiveId: objective.id,
    }, runId).catch(() => {});
  } else if (config.pluginId) {
    // Plugin shortcut — skip router, go straight to executing
    currentPhase = "executing";
    complexity = "simple";

    // Look up the plugin name so the executor knows which tool to call
    const pluginTool = await prisma.tool.findUnique({
      where: { id: config.pluginId },
      select: { name: true },
    });

    if (pluginTool) {
      // Prepend a hint to the objective so the executor calls the right plugin
      const pluginHint = `[Run plugin: ${pluginTool.name}]\n\n`;
      if (!objective.description.startsWith(pluginHint)) {
        objective.description = pluginHint + objective.description;
      }
    }

    await prisma.objective.update({
      where: { id: objective.id },
      data: {
        phase: currentPhase,
        description: objective.description,
        config: JSON.stringify({ ...objConfig, complexity }),
      },
    });

    createLog("info", "router", `Plugin forced via shortcut: ${pluginTool?.name ?? config.pluginId}`, {
      objectiveId: objective.id,
    }, runId).catch(() => {});
  } else {
    const routerConfig = getAgent("router");
    if (!routerConfig) {
      throw new Error('Agent config "router" not found');
    }

    // Hide skills from router when contact doesn't have skill access
    const skillAccessAllowed = config.contactProfile?.permissions?.skillAccess !== false;
    const skills = skillAccessAllowed ? await getAllSkills() : [];
    // Append attachment hints so the router can classify correctly
    let routerDescription = objective.description;
    if (config.attachments?.length) {
      const fileList = config.attachments.map((a) => `${a.filename} (${a.mimeType})`).join(", ");
      routerDescription += `\n\n[Attached: ${fileList}]`;
    }

    // For audio-only messages (no user text), pass audio parts to the router
    // so it can transcribe and classify based on spoken content.
    const isAudioOnly = config.attachments?.some((a) => a.mimeType.startsWith("audio/"))
      && objective.description.includes("The user sent")
      && objective.description.includes("file(s)");
    const routerAudioParts = isAudioOnly
      ? uploadParts.filter((p) => p.type === "input_audio")
      : undefined;

    const routerResult = await callRouter(
      { title: objective.title, description: routerDescription },
      skills.map((s) => ({ id: s.id, name: s.name, description: s.description })),
      routerConfig,
      recordStep,
      chatHistory,
      config.signal,
      routerAudioParts,
    );

    currentPhase = routerResult.startPhase;
    complexity = routerResult.complexity;
    const updates: Record<string, unknown> = {
      phase: currentPhase,
      config: JSON.stringify({ ...objConfig, complexity }),
    };

    if (routerResult.skillId && !skillId) {
      skillId = routerResult.skillId;
      updates.skillId = routerResult.skillId;
      createLog("info", "router", `Matched skill ${routerResult.skillId}${routerResult.skillContextOnly ? " (context-only)" : ""}`, {
        objectiveId: objective.id,
      }, runId).catch(() => {});
    }
    if (routerResult.skillContextOnly) {
      skillContextOnly = true;
    }
    if (routerResult.isConversational) {
      isConversational = true;
    }

    // When the router transcribed an audio-only message, update the objective
    // description so downstream agents (executor, logs, title) see real text
    // instead of "The user sent 1 audio file(s)...". Also strip audio from
    // uploadParts since the executor doesn't need to re-process it.
    if (routerResult.transcription) {
      const transcription = routerResult.transcription;
      updates.description = transcription;
      updates.title = transcription.slice(0, 80);
      // Update in-place so the phase dispatch loop uses the transcription
      objective.description = transcription;
      objective.title = transcription.slice(0, 80);
      // Remove audio parts — executor gets the transcription text instead
      const nonAudioParts = uploadParts.filter((p) => p.type !== "input_audio");
      uploadParts.length = 0;
      for (const p of nonAudioParts) uploadParts.push(p);
    }

    await prisma.objective.update({
      where: { id: objective.id },
      data: updates,
    });

    createLog("info", "router", `Classified as ${routerResult.complexity} → ${currentPhase}${isConversational ? " (conversational)" : ""}`, {
      objectiveId: objective.id,
      complexity: routerResult.complexity,
      startPhase: currentPhase,
      skillId: routerResult.skillId,
    }, runId).catch(() => {});
  }

  return { currentPhase, skillId, complexity, skillContextOnly, isConversational };
}

// ── Image generation short-circuit ──────────────────────────────

/**
 * Handle image generation requests — single LLM call to an image-capable model.
 */
export async function handleImageGenerationRoute(ctx: RouteContext): Promise<void> {
  const imgConfig = ctx.getAgent("image-generator");
  if (!imgConfig) {
    throw new Error('Agent config "image-generator" not found');
  }

  const imgModel = imgConfig.model ?? "google/gemini-2.5-flash-image";
  await ctx.recordStep("agent_handoff", { agent: "image-generator", phase: "generating_image", model: imgModel });

  // Multi-turn image editing: inject user-uploaded or previous image(s)
  const hasUploadedImage = ctx.uploadParts.some((p) => p.type === "image_url");
  const previousImages = hasUploadedImage
    ? []
    : await findPreviousImageArtifacts(ctx.chatId, ctx.runId);

  let userContent: string | ContentPart[];
  if (hasUploadedImage) {
    userContent = [textPart(ctx.objective.description), ...ctx.uploadParts];
  } else if (previousImages.length > 1) {
    userContent = [
      textPart(`${ctx.objective.description}\n\nThe images from this conversation are attached below.`),
      ...previousImages.map((img) => imagePart(img.base64, img.mimeType)),
    ];
  } else if (previousImages.length === 1) {
    userContent = [
      textPart(ctx.objective.description),
      imagePart(previousImages[0].base64, previousImages[0].mimeType),
    ];
  } else {
    userContent = ctx.objective.description;
  }

  const imgSystemPrompt = imgConfig.systemPrompt ?? "You are an image generation assistant. Generate images based on the user's description.";
  const imgMessages: ChatMessage[] = [
    { role: "system", content: imgSystemPrompt },
    ...ctx.chatHistory,
    { role: "user", content: userContent },
  ];

  await ctx.recordStep("prompt_snapshot", {
    agent: "image-generator",
    systemPrompt: imgSystemPrompt,
    userMessages: imgMessages.filter((m) => m.role !== "system").map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    })),
  });

  const aspectRatio = detectAspectRatio(
    ctx.objective.description,
    ctx.chatHistory.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" })),
  );

  const imgResponse = await callOpenRouter({
    model: imgModel,
    messages: imgMessages,
    modalities: ["image", "text"],
    image_config: aspectRatio ? { aspect_ratio: aspectRatio } : undefined,
    stream: false,
    signal: ctx.signal,
    timeout: (imgConfig.timeout ?? 180) * 1000,
    meta: { agentId: "image-generator", runId: ctx.runId },
  });

  let responseText = imgResponse.content || "";
  const markdownImages: string[] = [];

  if (imgResponse.multimodalContent) {
    const images = extractImageParts(imgResponse.multimodalContent);
    if (images.length > 0) {
      const refs = await saveImageArtifacts(images, ctx.runId);
      markdownImages.push(...refs);
    }
  }

  // Retry once if the model returned text but no image
  if (markdownImages.length === 0) {
    const retryResponse = await callOpenRouter({
      model: imgModel,
      messages: imgMessages,
      modalities: ["image", "text"],
      image_config: aspectRatio ? { aspect_ratio: aspectRatio } : undefined,
      stream: false,
      signal: ctx.signal,
      timeout: (imgConfig.timeout ?? 180) * 1000,
      meta: { agentId: "image-generator", runId: ctx.runId },
    });
    if (retryResponse.content) responseText = retryResponse.content;
    if (retryResponse.multimodalContent) {
      const images = extractImageParts(retryResponse.multimodalContent);
      if (images.length > 0) {
        const refs = await saveImageArtifacts(images, ctx.runId);
        markdownImages.push(...refs);
      }
    }
  }

  // If still no image after retry, inform the user instead of passing through hallucinated text
  if (markdownImages.length === 0) {
    responseText = "Image generation failed — the model did not return an image. Please try again.";
  }

  // Strip hallucinated artifact refs
  responseText = responseText
    .replace(/!\[.*?\]\(\/api\/artifacts\/[^)]+\)/g, "")
    .replace(/\[Image \d+:.*?\(artifact:[^)]+\)\]\s*<?image>?/g, "")
    .replace(/\[Image \d+:.*?\(artifact:[^)]+\)\]/g, "")
    .trim();

  const finalOutput = [responseText, ...markdownImages].filter(Boolean).join("\n\n");
  await ctx.recordStep("executor_summary", { text: finalOutput, agent: "image-generator" });

  await ctx.outputRouter.emit(finalOutput, { agentId: "image-generator" });

  await prisma.objective.update({
    where: { id: ctx.objective.id },
    data: { phase: "complete" },
  });
}
