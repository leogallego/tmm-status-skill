# Status Skill v2 Update Spec

**Date:** 2026-07-20
**Context:** After generating 3 weekly reports (Jul 1-19), we iterated on the format and identified friction points. This spec captures what needs to change so future runs produce the right output without manual corrections.

---

## Change 1: Update SKILL.md Phase 4 — New Categorized Report Format

The current Phase 4 template uses flat bullets with `documents:` and `development:` sections at the bottom. Replace with a **strategic narrative category** format.

### New format

```
[User's Full Name] - Week of [Month Day]

AI-Native Developer Experience — building a complete, one-click AI dev environment for Ansible:
- [Outcome-first bullet with tool name and context]
- [Another bullet]

AIOps & Partner Solutions — driving joint business outcomes with partner integrations:
- [Partner engagement bullet]

Education & Labs — self-service enablement at scale:
- [Lab/course/enablement bullet]

Communities of Practice & Upstream:
- [CoP demo, upstream PR, community contribution]

Field & Customer Support:
- [Customer engagement, SSA/TAM help]

Internal:
- [Admin, quarterly docs, compliance]
- Recurring: [list of recurring meetings attended]
```

### Category placement rules (add to SKILL.md)

- **AIOps & Partner Solutions**: NetBox, LogicMonitor, Cisco, Arista — partner-level engagements. NOT customer work.
- **Field & Customer Support**: Customer engagements (Bancolombia, PBA, etc.), SSA help, TAM support.
- **Education & Labs**: Lab content creation, lab maintenance, course modules, lab reviews. NOT SSA troubleshooting (that's Field).
- **Communities of Practice & Upstream**: CoP demos/presentations, upstream PRs to ansible/* repos, community blog contributions.
- **Internal**: 1:1 with manager (keep), other recurring 1:1s (drop unless specific topic discussed), quarterly docs, compliance, recurring meetings.
- Recurring meetings go as the **last bullet inside Internal**, prefixed with "Recurring:".
- Categories can be added/adapted if new work doesn't fit existing ones. Be consistent across weeks.

### Writing guidelines (replace existing ones in Phase 4)

- **Outcome-first, capability-focused** — lead with what was accomplished, not the repo name
- **Name tools explicitly** — never say "the MCP server" generically. Use the tool name with a descriptor on first mention per report (e.g., "ansible-know-mcp (AI skills and documentation MCP server)")
- **Fold doc and dev work into activity bullets** — no separate `documents:` or `development:` sections
- **Include the "end goal" tagline** on the first 3 categories to connect weekly work to strategic goals
- **Drop generic recurring 1:1s** — only keep focused meetings where a specific topic was discussed
- **Flag private/sensitive conversations** — internal strategy discussions, career conversations, unreleased product names should be flagged for user review before including
- **Be specific about people's roles** — SSA, TAM, SPT, PM — don't guess, ask if unsure

### Phase 3 update

When asking clarifying questions, also ask:
- "Any private or sensitive conversations I should exclude from the report?"
- "Should any items move between categories?"

---

## Change 2: Add HTML Conversion Script

Create `scripts/convert-to-html.js` (or `.sh`) that converts the categorized markdown format to HTML using the existing template.

### Conversion rules

| Markdown pattern | HTML output |
|---|---|
| First line (report title) | `<p class="report-header">` + replaces `{{TITLE}}` |
| Line ending with `:` (category header) | `<p class="section-label">` |
| Line starting with `- ` (under a category) | `<li>` inside `<ul>` after the section label |
| Standalone line (e.g., "Short week — ...") | `<p>` |
| `&` in text | `&amp;` |
| ` — ` (em dash) | ` &mdash; ` |
| URLs | `<a href="...">` |

### Edge cases to handle

- Close `</ul>` before each new section label and before `</body>`
- The last section's `</ul>` must not be dropped (common bug with streaming/subshell approaches)
- Empty categories (no sub-bullets) should be omitted entirely

### Usage

```
node scripts/convert-to-html.js --input reports/2026-07/status-report-2026-07-05.md --output ~/Desktop/status-report-2026-07-05.html
```

Or integrated into Phase 4 so it runs automatically after generating the markdown.

---

## Change 3: Fix fetch-github.js Default Filenames

**Current behavior:** Output defaults to `/tmp/github-activity.json` — gets overwritten on each run.

**Problem:** When generating multiple weeks in batch, each run overwrites the previous week's data.

**Fix:** Change the default output path to include the date range:
```
/tmp/github-activity-{start}-to-{end}.json
```

For example: `/tmp/github-activity-2026-06-29-to-2026-07-05.json`

The `--output` flag should continue to work as an override.

**Location:** `scripts/fetch-github.js`, in the `parseArgs` function, the `output` default on ~line 18.

---

## Change 4: Save GitHub JSON to Project tmp/ Instead of /tmp/

The CLAUDE.md for the status report project says temp files should go in `tmp/` inside the project directory, never `/tmp/`. But the fetch script defaults to `/tmp/`.

**Fix:** Change the default output to the project's `tmp/` directory, or let the skill's Phase 1 pass `--output` pointing to the project's `tmp/` dir with the dated filename.

---

## Testing

After making changes, generate a test report for a known week (e.g., 2026-07-13 to 2026-07-19) and verify:
1. The markdown output uses categories with sub-bullets, no `documents:` / `development:` sections
2. The HTML output renders correctly with `section-label` classes and proper `<ul>` nesting
3. The GitHub JSON file is saved with dates in the filename
4. Running the fetch script twice doesn't overwrite the first file

---

## Reference

- Example final reports (all 3 formats settled after iteration): `/home/lgallego/Claude/tmm-status-report/reports/2026-07/`
- Format spec saved to memory: `feedback_report_format.md` in the status-report project memory
- Project portfolio for category alignment: `/home/lgallego/Claude/tmm-status-report/reports/project-portfolio-2026-v2.md`
