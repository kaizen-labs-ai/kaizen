import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
  type BaileysEventMap,
} from "baileys";
import { Boom } from "@hapi/boom";
import path from "node:path";
import { promises as fs } from "node:fs";
import { prisma } from "@/lib/db/prisma";
import { parseWhatsAppConfig } from "./types";

const AUTH_DIR = path.join(process.cwd(), "data", "whatsapp-auth");

type QRCallback = (qr: string) => void;
type StatusCallback = (status: string) => void;
type MessageCallback = (messages: BaileysEventMap["messages.upsert"]) => void;

export class WhatsAppGateway {
  private sock: WASocket | null = null;
  private saveCreds: (() => Promise<void>) | null = null;
  private qrCallbacks = new Set<QRCallback>();
  private statusCallbacks = new Set<StatusCallback>();
  private messageCallbacks = new Set<MessageCallback>();
  private _status: "disconnected" | "connecting" | "connected" = "disconnected";
  private _connectingPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private conflictRetries = 0;
  private intentionalDisconnect = false;
  private messageHandlerWired = false;
  private static MAX_RECONNECT_ATTEMPTS = 8;
  private static MAX_CONFLICT_RETRIES = 1;

  get status() {
    return this._status;
  }

  /** Subscribe to QR code events during pairing. */
  onQR(cb: QRCallback) {
    this.qrCallbacks.add(cb);
    return () => this.qrCallbacks.delete(cb);
  }

  /** Subscribe to status changes. */
  onStatus(cb: StatusCallback) {
    this.statusCallbacks.add(cb);
    return () => this.statusCallbacks.delete(cb);
  }

  /** Subscribe to incoming messages. */
  onMessage(cb: MessageCallback) {
    this.messageCallbacks.add(cb);
    return () => this.messageCallbacks.delete(cb);
  }

  /** Wire the message handler exactly once (survives SSE disconnect). */
  async ensureMessageHandler(): Promise<void> {
    if (this.messageHandlerWired) return;
    this.messageHandlerWired = true;

    const { handleIncomingMessages } = await import("./message-handler");
    this.onMessage((upsert) => {
      handleIncomingMessages(upsert, this).catch((err) => {
        console.error("[whatsapp] message handler error:", err);
      });
    });
  }

  /** Connect to WhatsApp. If already connected, no-op. Mutex prevents concurrent connects. */
  async connect(): Promise<void> {
    if (this.sock && this._status === "connected") return;
    // If a previous connect is still hanging, force-reset so we don't block forever
    if (this._connectingPromise) {
      if (this._status === "connecting") {
        // Already connecting — wait for it
        return this._connectingPromise;
      }
      // Stale promise (status changed but promise wasn't cleared) — reset
      this._connectingPromise = null;
    }
    // Clean up any dead socket from a previous failed attempt
    if (this.sock && this._status === "disconnected") {
      this.sock.end(undefined);
      this.sock = null;
    }
    this._connectingPromise = this._doConnect();
    try { await this._connectingPromise; } finally { this._connectingPromise = null; }
  }

  private async _doConnect(): Promise<void> {
    this.intentionalDisconnect = false;
    // Clear any pending reconnect timer to prevent stale timer races
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.setStatus("connecting");
    await this.ensureMessageHandler();

    await fs.mkdir(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    this.saveCreds = saveCreds;

    // Fetch the latest WA Web version — the hardcoded default goes stale
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      auth: state,
      version,
      browser: Browsers.macOS("Chrome"),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldIgnoreJid: () => false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getMessage: async () => undefined as any,
    });

    this.sock = sock;

