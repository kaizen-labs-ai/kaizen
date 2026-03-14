import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import type { ToolExecutionResult, ContextualToolExecutorFn } from "../types";
import { getRunArtifactsDir, resolveArtifactPath, toRelativePath } from "@/lib/workspace";

export const downloadImageExecutorFactory: ContextualToolExecutorFn = (ctx) => {
  return async (input): Promise<ToolExecutionResult> => {
    const url = input.url as string;
    const filenameHint = input.filename as string | undefined;

    if (!url) {
      return { success: false, output: null, error: "url is required" };
    }

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return {
        success: false,
        output: null,
        error: "url must be an http:// or https:// URL. Data URIs and base64 strings are not supported — find the actual image URL from the page instead.",
      };
    }

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Kaizen/1.0" },
        redirect: "follow",
      });

      if (!res.ok) {
        return {
          success: false,
          output: null,
          error: `HTTP ${res.status} ${res.statusText}`,
        };
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) {
        return {
          success: false,
          output: null,
          error: `URL did not return an image (content-type: ${contentType})`,
        };
      }

      // Determine filename
      let filename = filenameHint ?? "";
      if (!filename) {
        // Try Content-Disposition header
        const disposition = res.headers.get("content-disposition") ?? "";
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match) {
          filename = match[1];
        } else {
          // Infer from URL path
          try {
            const urlPath = new URL(url).pathname;
            const base = path.basename(urlPath);
            if (base && /\.\w+$/.test(base)) {
              filename = base;
            }
          } catch {
            // fall through
          }
        }
      }

      // Fallback filename with correct extension from content-type
      if (!filename) {
        const extMap: Record<string, string> = {
          "image/jpeg": ".jpg",
          "image/png": ".png",
          "image/gif": ".gif",
          "image/webp": ".webp",
          "image/svg+xml": ".svg",
          "image/avif": ".avif",
          "image/bmp": ".bmp",
        };
        const ext = extMap[contentType.split(";")[0].trim()] ?? ".jpg";
        filename = `downloaded-image${ext}`;
      }

      const buffer = Buffer.from(await res.arrayBuffer());

      const runDir = await getRunArtifactsDir(ctx.runId);
      const resolved = resolveArtifactPath(runDir, filename);

      await fs.writeFile(resolved, buffer);
      const stats = await fs.stat(resolved);

      const diskPath = toRelativePath(resolved);
      const mimeType = contentType.split(";")[0].trim();

      const artifact = await prisma.artifact.create({
        data: {
          runId: ctx.runId,
          filename: path.basename(filename),
          diskPath,
          mimeType,
          sizeBytes: stats.size,
          category: "file",
          summary: `Image downloaded from ${new URL(url).hostname}`,
          metadata: JSON.stringify({ sourceUrl: url }),
        },
      });

      const markdown = `![Downloaded image](/api/artifacts/${artifact.id}/download?inline=1)`;

      return {
        success: true,
        output: {
          artifactId: artifact.id,
          filename: artifact.filename,
          bytesWritten: stats.size,
          markdown,
          message: `Image downloaded and saved as "${artifact.filename}"`,
        },
      };
    } catch (err) {
      return { success: false, output: null, error: (err as Error).message };
    }
  };
};
