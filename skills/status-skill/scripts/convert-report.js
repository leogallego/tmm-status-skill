#!/usr/bin/env node

/**
 * Convert a status report into HTML and Slack mrkdwn.
 *
 * Supports two input formats (auto-detected):
 *
 * 1. Categorized (v3) — plain text with category lines ending in ':'
 *    Name - Week of Month Day
 *    Category — tagline:
 *    - bullet
 *
 * 2. Markdown (v2) — markdown with # headers
 *    # Name - Week of Month Day
 *    ## Section Name
 *    - **Lead** - description
 *
 * Usage:
 *   node convert-report.js --input reports/2026-07/status-report-2026-07-05.md \
 *     --html reports/2026-07/html/status-report-2026-07-05.html \
 *     --slack reports/2026-07/slack/status-report-2026-07-05.txt \
 *     --template skills/status-skill/templates/status-report.html
 *
 * Dependencies:
 *   marked (vendored at ./vendor/marked.js, v18.x — only used for v2 format)
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { marked } from "./vendor/marked.js";

// --- Argument parsing ---

function parseArgs(args) {
  const parsed = { input: null, html: null, slack: null, template: null };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--input": parsed.input = args[++i]; break;
      case "--html": parsed.html = args[++i]; break;
      case "--slack": parsed.slack = args[++i]; break;
      case "--template": parsed.template = args[++i]; break;
    }
  }
  if (!parsed.input) {
    console.error("Error: --input is required");
    process.exit(1);
  }
  return parsed;
}

// --- Format detection ---

function isCategorizedFormat(content) {
  const firstLine = content.split("\n").find(l => l.trim().length > 0) || "";
  return !firstLine.trim().startsWith("# ");
}

// --- Parse categorized (v3) format ---

function parseCategorizedReport(content) {
  const lines = content.split("\n");
  const report = {
    header: "",
    preambleLines: [],
    sections: [],
  };

  let headerFound = false;
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (!headerFound) {
      report.header = trimmed;
      headerFound = true;
      continue;
    }

    if (trimmed.endsWith(":") && !trimmed.startsWith("- ")) {
      currentSection = { name: trimmed, items: [] };
      report.sections.push(currentSection);
      continue;
    }

    if (trimmed.startsWith("- ") && currentSection) {
      currentSection.items.push(trimmed.slice(2));
      continue;
    }

    if (!currentSection) {
      report.preambleLines.push(trimmed);
    }
  }

  return report;
}

// --- Parse markdown (v2) into structured report ---

function parseReport(content) {
  const tokens = marked.lexer(content);
  const report = {
    header: "",
    stats: "",
    highlights: [],
    sections: [],
    documents: [],
    development: [],
  };

  let i = 0;

  // Find # heading (report header)
  while (i < tokens.length && tokens[i].type !== "heading") i++;
  if (i < tokens.length && tokens[i].depth === 1) {
    report.header = tokens[i].text;
    i++;
  }

  // Next non-space token: stats line (paragraph, not a heading or list)
  while (i < tokens.length && tokens[i].type === "space") i++;
  if (i < tokens.length && tokens[i].type === "paragraph") {
    report.stats = tokens[i].text;
    i++;
  }

  // Process remaining ## sections
  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === "space") { i++; continue; }

    if (token.type === "heading" && token.depth === 2) {
      const sectionName = token.text;
      i++;

      // Collect the list that follows this heading
      while (i < tokens.length && tokens[i].type === "space") i++;

      const items = [];
      if (i < tokens.length && tokens[i].type === "list") {
        for (const listItem of tokens[i].items) {
          const item = { text: extractItemText(listItem), children: [] };

          // Check for nested list
          for (const subToken of listItem.tokens) {
            if (subToken.type === "list") {
              for (const subItem of subToken.items) {
                item.children.push(extractItemText(subItem));
              }
            }
          }
          items.push(item);
        }
        i++;
      }

      // Route to the right bucket
      const nameLower = sectionName.toLowerCase();
      if (nameLower === "highlights") {
        report.highlights = items.map(it => it.text);
      } else if (nameLower === "documents") {
        report.documents = items.map(it => it.text);
      } else if (nameLower === "development") {
        report.development = items.map(it => it.text);
      } else {
        report.sections.push({ name: sectionName, items });
      }
      continue;
    }

    i++;
  }

  return report;
}

function extractItemText(listItem) {
  // Get the inline text content from a list item, excluding nested lists
  let text = "";
  for (const token of listItem.tokens) {
    if (token.type === "text" || token.type === "paragraph") {
      text += token.raw;
    }
  }
  return text.trim();
}

// --- HTML conversion ---

function mdInlineToHtml(text, boldTag, boldCloseTag) {
  // **text** -> <boldTag>text</boldCloseTag>
  let html = text.replace(/\*\*([^*]+)\*\*/g, `<${boldTag}>$1</${boldCloseTag}>`);
  // [text](url) -> <a href="url">text</a>
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  return html;
}

function itemToHtml(text) {
  return mdInlineToHtml(text, 'span class="lead"', "span");
}

function highlightToHtml(text) {
  return mdInlineToHtml(text, "b", "b");
}

function devToHtml(text) {
  let html = text;
  // **org/repo**: -> <span class="dev-repo">org/repo</span>:
  html = html.replace(/\*\*([^*]+)\*\*:/, '<span class="dev-repo">$1</span>:');
  // Handle remaining links
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  return html;
}

function docToHtml(text) {
  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
}

