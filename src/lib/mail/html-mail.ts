/**
 * Sanitize stored mail HTML for a sandboxed iframe.
 * Scripts, forms, and event handlers are removed. Remote images stay out
 * until the reader opts in. Tracking pixels stay out either way.
 */

export const HTML_FRAME_SANDBOX = "allow-same-origin allow-popups allow-popups-to-escape-sandbox";

export type MailHtmlTheme = "light" | "dim" | "lights-out";

const ALLOWED = new Set([
  "a", "abbr", "b", "blockquote", "br", "caption", "center", "cite", "code",
  "col", "colgroup", "dd", "del", "div", "dl", "dt", "em", "font", "h1", "h2",
  "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "s",
  "small", "span", "strike", "strong", "sub", "sup", "table", "tbody", "td",
  "tfoot", "th", "thead", "tr", "tt", "u", "ul", "wbr",
]);

const VOID = new Set(["br", "col", "hr", "img", "wbr"]);

/** Raw text until the matching close tag. The contents are not rendered. */
const RAW_DROP = new Set(["script", "textarea", "title", "xmp", "iframe", "noembed", "noframes"]);

const DROP_ATTR = new Set([
  "id", "name", "srcdoc", "formaction", "action", "xmlns", "target", "rel",
  "srcset", "poster", "background", "href", "src",
]);

const GLOBAL_ATTRS = new Set([
  "style", "title", "dir", "lang", "align", "valign", "bgcolor", "color",
  "width", "height", "border", "cellpadding", "cellspacing", "colspan",
  "rowspan", "role", "headers", "scope", "face", "size", "span", "nowrap",
  "alt", "abbr", "axis", "char", "charoff", "class",
]);

type Attr = { name: string; value: string };

const CANVAS: Record<MailHtmlTheme, { bg: string; fg: string; scheme: string }> = {
  light: { bg: "#ffffff", fg: "#0f1419", scheme: "light" },
  dim: { bg: "#15202b", fg: "#f7f9f9", scheme: "dark" },
  "lights-out": { bg: "#000000", fg: "#e7e9ea", scheme: "dark" },
};

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function codePoint(code: number): string {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return "";
  if (code >= 0xd800 && code <= 0xdfff) return "";
  return String.fromCodePoint(code);
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:#x([0-9a-f]+)|#(\d+))(?:;?)|&(amp|lt|gt|quot|apos|colon|tab|newline);/gi, (all, hex: string | undefined, dec: string | undefined, named: string | undefined) => {
    if (hex) return codePoint(Number.parseInt(hex, 16));
    if (dec) return codePoint(Number.parseInt(dec, 10));
    const lower = (named ?? "").toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    if (lower === "colon") return ":";
    if (lower === "tab" || lower === "newline") return "";
    return all;
  });
}

function stripUrlNoise(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) continue;
    out += char;
  }
  return out;
}

