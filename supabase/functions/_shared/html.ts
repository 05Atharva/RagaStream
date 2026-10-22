// HTML helpers for the review pages. Pure functions, no Deno APIs.
// Markup is kept XML-well-formed so it can also be served as application/xhtml+xml.

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Meend: Ink background, Porcelain text, Kesar for the one action.
const INK = "#0B0F1A";
const PORCELAIN = "#F5F1EA";
const KESAR = "#FF7A1A";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&amp;family=Geist:wght@400;500&amp;display=swap";

const CSS = `
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px;background:${INK};color:${PORCELAIN};font-family:'Geist',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.5}
main{width:100%;max-width:420px}
.brand{font-family:'Bricolage Grotesque',system-ui,sans-serif;font-weight:700;font-size:15px;letter-spacing:.02em;color:${KESAR};margin:0 0 28px}
h1{font-family:'Bricolage Grotesque',system-ui,sans-serif;font-weight:700;font-size:28px;line-height:1.15;margin:0 0 12px;overflow-wrap:anywhere}
p{margin:0 0 20px;color:rgba(245,241,234,.78)}
button{display:inline-block;min-height:48px;padding:0 28px;border:0;border-radius:999px;background:${KESAR};color:${INK};font:600 16px 'Geist',system-ui,sans-serif;cursor:pointer}
button:focus-visible{outline:2px solid ${PORCELAIN};outline-offset:3px}
.quiet{font-size:14px;color:rgba(245,241,234,.6);margin-top:24px}
`;

export interface PageOptions {
  title: string;
  heading: string;
  /** Already-escaped HTML for the body copy. */
  bodyHtml: string;
  /** Already-escaped HTML placed after the copy (a form, usually). */
  actionHtml?: string;
}

export function renderPage(o: PageOptions): string {
  return `<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<meta name="referrer" content="no-referrer" />
<title>${escapeHtml(o.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="stylesheet" href="${FONTS}" />
<style>${CSS}</style>
</head>
<body>
<main>
<p class="brand">RagaStream</p>
<h1>${escapeHtml(o.heading)}</h1>
${o.bodyHtml}
${o.actionHtml ?? ""}
</main>
</body>
</html>`;
}
