export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "link"; href: string; label: string };

export type BodyBlock =
  | { kind: "p"; inlines: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "links"; links: { href: string; label: string }[] }
  | { kind: "quote"; inlines: Inline[] };

export type ParsedBody = {
  blocks: BodyBlock[];
  /** Trailing quoted reply or signature, hidden until the reader expands it. */
  hidden: BodyBlock[] | null;
};

export function parseBody(input: string): ParsedBody {
  const lines = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const cut = findHiddenCut(lines);
  if (cut == null) return { blocks: parseBlocks(lines), hidden: null };
  const hidden = parseBlocks(lines.slice(cut));
  return { blocks: parseBlocks(lines.slice(0, cut)), hidden: hidden.length ? hidden : null };
}

/** One-line preview. Uses link labels, never a raw tracking URL, and skips a trailing quote when the message has its own text. */
export function plainSnippet(input: string): string {
  const parsed = parseBody(input);
  const visible = flatten(parsed.blocks);
  const hidden = parsed.hidden ? flatten(parsed.hidden) : "";
  return (visible || hidden).replace(/\s+/g, " ").trim();
}

export function linkify(input: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const pushText = () => {
    if (!text) return;
    const prev = out[out.length - 1];
    if (prev?.kind === "text") prev.text += text;
    else out.push({ kind: "text", text });
    text = "";
  };

  let i = 0;
  while (i < input.length) {
    const rest = input.slice(i);

    const markdown = /^\[([^\]\n]{0,200})\]\((https?:\/\/[^)\s]+)\)/i.exec(rest);
    if (markdown) {
      const cleaned = cleanHref(markdown[2]);
      if (cleaned) {
        pushText();
        out.push({ kind: "link", href: cleaned.href, label: linkLabel(markdown[1], cleaned.href) });
        i += markdown[0].length;
        continue;
      }
    }

    const angle = /^<(https?:\/\/[^>\s]+)>/i.exec(rest);
    if (angle) {
      const cleaned = cleanHref(angle[1]);
      if (cleaned) {
        pushText();
        out.push({ kind: "link", href: cleaned.href, label: shortDomain(cleaned.href) });
        i += angle[0].length;
        continue;
      }
    }

    const paren = /^\((https?:\/\/[^)\s]+)\)/i.exec(rest);
    if (paren) {
      const cleaned = cleanHref(paren[1]);
      if (cleaned) {
        const phrase = takePhrase(text);
        text = phrase.rest;
        pushText();
        out.push({
          kind: "link",
          href: cleaned.href,
          label: phrase.label ? linkLabel(phrase.label, cleaned.href) : shortDomain(cleaned.href),
        });
        i += paren[0].length;
        continue;
      }
    }

    const bare = /^(https?:\/\/[^\s<>\]]+)/i.exec(rest);
    if (bare) {
      const cleaned = cleanHref(bare[1]);
      if (cleaned) {
        pushText();
        out.push({ kind: "link", href: cleaned.href, label: shortDomain(cleaned.href) });
        i += cleaned.length;
        continue;
      }
    }

    const bold = /^\*\*([^*\n]+)\*\*/.exec(rest);
    if (bold) {
      const inner = linkify(bold[1]);
      pushText();
      if (inner.length === 1 && inner[0]?.kind === "text") out.push({ kind: "strong", text: inner[0].text });
      else out.push(...inner);
      i += bold[0].length;
      continue;
    }

    const em = /^\*([^*\n]+)\*/.exec(rest);
    if (em) {
      const inner = linkify(em[1]);
      pushText();
      if (inner.length === 1 && inner[0]?.kind === "text") out.push({ kind: "em", text: inner[0].text });
      else out.push(...inner);
      i += em[0].length;
      continue;
    }

    text += input[i];
    i += 1;
  }
  pushText();
  return out;
}

function parseBlocks(lines: string[]): BodyBlock[] {
  const blocks: BodyBlock[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  let quote: string[] | null = null;
  let links: { href: string; label: string }[] | null = null;

  const flushPara = () => {
    if (para.length === 0) return;
    const inlines = linkify(para.join("\n").trim());
    para = [];
    if (inlines.length) blocks.push({ kind: "p", inlines });
  };
  const flushList = () => {
    if (!list) return;
    const items = list.map((item) => linkify(item.trim())).filter((item) => item.length > 0);
    list = null;
    if (items.length) blocks.push({ kind: "list", items });
  };
  const flushQuote = () => {
    if (!quote) return;
    const inlines = linkify(quote.map((line) => line.replace(/^>+\s?/, "")).join("\n").trim());
    quote = null;
    if (inlines.length) blocks.push({ kind: "quote", inlines });
  };
  const flushLinks = () => {
    if (!links?.length) {
      links = null;
      return;
    }
    blocks.push({ kind: "links", links });
    links = null;
  };
  const flushProse = () => {
    flushPara();
    flushList();
    flushQuote();
  };

  for (const line of lines) {
    if (line.trim() === "") {
      flushProse();
      flushLinks();
      continue;
    }
    if (isQuoteLine(line)) {
      flushPara();
      flushList();
      flushLinks();
      quote = quote ?? [];
      quote.push(line);
      continue;
    }
    const only = linkOnlyLine(line);
    if (only) {
      flushProse();
      links = [...(links ?? []), ...only];
      continue;
    }
    if (line.startsWith("- ")) {
      flushPara();
      flushQuote();
      flushLinks();
      list = list ?? [];
      list.push(line.slice(2));
      continue;
    }
    flushList();
    flushQuote();
    flushLinks();
    para.push(line);
  }
  flushProse();
  flushLinks();
  return blocks;
}

function linkOnlyLine(line: string): { href: string; label: string }[] | null {
  const stripped = line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/, "");
  if (!stripped) return null;
  const inlines = linkify(stripped);
  const links: { href: string; label: string }[] = [];
  for (const part of inlines) {
    if (part.kind === "link") {
      links.push({ href: part.href, label: part.label });
      continue;
    }
    if (part.kind !== "text" || part.text.replace(/[\s,;|·•.\-—–]+/g, "") !== "") return null;
  }
  return links.length ? links : null;
}