function isTrackingUrl(url: string): boolean {
  const path = url.split("?")[0] ?? url;
  return /(?:^|[/?#_=.-])(?:pixel|beacon|spacer|1x1)(?:[/?#_=.-]|$)/i.test(path) || /(?:clear|trans|blank)\.gif$/i.test(path);
}

function dimension(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

export function isTrackingPixel(input: { src?: string; width?: string; height?: string; style?: string }): boolean {
  const src = stripUrlNoise(decodeEntities(input.src ?? ""));
  const width = dimension(input.width);
  const height = dimension(input.height);
  if (width !== null && height !== null && width <= 1 && height <= 1) return true;
  const style = input.style ?? "";
  const sw = /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(style);
  const sh = /(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)px/i.exec(style);
  if (sw?.[1] && sh?.[1] && Number(sw[1]) <= 1 && Number(sh[1]) <= 1) return true;
  if (/display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?(?:\s|;|$)/i.test(style)) return true;
  return src !== "" && isTrackingUrl(src);
}

function safeDataImage(value: string): boolean {
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(value);
}

function remoteUrl(value: string): string | null {
  const remote = value.startsWith("//") ? `https:${value}` : value;
  if (!/^https?:\/\//i.test(remote)) return null;
  if (isTrackingUrl(remote)) return null;
  return remote;
}

function linkUrl(raw: string): string | null {
  const value = stripUrlNoise(decodeEntities(raw));
  if (!value) return null;
  const lower = value.toLowerCase();
  if (lower.startsWith("https://") || lower.startsWith("http://") || lower.startsWith("mailto:") || lower.startsWith("tel:")) {
    return value;
  }
  if (value.startsWith("//")) return `https:${value}`;
  return null;
}

function imageUrl(raw: string, showRemoteImages: boolean): string | null {
  const value = stripUrlNoise(decodeEntities(raw));
  if (!value) return null;
  if (safeDataImage(value)) return value;
  const remote = remoteUrl(value);
  if (!remote || !showRemoteImages) return null;
  return remote;
}

function isRemoteImage(raw: string): boolean {
  const value = stripUrlNoise(decodeEntities(raw));
  if (!value || safeDataImage(value)) return false;
  const remote = value.startsWith("//") ? `https:${value}` : value;
  return /^https?:\/\//i.test(remote);
}

export function sanitizeCss(css: string, showRemoteImages: boolean): string {
  let value = css.replace(/\/\*[\s\S]*?\*\//g, "");
  value = value.replace(/@import[^;}]*/gi, "");
  value = value.replace(/@font-face\s*\{[^}]*\}/gi, "");
  value = value.replace(/!important/gi, "");
  value = value.replace(/min-width\s*:[^;}]*/gi, "");
  value = value.replace(/expression\s*\((?:[^()]|\([^()]*\))*\)/gi, "none");
  value = value.replace(/-moz-binding\s*:[^;}]*/gi, "");
  value = value.replace(/behavior\s*:[^;}]*/gi, "");
  value = value.replace(/url\(\s*(['"]?)([\s\S]*?)\1\s*\)/gi, (_all, _quote: string, inner: string) => {
    const url = stripUrlNoise(decodeEntities(inner));
    if (safeDataImage(url)) return `url("${url.replace(/"/g, "")}")`;
    const remote = remoteUrl(url);
    if (remote && showRemoteImages) return `url("${remote.replace(/"/g, "")}")`;
    return "none";
  });
  value = value.replace(/</g, "");
  if (/javascript:|vbscript:|expression\s*\(/i.test(value)) return "";
  return value.trim();
}

function skipSpace(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i] ?? "")) i += 1;
  return i;
}

function readName(src: string, i: number): { name: string; i: number } | null {
  if (!/[A-Za-z]/.test(src[i] ?? "")) return null;
  const start = i;
  i += 1;
  while (i < src.length && /[A-Za-z0-9]/.test(src[i] ?? "")) i += 1;
  return { name: src.slice(start, i).toLowerCase(), i };
}

function readTagTail(src: string, i: number): { attrs: Attr[]; i: number } | null {
  const attrs: Attr[] = [];
  while (i < src.length) {
    i = skipSpace(src, i);
    if (i >= src.length) return null;
    if (src[i] === ">") return { attrs, i: i + 1 };
    if (src[i] === "/" && src[i + 1] === ">") return { attrs, i: i + 2 };
    if (src[i] === "/") {
      i += 1;
      continue;
    }
    if (!/[A-Za-z_:]/.test(src[i] ?? "")) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < src.length && /[^\s=/>]/.test(src[i] ?? "")) i += 1;
    const name = src.slice(start, i).toLowerCase();
    i = skipSpace(src, i);
    let value = "";
    if (src[i] === "=") {
      i += 1;
      i = skipSpace(src, i);
      const quote = src[i];
      if (quote === '"' || quote === "'") {
        i += 1;
        const from = i;
        while (i < src.length && src[i] !== quote) i += 1;
        value = src.slice(from, i);
        if (src[i] === quote) i += 1;
      } else {
        const from = i;
        while (i < src.length && !/[\s>]/.test(src[i] ?? "")) i += 1;
        value = src.slice(from, i);
        if (value.endsWith("/")) value = value.slice(0, -1);
      }
    }
    attrs.push({ name, value });
  }
  return null;
}

