import { promises as fs } from "node:fs";
import path from "node:path";
import { guessMimeType } from "@/lib/workspace";
import type { ContentPart } from "@/lib/openrouter/client";
import { textPart, imagePart, filePart } from "@/lib/openrouter/client";

export type OutputModality = "text" | "image" | "file" | "audio" | "video" | "none";

export interface InspectedOutput {
  modality: OutputModality;
  contentParts: ContentPart[];
  filename: string;
}

/**
 * Inspect a single output file and prepare it for multimodal review.
 * Returns content parts suitable for sending to an OpenRouter model.
 */
export async function inspectOutputFile(filePath: string): Promise<InspectedOutput> {
  const filename = path.basename(filePath);
  const mimeType = guessMimeType(filename);

  // Determine modality from MIME type
  const modality = detectModality(mimeType);

  if (modality === "none") {
    return { modality: "none", contentParts: [], filename };
  }

  try {
    const parts: ContentPart[] = [];

    if (modality === "text") {
      const content = await fs.readFile(filePath, "utf-8");
      // Truncate very large text files for review
      const truncated = content.length > 10000
        ? content.slice(0, 10000) + "\n\n[... truncated at 10,000 characters ...]"
        : content;
      parts.push(textPart(`### File: ${filename}\n\n\`\`\`\n${truncated}\n\`\`\``));
    } else if (modality === "image") {
      const data = await fs.readFile(filePath);
      const base64 = data.toString("base64");
      parts.push(textPart(`### File: ${filename} (${mimeType})`));
      parts.push(imagePart(base64, mimeType, "high"));
    } else if (modality === "file" || modality === "audio" || modality === "video") {
      const data = await fs.readFile(filePath);
      const base64 = data.toString("base64");
      parts.push(textPart(`### File: ${filename} (${mimeType})`));
      parts.push(filePart(base64, mimeType, filename));
    }

    return { modality, contentParts: parts, filename };
  } catch {
    return { modality: "none", contentParts: [], filename };
  }
}

/**
 * Inspect multiple output files and return the "highest" modality found.
 * Priority: file > image > text > none
 */
export async function inspectOutputFiles(filePaths: string[]): Promise<{
  primaryModality: OutputModality;
  allInspections: InspectedOutput[];
}> {
  const inspections = await Promise.all(filePaths.map(inspectOutputFile));

  // Determine primary modality (highest complexity)
  const modalityPriority: Record<OutputModality, number> = {
    none: 0,
    text: 1,
    image: 2,
    audio: 3,
    video: 4,
    file: 5,
  };

  let primaryModality: OutputModality = "none";
  for (const insp of inspections) {
    if (modalityPriority[insp.modality] > modalityPriority[primaryModality]) {
      primaryModality = insp.modality;
    }
  }

  return { primaryModality, allInspections: inspections };
}

function detectModality(mimeType: string): OutputModality {
  // SVG is XML text, not a raster image — models can't render it as imagePart
  if (mimeType === "image/svg+xml") return "text";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "application/pdf") return "file";
  if (mimeType.startsWith("application/") && mimeType !== "application/json" && mimeType !== "application/xml") return "file";
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/xml") return "text";
  return "file"; // Unknown types go as file
}
