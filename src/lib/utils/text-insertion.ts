/**
 * Shared utilities for inserting text at the last caret position.
 * Used by SpeechToText and DictationOverlay.
 */

/** Insert text at the current selection in a native input or textarea. */
export function insertIntoNativeInput(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);

  // Use the native setter so React picks up the change
  const nativeSetter = Object.getOwnPropertyDescriptor(
    el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    "value",
  )?.set;
  if (nativeSetter) {
    nativeSetter.call(el, before + text + after);
  } else {
    el.value = before + text + after;
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));

  const newPos = start + text.length;
  el.setSelectionRange(newPos, newPos);
}

/**
 * Insert text at the last focused editable element.
 * Supports native inputs, Monaco editors, and contentEditable elements.
 * Returns true if insertion succeeded.
 */
export function insertAtLastFocus(target: Element | null, text: string): boolean {
  if (!target) return false;

  // Native input / textarea
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.focus();
    insertIntoNativeInput(target, text);
    return true;
  }

  // Monaco editor
  if (target.classList?.contains("monaco-editor")) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const monacoGlobal = (window as any).monaco;
    if (monacoGlobal) {
      const editorInstance = monacoGlobal.editor.getEditors().find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ed: any) => target.contains(ed.getDomNode()),
      );
      if (editorInstance) {
        editorInstance.focus();
        editorInstance.trigger("keyboard", "type", { text });
        return true;
      }
    }
  }

  // ContentEditable
  if ((target as HTMLElement).isContentEditable) {
    (target as HTMLElement).focus();
    document.execCommand("insertText", false, text);
    return true;
  }

  return false;
}
