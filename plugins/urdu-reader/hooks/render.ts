const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-z]/g;
const MIN_URDU_LETTERS = 12;

const countOf = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;

export const hasUrdu = (text: string): boolean => countOf(text, ARABIC_SCRIPT) >= MIN_URDU_LETTERS;

const isMostlyUrdu = (text: string): boolean => countOf(text, ARABIC_SCRIPT) > countOf(text, LATIN);

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const inlineMarkdown = (escaped: string): string =>
  escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

const isRule = (block: string): boolean => /^-{3,}$/.test(block.trim());

const blockToHtml = (block: string): string => {
  if (isRule(block)) return "<hr>";
  const attributes = isMostlyUrdu(block) ? ' dir="rtl" lang="ur" class="ur"' : ' dir="auto"';
  const body = inlineMarkdown(escapeHtml(block.trim())).replace(/\n/g, "<br>");
  return `<p${attributes}>${body}</p>`;
};

export const toBlocks = (text: string): string[] =>
  text.split(/\n\s*\n/).map(block => block.trim()).filter(block => block.length > 0);

const STYLE = `
:root { color-scheme: light dark; --bg: #f6f5f1; --fg: #1c1f1d; --muted: #5d6660; --line: #d8dcd6; }
@media (prefers-color-scheme: dark) { :root { --bg: #121614; --fg: #e8ece9; --muted: #9aa69f; --line: #2d3732; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 32px 20px 64px; display: flex; flex-direction: column; gap: 14px; }
header { color: var(--muted); font-size: 13px; border-bottom: 1px solid var(--line); padding-bottom: 10px; }
p { margin: 0; }
.ur { font-family: "Noto Nastaliq Urdu", "Jameel Noori Nastaleeq", "Urdu Typesetting", "Noto Naskh Arabic", serif; font-size: 20px; line-height: 2.3; text-align: right; }
hr { border: 0; border-top: 1px solid var(--line); width: 100%; }
code { font-size: 0.9em; }
`;

export const toPage = (text: string, createdAt: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Urdu reader</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600&display=swap">
<style>${STYLE}</style>
</head>
<body>
<main>
<header>From Claude's reply · ${escapeHtml(createdAt)}</header>
${toBlocks(text).map(blockToHtml).join("\n")}
</main>
</body>
</html>
`;
