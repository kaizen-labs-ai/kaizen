import { chatEvents } from "@/lib/events/chat-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE endpoint: pushes real-time chat events (new chat, unread) to the frontend.
 * The sidebar subscribes once and dispatches window events for all listeners.
 */
export async function GET(req: Request) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let closed = false;

  const unsub = chatEvents.subscribe((event) => {
    if (closed) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    writer.write(encoder.encode(payload)).catch(() => {
      closed = true;
    });
  });

  req.signal.addEventListener("abort", () => {
    closed = true;
    unsub();
    writer.close().catch(() => {});
  });

  // Keep-alive ping every 30s to prevent proxy/browser timeouts
  const keepAlive = setInterval(() => {
    if (closed) {
      clearInterval(keepAlive);
      return;
    }
    writer.write(encoder.encode(": ping\n\n")).catch(() => {
      closed = true;
      clearInterval(keepAlive);
    });
  }, 30_000);

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
