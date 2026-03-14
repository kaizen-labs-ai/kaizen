/**
 * Single point for user-facing output emission.
 * Consolidates scattered wrappedOnDelta call sites with agent-aware routing rules.
 *
 * Supports interim emission: text streamed to the user mid-run (e.g., acknowledgments
 * before tool calls) without waiting for the run to complete. Deduplicates so that
 * the same text is never sent twice.
 */

export class OutputRouter {
  private emitted = false;
  private interimTexts = new Set<string>();

  constructor(private onDelta: (text: string) => void | Promise<void>) {}

  get hasEmitted(): boolean {
    return this.emitted;
  }

  /**
   * Emit interim text to the user immediately (e.g., acknowledgment before tool calls).
   * Follows the same suppression rules as emit(). Tracked for dedup against final emit().
   */
  async emitInterim(
    text: string,
    ctx: { agentId: string },
  ): Promise<void> {
    if (!text) return;
    if (ctx.agentId === "reviewer" || ctx.agentId === "planner") return;
    this.interimTexts.add(text);
    this.emitted = true;
    await this.onDelta(text);
  }

  /**
   * Emit final text to the user, subject to routing rules.
   * - reviewer → SUPPRESS (internal)
   * - text already sent via emitInterim → SUPPRESS (dedup)
   * - everything else → EMIT
   */
  async emit(
    text: string,
    ctx: { agentId: string },
  ): Promise<void> {
    if (!text) return;
    if (ctx.agentId === "reviewer" || ctx.agentId === "planner") return;
    if (this.interimTexts.has(text)) return; // already sent as interim
    this.emitted = true;
    await this.onDelta(text);
  }
}