function skipRaw(src: string, i: number, name: string): number {
  const openEnd = src.indexOf(">", i);
  if (openEnd === -1) return src.length;
  const contentStart = openEnd + 1;
  const match = new RegExp(`</${name}\\s*>`, "i").exec(src.slice(contentStart));
  if (!match) return src.length;
  return contentStart + match.index + match[0].length;
}

function readRaw(src: string, i: number, name: string): { text: string; i: number } {
  const match = new RegExp(`</${name}\\s*>`, "i").exec(src.slice(i));
  if (!match) return { text: src.slice(i), i: src.length };
  return { text: src.slice(i, i + match.index), i: i + match.index + match[0].length };
}

function hiddenImage(alt: string, height: string): string {
  const label = alt.trim() || "Image hidden";
  const parsed = dimension(height);
  const min = parsed !== null && parsed > 1 ? Math.min(Math.round(parsed), 220) : 96;
  return `<div role="img" aria-label="${escapeAttr(label)}" style="display:block;max-width:100%;box-sizing:border-box;background:#eef3f6;color:#536471;font-size:16px;line-height:1.4;padding:12px;min-height:${min}px">${escapeText(label)}</div>`;
}

function emitImage(attrs: Attr[], showRemoteImages: boolean): string {
  let src = "";
  let alt = "";
  let width = "";
  let height = "";
  let style = "";
  for (const attr of attrs) {
    if (attr.name === "src") src = attr.value;
    else if (attr.name === "alt") alt = attr.value;
    else if (attr.name === "width") width = attr.value;
    else if (attr.name === "height") height = attr.value;
    else if (attr.name === "style") style = attr.value;
  }
  if (isTrackingPixel({ src, width, height, style })) return "";
  const shown = imageUrl(src, showRemoteImages);
  if (!shown) {
    if (!isRemoteImage(src)) return "";
    return hiddenImage(alt, height);
  }
  const parts = [`src="${escapeAttr(shown)}"`, `alt="${escapeAttr(alt)}"`, `referrerpolicy="no-referrer"`];
  if (/^[\d.]+%?$/.test(width.trim())) parts.push(`width="${escapeAttr(width.trim())}"`);
  if (/^[\d.]+%?$/.test(height.trim())) parts.push(`height="${escapeAttr(height.trim())}"`);
  const css = style ? sanitizeCss(style, showRemoteImages) : "";
  if (css) parts.push(`style="${escapeAttr(css)}"`);
  return `<img ${parts.join(" ")}>`;
}

function emit(tag: string, attrs: Attr[], showRemoteImages: boolean): string {
  if (tag === "img") return emitImage(attrs, showRemoteImages);
  const kept: [string, string][] = [];
  let href: string | null = null;
  for (const attr of attrs) {
    if (tag === "a" && attr.name === "href") {
      href = linkUrl(attr.value);
      continue;
    }
    if (attr.name === "background") {
      const url = imageUrl(attr.value, showRemoteImages);
      if (url) kept.push(["background", url]);
      continue;
    }
    if (attr.name.startsWith("on") || DROP_ATTR.has(attr.name)) continue;
    if (attr.name === "style") {
      const css = sanitizeCss(attr.value, showRemoteImages);
      if (css) kept.push(["style", css]);
      continue;
    }
    if (!GLOBAL_ATTRS.has(attr.name)) continue;
    if (attr.name === "width" && tag === "table" && /^[\d.]+$/.test(attr.value.trim())) {
      kept.push(["width", "100%"]);
      continue;
    }
    if (attr.name === "width" && (tag === "td" || tag === "th") && /^[\d.]+$/.test(attr.value.trim())) continue;
    kept.push([attr.name, attr.value]);
  }
  if (tag === "a" && href) {
    kept.push(["href", href], ["target", "_blank"], ["rel", "noopener noreferrer"]);
  }
  const rendered = kept.map(([key, value]) => `${key}="${escapeAttr(value)}"`).join(" ");
  return rendered ? `<${tag} ${rendered}>` : `<${tag}>`;
}

