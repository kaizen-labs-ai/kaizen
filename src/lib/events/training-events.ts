type TrainingEvent =
  | { type: "epoch-started"; skillId: string; epoch: number }
  | { type: "epoch-completed"; skillId: string; epoch: number; fitness: number | null }
  | { type: "epoch-failed"; skillId: string; epoch: number }
  | { type: "status-changed"; skillId: string; status: string };

type Listener = (event: TrainingEvent) => void;

class TrainingEventEmitter {
  private listeners = new Set<Listener>();

  emit(event: TrainingEvent) {
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

const globalForEvents = globalThis as unknown as {
  trainingEventEmitter: TrainingEventEmitter | undefined;
};

export const trainingEvents =
  globalForEvents.trainingEventEmitter ?? new TrainingEventEmitter();

if (process.env.NODE_ENV !== "production") {
  globalForEvents.trainingEventEmitter = trainingEvents;
}
