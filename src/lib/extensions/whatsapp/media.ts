import { prisma } from "@/lib/db/prisma";
import { toAbsolutePath } from "@/lib/workspace";
import { promises as fs } from "node:fs";
import { createLog } from "@/lib/logs/logger";
import { formatForMessaging } from "@/lib/extensions/format";

type ArtifactRow = {
  id: string;
  filename: string;
  mimeType: string;
  diskPath: string;
};

/**
 * Forward a run's output to WhatsApp: formatted text + ALL artifacts as native media.
 *
 * - Converts markdown to WhatsApp-friendly plain text (links → URLs, bold, etc.)
 * - Strips artifact refs from text (they're sent as native media instead)
 * - Sends ALL non-intermediate artifacts — images inline, other files as documents
 * - Falls back to text-only if no runId or no artifacts
 */
export async function forwardRunToWhatsApp(
  jid: string,
  text: string,
  runId: string | null,
  responsePrefix: string,
): Promise<void> {
  const { whatsappGateway } = await import("./gateway");

  // Fetch ALL non-intermediate artifacts for this run
  let artifacts: ArtifactRow[] = [];
  if (runId) {
    try {
      artifacts = await prisma.artifact.findMany({
        where: { runId, intermediate: false, category: { in: ["file", "data"] } },
        select: { id: true, filename: true, mimeType: true, diskPath: true },
      });
    } catch {
      // Best-effort — continue with text only
    }
  }

  // Format text for messaging (strips artifact refs, converts markdown)
  const { text: cleanedText } = formatForMessaging(text);

  // Send cleaned text with prefix (if there's content left after stripping)
  // responsePrefix is a raw name (e.g. "Kaizen") — always wrap in brackets.
  if (cleanedText) {
    const formattedPrefix = responsePrefix ? `[${responsePrefix}] ` : "";
    const prefixed = `${formattedPrefix}${cleanedText}`;
    await whatsappGateway.sendMessage(jid, prefixed);
  }

  // Send ALL artifacts as native media
  for (const artifact of artifacts) {
    await sendArtifact(jid, artifact);
  }
}

async function sendArtifact(jid: string, artifact: ArtifactRow): Promise<void> {
  const { whatsappGateway } = await import("./gateway");

  try {
    const absolutePath = toAbsolutePath(artifact.diskPath);
    const buffer = await fs.readFile(absolutePath);

    if (artifact.mimeType.startsWith("image/")) {
      await whatsappGateway.sendImage(jid, buffer, artifact.filename);
    } else if (artifact.mimeType.startsWith("video/")) {
      await whatsappGateway.sendVideo(jid, buffer, artifact.filename, artifact.mimeType);
    } else if (artifact.mimeType.startsWith("audio/")) {
      await whatsappGateway.sendAudio(jid, buffer, artifact.mimeType);
    } else {
      await whatsappGateway.sendDocument(jid, buffer, artifact.filename, artifact.mimeType);
    }
  } catch (err) {
    createLog("warn", "whatsapp", `Failed to send artifact ${artifact.filename}: ${(err as Error).message}`, {
      artifactId: artifact.id,
    }).catch(() => {});
  }
}