export function sanitizeMailHtml(input: string, options: { showRemoteImages: boolean }): string {
  const showRemoteImages = options.showRemoteImages;
  const src = typeof input === "string" ? input : "";
  let out = "";
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt === -1) {
      out += escapeText(src.slice(i));
      break;
    }
    if (lt > i) out += escapeText(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith("<!", lt) || src.startsWith("<?", lt)) {
      const end = src.indexOf(">", lt + 2);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (src.startsWith("</", lt)) {
      const name = readName(src, lt + 2);
      if (!name) {
        out += "&lt;";
        i = lt + 1;
        continue;
      }
      const after = skipSpace(src, name.i);
      if (src[after] === ">" && ALLOWED.has(name.name) && !VOID.has(name.name)) out += `</${name.name}>`;
      i = src[after] === ">" ? after + 1 : lt + 1;
      continue;
    }
    const name = readName(src, lt + 1);
    if (!name) {
      out += "&lt;";
      i = lt + 1;
      continue;
    }
    if (name.name === "plaintext") break;
    if (RAW_DROP.has(name.name)) {
      i = skipRaw(src, name.i, name.name);
      continue;
    }
    if (name.name === "style") {
      const tail = readTagTail(src, name.i);
      if (!tail) break;
      const raw = readRaw(src, tail.i, "style");
      i = raw.i;
      const css = sanitizeCss(raw.text, showRemoteImages);
      if (css) out += `<style>${css}</style>`;
      continue;
    }
    const tail = readTagTail(src, name.i);
    if (!tail) break;
    i = tail.i;
    if (!ALLOWED.has(name.name)) continue;
    out += emit(name.name, tail.attrs, showRemoteImages);
  }
  return out;
}

export function htmlIsVisible(html: string): boolean {
  return sanitizeMailHtml(html, { showRemoteImages: true }).trim().length > 0;
}

/** True when opting in would reveal a remote image. Tracking pixels do not count. */
export function mailNeedsImagePrompt(html: string): boolean {
  return sanitizeMailHtml(html, { showRemoteImages: false }) !== sanitizeMailHtml(html, { showRemoteImages: true });
}

export function mailSrcDoc(html: string, options: { showRemoteImages: boolean; theme?: MailHtmlTheme }): string {
  const theme = options.theme ?? "light";
  const canvas = CANVAS[theme] ?? CANVAS.light;
  const body = sanitizeMailHtml(html, { showRemoteImages: options.showRemoteImages });
  const imgSrc = options.showRemoteImages ? "https: http: data:" : "data:";
  const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'`;
  const css = [
    `html,body{margin:0;padding:0;background:${canvas.bg};color:${canvas.fg};color-scheme:${canvas.scheme};`,
    `font-family:"TwitterChirp",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;`,
    `font-size:16px;line-height:1.45;overflow-wrap:anywhere;word-break:break-word;overflow-x:hidden;}`,
    `*{box-sizing:border-box;min-width:0 !important;max-width:100% !important;}`,
    `img,video{max-width:100% !important;height:auto !important;}`,
    `table{width:100% !important;max-width:100% !important;table-layout:fixed;border-collapse:collapse;}`,
    `td,th,div,p,a,h1,h2,h3,h4,span{overflow-wrap:anywhere;word-break:break-word;}`,
    `pre,code{white-space:pre-wrap;}`,
    `a{color:#1d9bf0;}`,
  ].join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css}</style></head><body>${body}</body></html>`;
}