function findHiddenCut(lines: string[]): number | null {
  let cut: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (isSignatureDelimiter(lines[i] ?? "") || isWroteLine(lines[i] ?? "")) {
      cut = i;
      break;
    }
    if (isSentFromLine(lines[i] ?? "") && restIsShort(lines, i)) {
      cut = i;
      break;
    }
  }

  const quoteAt = trailingQuoteStart(lines);
  if (quoteAt != null && (cut == null || quoteAt < cut) && tailIsQuote(lines, quoteAt, cut)) cut = quoteAt;
  if (cut == null) return null;

  let at = cut;
  let j = at - 1;
  while (j >= 0 && (lines[j] ?? "").trim() === "") j -= 1;
  if (j >= 0 && isQuoteLine(lines[j] ?? "")) {
    while (j >= 0 && ((lines[j] ?? "").trim() === "" || isQuoteLine(lines[j] ?? ""))) {
      if (isQuoteLine(lines[j] ?? "")) at = j;
      j -= 1;
    }
    cut = at;
  }
  const hidden = lines.slice(cut).some((line) => line.trim() !== "");
  return hidden ? cut : null;
}

function trailingQuoteStart(lines: string[]): number | null {
  let i = lines.length - 1;
  while (i >= 0 && (lines[i] ?? "").trim() === "") i -= 1;
  if (i < 0 || !isQuoteLine(lines[i] ?? "")) return null;
  let start = i;
  while (i >= 0 && ((lines[i] ?? "").trim() === "" || isQuoteLine(lines[i] ?? ""))) {
    if (isQuoteLine(lines[i] ?? "")) start = i;
    i -= 1;
  }
  return start;
}

function tailIsQuote(lines: string[], quoteAt: number, cut: number | null): boolean {
  const end = cut ?? lines.length;
  for (let i = quoteAt; i < end; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || isQuoteLine(line)) continue;
    return false;
  }
  return true;
}

function restIsShort(lines: string[], index: number): boolean {
  const rest = lines.slice(index + 1).map((line) => line.trim()).filter(Boolean);
  return rest.length <= 5 && rest.every((line) => line.length <= 80);
}

function isQuoteLine(line: string): boolean {
  return /^>+/.test(line);
}

function isSignatureDelimiter(line: string): boolean {
  return /^(?:--|—|–)\s*$/.test(line.trim());
}

function isWroteLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length <= 240 && /^on\s+\S.+\bwrote:\s*$/i.test(trimmed);
}

function isSentFromLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length <= 60 && /^sent from\b/i.test(trimmed);
}

function takePhrase(pending: string): { rest: string; label: string | null } {
  const boundary = Math.max(pending.lastIndexOf(". "), pending.lastIndexOf("! "), pending.lastIndexOf("? "));
  const segment = boundary >= 0 ? pending.slice(boundary + 2) : pending;
  const candidate = segment.trim();
  if (candidate.length < 1 || candidate.length > 80 || !/[A-Za-z0-9]/.test(candidate) || /:\/\//.test(candidate)) {
    return { rest: pending, label: null };
  }
  return { rest: pending.slice(0, pending.length - segment.length), label: candidate };
}

function cleanHref(raw: string): { href: string; length: number } | null {
  const trimmed = trimTrailingPunct(raw);
  if (!trimmed || hasControlOrSpace(trimmed) || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    return { href: url.href, length: trimmed.length };
  } catch {
    return null;
  }
}

function trimTrailingPunct(raw: string): string {
  let value = raw;
  for (;;) {
    const stripped = value.replace(/[.,;:!?'"]+$/g, "");
    let next = stripped;
    const open = countChar(next, "(");
    const close = countChar(next, ")");
    if (close > open && next.endsWith(")")) next = next.slice(0, -1);
    if (next === value) return value;
    value = next;
  }
}

function hasControlOrSpace(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127 || char.trim() === "") return true;
  }
  return false;
}

function countChar(value: string, char: string): number {
  let count = 0;
  for (const c of value) if (c === char) count += 1;
  return count;
}

function linkLabel(text: string, href: string): string {
  const cleaned = text.trim();
  if (!cleaned || cleaned.length > 80 || /:\/\//.test(cleaned) || /^https?:\/\//i.test(cleaned)) return shortDomain(href);
  return cleaned;
}

function shortDomain(href: string): string {
  try {
    const host = new URL(href).hostname.replace(/^www\./i, "");
    if (!host) return "link";
    return host.length > 40 ? `${host.slice(0, 37)}…` : host;
  } catch {
    return "link";
  }
}

function flatten(blocks: BodyBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "p" || block.kind === "quote") return inlinePlain(block.inlines);
      if (block.kind === "list") return block.items.map(inlinePlain).join(" ");
      return block.links.map((link) => link.label).join(" ");
    })
    .filter(Boolean)
    .join(" ");
}

function inlinePlain(inlines: Inline[]): string {
  return inlines.map((part) => (part.kind === "link" ? part.label : part.text)).join("");
}
