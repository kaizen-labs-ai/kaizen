type StepPayload = { type: string; content: unknown; toolId?: string; createdAt?: string };

type ChatEvent =
  | { type: "chat-created" | "chat-updated" | "chat-unread"; chatId?: string }
  | { type: "trigger-message"; chatId: string; content: string }
  | { type: "run-started"; chatId: string; runId: string }
  | { type: "run-activity"; chatId: string; label: string }
  | { type: "run-step"; chatId: string; step: StepPayload }
  | { type: "run-delta"; chatId: string; text: string }
  | { type: "run-complete"; chatId: string; runId: string }
  | { type: "run-error"; chatId: string; error: string };

type Listener = (event: ChatEvent) => void;

class ChatEventEmitter {
  private listeners = new Set<Listener>();

  emit(event: ChatEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Never let a bad listener break emitter
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

// Singleton (same pattern as Prisma/WhatsApp gateway)
const globalForEvents = globalThis as unknown as {
  chatEventEmitter: ChatEventEmitter | undefined;
};

export const chatEvents =
  globalForEvents.chatEventEmitter ?? new ChatEventEmitter();

if (process.env.NODE_ENV !== "production") {
  globalForEvents.chatEventEmitter = chatEvents;
}
