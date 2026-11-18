// Part 13 V-01, one palette for every Minty app (owner, 2026-11-18): screens bind to the semantic
// roles of @minty/shared/colors.css (bg-action-primary, text-text-secondary, bg-status-info-bg ...),
// never a hex, never a Tailwind palette colour, never the pre-Part 13 aliases (`--primary` grey,
// `--secondary` brand teal). This guard fails on any that creeps back into the source. It reads the
// files as text - so it catches a class string wherever it is built - and skips comments.
//
// Exceptions are listed by file and reason; add one only with the reason beside it.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIRS = ["app", "components", "features", "lib"];

/** file (posix, from the repo root) -> what is allowed there, and why. */
const ALLOWED: Record<string, { pattern: RegExp; why: string }> = {
  "components/payment-request/AttachmentFullScreenViewer.tsx": {
    pattern: /^(?:[a-z-]+:)*(?:bg|text|outline|ring|border)-(?:black|white)(?:\/\d+)?$/,
    why: "the full-screen viewer draws on its own near-black backdrop (bg-black/90), not a page",
  },
};

const PALETTE =
  "gray|red|amber|rose|sky|orange|stone|emerald|green|blue|yellow|slate|zinc|neutral|teal|cyan|indigo|purple|pink|lime|violet|fuchsia|black|white";
const UTIL =
  "bg|text|border|border-[trblxy]|ring|from|to|via|outline|fill|stroke|decoration|divide|placeholder|accent|caret|shadow";
const RAW = new RegExp(
  [
    String.raw`(?<![\w-])(?:[a-z-]+:)*(?:${UTIL})-\[#[0-9a-fA-F]{3,8}\](?:\/\d+)?`,
    String.raw`#[0-9a-fA-F]{3,8}\b`,
    String.raw`(?<![\w-])(?:[a-z-]+:)*(?:${UTIL})-(?:${PALETTE})(?:-\d{2,3})?(?:\/\d+)?\b`,
    // the pre-Part 13 aliases (`--primary` grey, `--secondary` brand teal used as a fill)
    String.raw`(?<![\w-])(?:[a-z-]+:)*(?:${UTIL})-(?:primary|secondary|teal-strong|accent)(?:\/\d+)?(?![\w-])`,
  ].join("|"),
  "g",
);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "__fixtures__" || name === "node_modules") continue;
      out.push(...sources(p));
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("the guard itself", () => {
  it.each([
    'className="bg-[#54D3DA]"',
    'className="text-gray-700"',
    'className="hover:bg-red-50"',
    'className="bg-secondary/10"',
    'className="text-primary"',
    'className="focus-visible:outline-secondary"',
    'className="bg-white text-black"',
    'className="border-t-[#54D3DA]"',
    "const TEAL = '#54d3da';",
  ])("catches %s", (sample) => {
    expect(sample.match(RAW)).not.toBeNull();
  });

  it.each([
    'className="bg-action-primary text-action-on-primary"',
    'className="text-text-primary text-text-secondary"',
    'className="bg-status-info-bg text-status-info-ink"',
    'className="focus-visible:outline-border-focus"',
    'className="bg-surface-card border-border-input"',
  ])("lets the role %s through", (sample) => {
    expect(sample.match(RAW)).toBeNull();
  });
});

describe("Part 13 V-01: no raw colours in the source", () => {
  it("binds every colour to a colors.css role", () => {
    const offences: string[] = [];
    for (const dir of DIRS) {
      for (const file of sources(join(ROOT, dir))) {
        const rel = relative(ROOT, file).split(sep).join("/");
        const text = stripComments(readFileSync(file, "utf8"));
        for (const match of text.matchAll(RAW)) {
          if (ALLOWED[rel]?.pattern.test(match[0])) continue;
          const line = text.slice(0, match.index).split("\n").length;
          offences.push(`${rel}:${line}  ${match[0]}`);
        }
      }
    }
    expect(
      offences,
      `raw colours (use a role from @minty/shared/colors.css):\n${offences.join("\n")}`,
    ).toEqual([]);
  });
});
