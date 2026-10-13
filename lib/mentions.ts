// @mention parsing for comment threads. All pure — no network, no React —
// so the composer, the notification fan-out, and the renderer share one
// definition of what counts as a mention.
//
// A mention is "@" + a member's exact display name, matched as a whole token:
// the "@" starts a token (at the string start or after whitespace) and the
// name isn't followed by another word character. Matching against the real
// username list (longest first) — rather than a regex like /@(\w+)/ — is what
// lets names with spaces ("Mary Jane") resolve, and stops "@Jo" from being
// read inside "@Joanna".

export type MentionUser = { uid: string; username: string };

// The caret sits inside an "@token" being typed → where the "@" is and the
// partial query after it (empty right after typing "@"). Null otherwise.
// The query stops at whitespace, so only single words filter the picker; a
// multi-word name is reached by picking it from the list, not by typing it out.
const QUERY_RE = /(?:^|\s)@([^@\s]{0,40})$/;

export function activeMentionQuery(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, caret));
  const m = before.match(QUERY_RE);
  if (!m) return null;
  const query = m[1];
  return { start: caret - query.length - 1, query }; // start = index of "@"
}

// Replace the "@query" span the caret is in with "@Name " (trailing space so
// the next keystroke isn't swallowed into the mention). Returns the new text
// and where to put the caret.
export function insertMention(
  text: string,
  caret: number,
  start: number,
  username: string
): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(caret);
  const chunk = `@${username} `;
  return { text: before + chunk + after, caret: (before + chunk).length };
}

const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9]/.test(c);

// A single left-to-right pass, greedily matching the longest known name at
// each "@". Emits plain-text and mention segments so the same logic drives
// both rendering and uid extraction.
export type Segment =
  | { text: string; mention?: undefined }
  | { text: string; mention: MentionUser };

export function splitMentions(text: string, users: MentionUser[]): Segment[] {
  const byLen = [...users].sort((a, b) => b.username.length - a.username.length);
  const segs: Segment[] = [];
  let buf = "";
  let i = 0;
  while (i < text.length) {
    const startsToken = i === 0 || /\s/.test(text[i - 1]);
    if (text[i] === "@" && startsToken) {
      const hit = byLen.find(
        (u) =>
          text.startsWith(u.username, i + 1) &&
          !isWordChar(text[i + 1 + u.username.length])
      );
      if (hit) {
        if (buf) {
          segs.push({ text: buf });
          buf = "";
        }
        segs.push({ text: `@${hit.username}`, mention: hit });
        i += 1 + hit.username.length;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  if (buf) segs.push({ text: buf });
  return segs;
}

// Unique uids of the members @mentioned in the text.
export function extractMentionUids(text: string, users: MentionUser[]): string[] {
  const uids = new Set<string>();
  for (const seg of splitMentions(text, users)) {
    if (seg.mention) uids.add(seg.mention.uid);
  }
  return [...uids];
}
