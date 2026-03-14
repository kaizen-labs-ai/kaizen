/**
 * Shared focus tracking for dictation components.
 * Tracks the last focused editable element (input, textarea, Monaco, contentEditable).
 */
import type { MutableRefObject } from "react";

export function trackFocusTarget(ref: MutableRefObject<Element | null>): () => void {
  function handleFocusIn(e: FocusEvent) {
    const target = e.target as Element | null;
    if (!target) return;

    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      ref.current = target;
      return;
    }

    if (target.closest?.(".monaco-editor")) {
      ref.current = target.closest(".monaco-editor")!;
      return;
    }

    if ((target as HTMLElement).isContentEditable) {
      ref.current = target;
    }
  }

  document.addEventListener("focusin", handleFocusIn);
  return () => document.removeEventListener("focusin", handleFocusIn);
}
