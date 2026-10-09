// Hand-rolled, deliberately narrow: detects GFM-style markdown tables
// inside an otherwise-plain-text LLM answer and splits the message into
// alternating text/table segments. Not a general markdown renderer - no
// new dependency for one feature (tabular responses), per project rule.

export interface TextSegment {
  type: "text";
  content: string;
}

export interface TableSegment {
  type: "table";
  headers: string[];
  rows: string[][];
}

export type MessageSegment = TextSegment | TableSegment;

const ROW_LINE = /^\|(.+)\|\s*$/;
const SEPARATOR_LINE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

export function parseMessageIntoSegments(text: string): MessageSegment[] {
  const lines = text.split("\n");
  const segments: MessageSegment[] = [];
  let textBuffer: string[] = [];
  let i = 0;

  function flushText() {
    const content = textBuffer.join("\n").trim();
    if (content) {
      segments.push({ type: "text", content });
    }
    textBuffer = [];
  }

  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1];

    if (line && ROW_LINE.test(line) && next && SEPARATOR_LINE.test(next)) {
      flushText();
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i] && ROW_LINE.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      segments.push({ type: "table", headers, rows });
      continue;
    }

    textBuffer.push(line);
    i++;
  }
  flushText();

  return segments;
}
