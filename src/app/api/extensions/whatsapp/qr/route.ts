import { whatsappGateway } from "@/lib/extensions/whatsapp/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE endpoint: starts WhatsApp pairing and streams QR codes to the frontend.
 *
 * Events:
 *   qr        — { qr: string } — base64 QR code string for rendering
 *   connected — { phoneNumber: string } — pairing succeeded
 *   error     — { message: string } — fatal error
 */
export async function GET(req: Request) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let closed = false;

  function send(event: string, data: unknown) {
    if (closed) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    writer.write(encoder.encode(payload)).catch(() => {
      closed = true;
    });
  }

  // Subscribe to QR events (SSE-only — cleaned up when stream closes)
  const unsubQR = whatsappGateway.onQR((qr) => {
    send("qr", { qr });
  });

  // Subscribe to status changes (SSE-only)
  const unsubStatus = whatsappGateway.onStatus((status) => {
    if (status === "connected") {
      const phoneNumber = whatsappGateway.getUserJid()?.split(":")[0] ?? "unknown";
      send("connected", { phoneNumber });
      setTimeout(() => cleanup(), 500);
    }
  });

  function cleanup() {
    if (closed) return;
    closed = true;
    unsubQR();
    unsubStatus();
    // NOTE: message handler is NOT unsubscribed — it lives on the gateway permanently
    writer.close().catch(() => {});
  }

  req.signal.addEventListener("abort", cleanup);

  // Start connection — gateway.connect() also wires the message handler
  try {
    await whatsappGateway.connect();
  } catch (err) {
    send("error", { message: (err as Error).message });
    cleanup();
  }

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
