export interface StreamEvent {
  type: "text_delta" | "tool_call_start" | "tool_call_delta" | "tool_call_end" | "done" | "error";
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgsDelta?: string;
}

export async function* parseOpenRouterStream(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<StreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (trimmed === "data: [DONE]") {
          yield { type: "done" };
          return;
        }
        if (trimmed.startsWith("data: ")) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const json = JSON.parse(trimmed.slice(6)) as any;
            const delta = json.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              yield { type: "text_delta", content: delta.content };
            }

            if (delta.tool_calls) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              for (const tc of delta.tool_calls as any[]) {
                if (tc.function?.name) {
                  yield {
                    type: "tool_call_start",
                    toolCallId: tc.id,
                    toolName: tc.function.name,
                    toolArgsDelta: tc.function.arguments ?? "",
                  };
                } else if (tc.function?.arguments) {
                  yield {
                    type: "tool_call_delta",
                    toolCallId: tc.id,
                    toolArgsDelta: tc.function.arguments,
                  };
                }
              }
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
