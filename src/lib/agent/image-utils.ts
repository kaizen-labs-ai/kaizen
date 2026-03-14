/**
 * Image extraction and artifact saving for multimodal model responses.
 * Used by the image generation short-circuit in the orchestrator.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import { getRunArtifactsDir, toRelativePath, toAbsolutePath } from "@/lib/workspace";
import type { ContentPart } from "@/lib/openrouter/client";

export interface ExtractedImage {
  base64: string;
  mimeType: string;
  index: number;
}

/**
 * Extract image parts from a multimodal response.
 * Handles base64 data URIs in image_url content parts.
 */
export function extractImageParts(parts: ContentPart[]): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  let idx = 0;
  for (const part of parts) {
    if (part.type === "image_url" && "image_url" in part && part.image_url?.url) {
      const match = part.image_url.url.match(/^data:(image\/[\w+]+);base64,(.+)$/);
      if (match) {
        images.push({ base64: match[2], mimeType: match[1], index: idx++ });
      }
    }
  }
  return images;
}

/**
 * Save extracted images as artifacts on disk and in DB.
 * Returns markdown image references for embedding in chat.
 */
export async function saveImageArtifacts(
  images: ExtractedImage[],
  runId: string,
): Promise<string[]> {
  const runDir = await getRunArtifactsDir(runId);
  const markdownRefs: string[] = [];

  for (const img of images) {
    const ext = img.mimeType.split("/")[1]?.replace("+xml", "") || "png";
    const filename = images.length === 1
      ? `generated-image.${ext}`
      : `generated-image-${img.index + 1}.${ext}`;
    const filePath = path.join(runDir, filename);

    const buffer = Buffer.from(img.base64, "base64");
    await fs.writeFile(filePath, buffer);
    const stats = await fs.stat(filePath);

    const artifact = await prisma.artifact.create({
      data: {
        runId,
        filename,
        diskPath: toRelativePath(filePath),
        mimeType: img.mimeType,
        sizeBytes: stats.size,
        category: "file",
        summary: "AI-generated image",
      },
    });

    markdownRefs.push(`![Generated image](/api/artifacts/${artifact.id}/download?inline=1)`);
  }

  return markdownRefs;
}

export interface PreviousImageArtifact {
  base64: string;
  mimeType: string;
  artifactId: string;
  filename: string;
}

/**
 * Find image artifacts from previous runs in the same chat.
 * Used for multi-turn image editing — sends previous images back
 * to the model alongside the edit instruction.
 *
 * Returns ALL images when multiple exist (e.g. a mosaic of 6 images)
 * so the model can identify which one the user wants to edit.
 * Returns a single image when only one exists.
 * Returns empty array if none found.
 */
export async function findPreviousImageArtifacts(
  chatId: string | undefined,
  currentRunId: string,
): Promise<PreviousImageArtifact[]> {
  if (!chatId) return [];

  // Find all prior runIds in this chat (via messages that have a runId)
  const priorMessages = await prisma.message.findMany({
    where: {
      chatId,
      runId: { not: null },
      NOT: { runId: currentRunId },
    },
    select: { runId: true },
    distinct: ["runId"],
    orderBy: { createdAt: "desc" },
  });

  const priorRunIds = priorMessages
    .map((m) => m.runId)
    .filter((id): id is string => id !== null);

  if (priorRunIds.length === 0) return [];

  // Find ALL image artifacts from prior runs (most recent run first)
  const artifacts = await prisma.artifact.findMany({
    where: {
      runId: { in: priorRunIds },
      mimeType: { startsWith: "image/" },
      intermediate: false,
    },
    orderBy: { createdAt: "desc" },
  });

  if (artifacts.length === 0) return [];

  const results: PreviousImageArtifact[] = [];
  for (const artifact of artifacts) {
    try {
      const absPath = toAbsolutePath(artifact.diskPath);
      const buffer = await fs.readFile(absPath);
      results.push({
        base64: buffer.toString("base64"),
        mimeType: artifact.mimeType,
        artifactId: artifact.id,
        filename: artifact.filename,
      });
    } catch {
      // File missing from disk — skip silently
    }
  }

  return results;
}

const VALID_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"] as const;

/**
 * Detect aspect ratio intent from the user's message and chat history.
 * Returns an OpenRouter-compatible aspect ratio string, or undefined.
 */
export function detectAspectRatio(
  userMessage: string,
  chatHistory: { role: string; content: string }[],
): string | undefined {
  // Combine current message + recent assistant/user text for context
  const text = [
    ...chatHistory.slice(-4).map((m) => typeof m.content === "string" ? m.content : ""),
    userMessage,
  ].join(" ").toLowerCase();

  // Explicit ratio mentions like "16:9", "4:3", etc.
  const ratioMatch = text.match(/(\d{1,2}):(\d{1,2})/g);
  if (ratioMatch) {
    // Check from the end (most recent mention wins)
    for (let i = ratioMatch.length - 1; i >= 0; i--) {
      if ((VALID_RATIOS as readonly string[]).includes(ratioMatch[i])) {
        return ratioMatch[i];
      }
    }
  }

  // Natural language hints — check the current user message only
  const msg = userMessage.toLowerCase();
  if (/\b(wider|wide|landscape|horizontal|panoram|widescreen|cinematic)\b/.test(msg)) return "16:9";
  if (/\b(taller|tall|portrait|vertical|story|stories|phone)\b/.test(msg)) return "9:16";
  if (/\b(square)\b/.test(msg)) return "1:1";
  if (/\b(ultrawide|ultra.wide)\b/.test(msg)) return "21:9";

  return undefined;
}