function toHtml(report, template) {
  let content = "";

  content += `<p class="report-header">${report.header}</p>\n`;

  if (report.stats) {
    const statsHtml = report.stats.replace(/\s*\|\s*/g, " &middot; ");
    content += `\n<p class="stats-line">${statsHtml}</p>\n`;
  }

  if (report.highlights.length > 0) {
    content += `\n<div class="highlights">\n<p class="highlights-label">highlights:</p>\n<ul>\n`;
    for (const h of report.highlights) {
      content += `<li>${highlightToHtml(h)}</li>\n`;
    }
    content += `</ul>\n</div>\n`;
  }

  for (const section of report.sections) {
    if (section.name) {
      content += `\n<p class="section-label">${section.name}:</p>\n`;
    }
    content += `<ul>\n`;
    for (const item of section.items) {
      if (item.children.length > 0) {
        content += `<li>${itemToHtml(item.text)}\n<ul>\n`;
        for (const child of item.children) {
          content += `<li>${itemToHtml(child)}</li>\n`;
        }
        content += `</ul>\n</li>\n`;
      } else {
        content += `<li>${itemToHtml(item.text)}</li>\n`;
      }
    }
    content += `</ul>\n`;
  }

  if (report.documents.length > 0) {
    content += `\n<p class="section-label">Documents:</p>\n<ul>\n`;
    for (const doc of report.documents) {
      content += `<li>${docToHtml(doc)}</li>\n`;
    }
    content += `</ul>\n`;
  }

  if (report.development.length > 0) {
    content += `\n<p class="section-label">Development:</p>\n<ul>\n`;
    for (const dev of report.development) {
      content += `<li>${devToHtml(dev)}</li>\n`;
    }
    content += `</ul>\n`;
  }

  return template
    .replace("{{TITLE}}", report.header)
    .replace("{{CONTENT}}", content);
}

// --- Slack conversion ---

function mdInlineToSlack(text) {
  // **text** -> *text*
  let slack = text.replace(/\*\*([^*]+)\*\*/g, "*$1*");
  // [text](url) -> <url|text>
  slack = slack.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>");
  return slack;
}

function toSlack(report) {
  let out = "";

  out += `*${report.header}*\n`;

  if (report.stats) {
    out += `${report.stats}\n`;
  }

  if (report.highlights.length > 0) {
    out += `\n>*Highlights:*\n`;
    for (const h of report.highlights) {
      out += `>• ${mdInlineToSlack(h)}\n`;
    }
  }

  for (const section of report.sections) {
    if (section.name) {
      out += `\n*${section.name}:*\n`;
    } else {
      out += `\n`;
    }
    for (const item of section.items) {
      out += `• ${mdInlineToSlack(item.text)}\n`;
      for (const child of item.children) {
        out += `    ◦ ${mdInlineToSlack(child)}\n`;
      }
    }
  }

  if (report.documents.length > 0) {
    out += `\n*Documents:*\n`;
    for (const doc of report.documents) {
      out += `• ${mdInlineToSlack(doc)}\n`;
    }
  }

  if (report.development.length > 0) {
    out += `\n*Development:*\n`;
    for (const dev of report.development) {
      out += `• ${mdInlineToSlack(dev)}\n`;
    }
  }

  return out;
}

// --- Categorized format: HTML conversion ---

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;");
}

function categorizedInlineToHtml(text) {
  let html = escapeHtml(text);
  html = html.replace(/ — /g, " &mdash; ");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  return html;
}

function categorizedToHtml(report, template) {
  let content = "";

  content += `<p class="report-header">${escapeHtml(report.header)}</p>\n`;

  for (const line of report.preambleLines) {
    content += `\n<p>${categorizedInlineToHtml(line)}</p>\n`;
  }

  for (const section of report.sections) {
    const label = categorizedInlineToHtml(section.name);
    content += `\n<p class="section-label">${label}</p>\n`;
    if (section.items.length > 0) {
      content += `<ul>\n`;
      for (const item of section.items) {
        content += `<li>${categorizedInlineToHtml(item)}</li>\n`;
      }
      content += `</ul>\n`;
    }
  }

  const title = escapeHtml(report.header);
  return template
    .replace("{{TITLE}}", title)
    .replace("{{CONTENT}}", content);
}

// --- Categorized format: Slack conversion ---

function categorizedInlineToSlack(text) {
  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<$2|$1>");
}

function categorizedToSlack(report) {
  let out = "";

  out += `*${report.header}*\n`;

  for (const line of report.preambleLines) {
    out += `\n${line}\n`;
  }

  for (const section of report.sections) {
    out += `\n*${section.name}*\n`;
    for (const item of section.items) {
      out += `• ${categorizedInlineToSlack(item)}\n`;
    }
  }

  return out;
}

// --- Main ---

const config = parseArgs(process.argv.slice(2));
const input = readFileSync(config.input, "utf-8");
const categorized = isCategorizedFormat(input);
const report = categorized ? parseCategorizedReport(input) : parseReport(input);

console.error(`Detected format: ${categorized ? "categorized (v3)" : "markdown (v2)"}`);

if (config.html) {
  if (!config.template) {
    console.error("Error: --template is required for HTML output");
    process.exit(1);
  }
  const template = readFileSync(config.template, "utf-8");
  const html = categorized ? categorizedToHtml(report, template) : toHtml(report, template);
  mkdirSync(dirname(config.html), { recursive: true });
  writeFileSync(config.html, html);
  console.error(`HTML saved to ${config.html}`);
}

if (config.slack) {
  const slack = categorized ? categorizedToSlack(report) : toSlack(report);
  mkdirSync(dirname(config.slack), { recursive: true });
  writeFileSync(config.slack, slack);
  console.error(`Slack saved to ${config.slack}`);
}

if (!config.html && !config.slack) {
  console.log("=== SLACK ===");
  console.log(categorized ? categorizedToSlack(report) : toSlack(report));
}
