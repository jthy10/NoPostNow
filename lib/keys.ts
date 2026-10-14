import type { KeyboardEvent } from "react";

// Enter that means "send", not Enter that means "pick this word". Japanese,
// Chinese and Korean keyboards compose text in place and use Enter to commit
// the candidate; that keydown still reports key "Enter", so a plain check
// sends half a word. isComposing covers modern browsers; Safari fires the
// committing keydown just after composition ends and only marks it with the
// legacy 229 keyCode.
export function isSendEnter(e: KeyboardEvent): boolean {
  return e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229;
}

// After a send lands, take away only what was sent. Anything typed while it
// was in flight stays in the box rather than being wiped with it.
export function afterSend(current: string, sent: string): string {
  return current.startsWith(sent) ? current.slice(sent.length).trimStart() : current;
}
