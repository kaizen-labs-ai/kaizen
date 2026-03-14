type LogEvent =
  | { type: "log-created" }
  | { type: "logs-cleared" };

type Listener = (event: LogEvent) => void;

class LogEventEmitter {
  private listeners = new Set<Listener>();

  emit(event: LogEvent) {
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

// Singleton (same pattern as chat events)
const globalForEvents = globalThis as unknown as {
  logEventEmitter: LogEventEmitter | undefined;
};

export const logEvents =
  globalForEvents.logEventEmitter ?? new LogEventEmitter();

if (process.env.NODE_ENV !== "production") {
  globalForEvents.logEventEmitter = logEvents;
}