    sock.ev.on("creds.update", () => {
      this.saveCreds?.();
    });

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        for (const cb of this.qrCallbacks) cb(qr);
      }

      if (connection === "open") {
        // Ignore events from a stale socket (replaced by a newer connect() call)
        if (this.sock !== sock) return;
        this.reconnectAttempt = 0;
        this.conflictRetries = 0;
        console.log("[whatsapp] connected successfully");
        const phoneNumber = sock.user?.id?.split(":")[0] ?? null;
        const lid = sock.user?.lid?.split("@")[0]?.split(":")[0] ?? null;
        await this.setStatus("connected");

        // Update extension record with phone number and LID
        try {
          const ext = await prisma.extension.findUnique({ where: { type: "whatsapp" } });
          if (ext) {
            const config = parseWhatsAppConfig(ext.config);
            config.phoneNumber = phoneNumber;
            if (lid) config.lid = lid;
            await prisma.extension.update({
              where: { type: "whatsapp" },
              data: { config: JSON.stringify(config) },
            });
          }
        } catch {
          // Non-critical — config update can fail silently
        }
      }

      if (connection === "close") {
        // Ignore events from a stale socket (replaced by a newer connect() call)
        if (this.sock !== sock) return;
        this.sock = null;
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const reason = (lastDisconnect?.error as Boom)?.message ?? "unknown";
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const replaced = statusCode === DisconnectReason.connectionReplaced;

        console.log(`[whatsapp] connection closed — code=${statusCode} reason="${reason}" intentional=${this.intentionalDisconnect}`);

        if (loggedOut || this.intentionalDisconnect) {
          // Terminal: user logged out or intentional disconnect
          await this.setStatus("disconnected");
          this.conflictRetries = 0;
          if (loggedOut) {
            await fs.rm(AUTH_DIR, { recursive: true, force: true }).catch(() => {});
          }
        } else if (replaced) {
          // Conflict (440): retry once after a delay, then give up
          if (this.conflictRetries < WhatsAppGateway.MAX_CONFLICT_RETRIES) {
            this.conflictRetries++;
            console.log(`[whatsapp] conflict detected — retry ${this.conflictRetries}/${WhatsAppGateway.MAX_CONFLICT_RETRIES} in 5s`);
            await this.setStatus("connecting");
            this.reconnectTimer = setTimeout(() => this.connect(), 5_000);
          } else {
            console.log("[whatsapp] conflict persists — giving up (old session may still be active)");
            await this.setStatus("disconnected");
            this.conflictRetries = 0;
          }
        } else if (this.reconnectAttempt >= WhatsAppGateway.MAX_RECONNECT_ATTEMPTS) {
          // Too many reconnect attempts — give up
          console.log(`[whatsapp] max reconnect attempts (${WhatsAppGateway.MAX_RECONNECT_ATTEMPTS}) reached — giving up`);
          await this.setStatus("disconnected");
        } else {
          // Transient error — reconnect with exponential backoff
          this.reconnectAttempt++;
          const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 60_000);
          console.log(`[whatsapp] reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
          await this.setStatus("connecting");
          this.reconnectTimer = setTimeout(() => this.connect(), delay);
        }
      }
    });

    sock.ev.on("messages.upsert", (upsert) => {
      if (upsert.type !== "notify") return;
      for (const cb of this.messageCallbacks) cb(upsert);
    });
  }

  /** Disconnect from WhatsApp. */
  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    await this.setStatus("disconnected");
  }

  /** Logout: disconnect and clear auth state.
   *  If the socket is dead, reconnects briefly to tell WhatsApp
   *  to de-register this device before wiping local auth.
   */
  async logout(): Promise<void> {
    // If not connected, reconnect briefly so we can send the logout command
    if (!this.sock) {
      const authExists = await fs
        .stat(path.join(AUTH_DIR, "creds.json"))
        .then(() => true)
        .catch(() => false);
      if (authExists) {
        try {
          await this._doConnect();
          await this.waitForSettled(10_000);
        } catch {
          // Best-effort — if reconnect fails, proceed with local cleanup
        }
      }
    }
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {
        // Already logged out or socket dead
      }
    }
    await this.disconnect();
    await fs.rm(AUTH_DIR, { recursive: true, force: true }).catch(() => {});
  }

  /** Send a text message, chunking at 4000 chars. Tracks sent IDs to avoid self-chat loops. */
  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.sock) throw new Error("WhatsApp not connected");

    // Lazy-import to avoid circular dep at module load
    const { trackSentMessageId } = await import("./message-handler");

    const CHUNK_SIZE = 4000;
    const chunks =
      text.length <= CHUNK_SIZE
        ? [text]
        : text.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, "g")) ?? [text];

    for (const chunk of chunks) {
      const sent = await this.sock.sendMessage(jid, { text: chunk });
      if (sent?.key?.id) trackSentMessageId(sent.key.id);
    }
  }

  /** Send an image with optional caption. Tracks sent IDs for self-chat loop prevention. */
  async sendImage(jid: string, buffer: Buffer, caption?: string): Promise<void> {
    if (!this.sock) throw new Error("WhatsApp not connected");
    const { trackSentMessageId } = await import("./message-handler");
    const sent = await this.sock.sendMessage(jid, { image: buffer, caption });
    if (sent?.key?.id) trackSentMessageId(sent.key.id);
  }

  /** Send a document with filename and mimeType. Tracks sent IDs for self-chat loop prevention. */
  async sendDocument(
    jid: string,
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    caption?: string,
  ): Promise<void> {
    if (!this.sock) throw new Error("WhatsApp not connected");
    const { trackSentMessageId } = await import("./message-handler");
    const sent = await this.sock.sendMessage(jid, {
      document: buffer,
      fileName,
      mimetype: mimeType,
      caption,
    });
    if (sent?.key?.id) trackSentMessageId(sent.key.id);
  }

  /** Send a video. Tracks sent IDs for self-chat loop prevention. */
  async sendVideo(jid: string, buffer: Buffer, caption?: string, mimeType?: string): Promise<void> {
    if (!this.sock) throw new Error("WhatsApp not connected");
    const { trackSentMessageId } = await import("./message-handler");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sent = await this.sock.sendMessage(jid, { video: buffer, caption, mimetype: mimeType } as any);
    if (sent?.key?.id) trackSentMessageId(sent.key.id);
  }

  /** Send audio. Tracks sent IDs for self-chat loop prevention. */
  async sendAudio(jid: string, buffer: Buffer, mimeType?: string): Promise<void> {
    if (!this.sock) throw new Error("WhatsApp not connected");
    const { trackSentMessageId } = await import("./message-handler");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sent = await this.sock.sendMessage(jid, { audio: buffer, mimetype: mimeType } as any);
    if (sent?.key?.id) trackSentMessageId(sent.key.id);
  }

  /** Send a reaction emoji on a message. */
  async sendReaction(
    jid: string,
    messageKey: { remoteJid?: string | null; id?: string | null; fromMe?: boolean | null },
    emoji: string,
  ): Promise<void> {
    if (!this.sock) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await this.sock.sendMessage(jid, { react: { text: emoji, key: messageKey } } as any);
  }

  /** Download media (image, video, audio, document) from a WhatsApp message. */
  async downloadMedia(msg: WAMessage): Promise<Buffer | null> {
    if (!this.sock) return null;
    try {
      return await downloadMediaMessage(msg, "buffer", {});
    } catch {
      return null;
    }
  }

  /** Get the connected user's JID, or null. */
  getUserJid(): string | null {
    return this.sock?.user?.id ?? null;
  }

  /** Get the connected user's LID (Linked Identity), or null. */
  getUserLid(): string | null {
    return this.sock?.user?.lid ?? null;
  }

  /**
   * Resolve a LID to a phone number using Baileys' stored LID mapping.
   * Returns null if no mapping is found.
   */
  async resolvePhoneForLid(lid: string): Promise<string | null> {
    try {
      const mappingPath = path.join(AUTH_DIR, `lid-mapping-${lid}_reverse.json`);
      const data = await fs.readFile(mappingPath, "utf-8");
      return JSON.parse(data) || null;
    } catch {
      return null;
    }
  }

  /**
   * Wait for the gateway to reach a settled state (connected or disconnected).
   * Resolves immediately if already settled. Used by boot to block until
   * the connection completes, so the API returns the definitive status.
   */
  waitForSettled(timeoutMs = 10_000): Promise<"connected" | "disconnected"> {
    if (this._status !== "connecting") {
      return Promise.resolve(this._status as "connected" | "disconnected");
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsub();
        resolve(this._status === "connected" ? "connected" : "disconnected");
      }, timeoutMs);
      const unsub = this.onStatus((status) => {
        if (status !== "connecting") {
          clearTimeout(timer);
          unsub();
          resolve(status as "connected" | "disconnected");
        }
      });
    });
  }

  /** Get the display name of a group chat, or null if unavailable. */
  async getGroupName(groupJid: string): Promise<string | null> {
    if (!this.sock) return null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = await (this.sock as any).groupMetadata(groupJid);
      return meta?.subject ?? null;
    } catch {
      return null;
    }
  }

  private async setStatus(status: "disconnected" | "connecting" | "connected") {
    this._status = status;
    for (const cb of this.statusCallbacks) cb(status);

    // Persist to DB
    try {
      await prisma.extension.updateMany({
        where: { type: "whatsapp" },
        data: { status },
      });
    } catch {
      // DB write may fail during shutdown — ignore
    }
  }
}

// Singleton (same pattern as Prisma client)
const globalForWA = globalThis as unknown as {
  whatsappGateway: WhatsAppGateway | undefined;
  whatsappBooted: boolean | undefined;
};

export const whatsappGateway =
  globalForWA.whatsappGateway ?? new WhatsAppGateway();

// Always save to globalThis — unlike Prisma (which only needs HMR protection),
// WhatsApp needs a true singleton because the live socket must be shared
// across all server components and API routes in the same process.
globalForWA.whatsappGateway = whatsappGateway;

/**
 * Boot WhatsApp if the extension is enabled and has auth state from a previous session.
 * Called lazily on first API hit (not during module load to avoid blocking startup).
 * The booted flag is on globalThis so it survives HMR (module-level `let` resets on HMR).
 */
export async function bootWhatsAppIfEnabled(): Promise<void> {
  if (globalForWA.whatsappBooted) return;
  globalForWA.whatsappBooted = true;

  try {
    const ext = await prisma.extension.findUnique({ where: { type: "whatsapp" } });
    if (!ext?.enabled) return;

    // Only auto-connect if there's existing auth state (previously paired)
    const authExists = await fs
      .stat(path.join(AUTH_DIR, "creds.json"))
      .then(() => true)
      .catch(() => false);

    if (authExists) {
      await whatsappGateway.connect();
      // Wait for the connection to settle so the caller gets a definitive status.
      // Typically resolves in 2-3s. Times out at 10s if Baileys can't connect.
      await whatsappGateway.waitForSettled(10_000);
    }
  } catch (err) {
    console.error("[whatsapp] boot error:", err);
  }
}
