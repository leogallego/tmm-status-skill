---
name: status-report
description: "Generate a weekly or monthly status report for your manager by analyzing Google Calendar events, sent emails, Google Meet transcripts, and GitHub activity. Run with /status-report for the past week, /status-report 2026-02-23 2026-03-01 for a custom date range, or /status-report monthly [YYYY-MM] for a monthly summary built from existing weekly reports."
argument-hint: "[start-date end-date | monthly [YYYY-MM]]"
---

# Status Report Generator

Generate status reports by pulling data from Google Calendar, Gmail, Google Meet transcripts, and GitHub activity, then enriching with user input including Slack messages.

Two modes:
- **Weekly** (default): fetches raw data from all sources and generates a single-week report
- **Monthly**: reads existing weekly report files from `reports/YYYY-MM/` and consolidates them into a month-level summary with weekly detail sections

## Configuration

- Scripts directory: `.claude/skills/status-skill/scripts/` (relative to project root)
- Apps Script URL file: `.claude/skills/status-skill/scripts/config/apps-script-url.txt`
- GitHub activity script: `.claude/skills/status-skill/scripts/fetch-github.js`
- Reports output: `reports/YYYY-MM/` inside the project directory
- Temp files: `tmp/` inside the project directory

**Sandbox compliance**: all file operations (temp files, reports, config) MUST stay within the project directory. Never write to `/tmp/`, `~/Desktop/`, or any path outside the project root. This ensures the skill works correctly in sandboxed environments like Claude Code where filesystem access is restricted to the project directory.

## Mode Detection

Parse `$ARGUMENTS` to determine the mode before entering any phase:

1. If `$ARGUMENTS` starts with `monthly` -> **monthly mode**
   - If followed by `YYYY-MM` -> that specific month
   - If no month specified -> current month (or previous month if today is in the first week)
2. If `$ARGUMENTS` contains two dates -> **weekly mode** with custom range
3. If `$ARGUMENTS` is empty -> **weekly mode**, default to past Monday-Friday

## Phase 0: Environment Setup and User Info

### Weekly mode

1. Check that `.claude/skills/status-skill/scripts/config/apps-script-url.txt` exists and contains a URL.
2. Ask the user for the following (if not already known from memory or previous sessions):
   - **Apps Script JSON data**: Ask the user to open their Apps Script web app URL in a browser and paste the JSON output. Provide the URL with appropriate query parameters:
     ```
     <apps-script-url>?start=YYYY-MM-DD&end=YYYY-MM-DD&user=<email>&userName=<Full%20Name>
     ```
     If no Apps Script URL is configured, ask the user to get the URL from a teammate (shared via Slack/team docs) and save it:
     ```
     echo "<url>" > .claude/skills/status-skill/scripts/config/apps-script-url.txt
     ```
   - **GitHub username**: Ask for their GitHub username to fetch development activity.

### Monthly mode

1. Scan `reports/YYYY-MM/` for existing weekly report files (matching `status-report-YYYY-MM-DD.md`, excluding `*-monthly.md`).
2. List found reports and how many weeks they cover.
3. If some weeks of the month are missing, ask:
   > "I found N weekly reports covering [dates]. The following weeks are missing: [list]. Would you like to generate them first, or proceed with what's available?"
4. Skip Apps Script URL check and GitHub username prompt -- those are only needed for raw data fetching.

## Phase 1: Fetch Data

### Phase 1 (Weekly): Fetch Raw Data

Parse `$ARGUMENTS` for start and end dates. If no dates provided, default to the past week (Monday-Friday).

#### Google Workspace data (Calendar, Email, Transcripts)

The user must paste the JSON output from their Apps Script URL in their browser. The script cannot be called directly from the CLI due to corporate SSO restrictions.

Save the pasted JSON to `tmp/status-report-data.json`.

#### GitHub activity

Run the GitHub fetch script:
```
cd .claude/skills/status-skill/scripts && node fetch-github.js --user <github-username> --start YYYY-MM-DD --end YYYY-MM-DD --output ../../tmp/github-activity.json
```

Read the output file `tmp/github-activity.json` to get the GitHub data.

If any data source has an `error` field, inform the user but continue with available data.

### Phase 1 (Monthly): Read Weekly Reports

Read all weekly report files from `reports/YYYY-MM/`:
- Glob for `reports/YYYY-MM/status-report-YYYY-MM-DD.md` (exclude `*-monthly.md`)
- Read each file in chronological order
- These become the source data for Phase 2

## Phase 2: Analyze Data

### Weekly mode: raw data analysis

Review all fetched data and organize it:

#### Calendar Events
- Count total meetings and meeting hours
- Categorize each meeting into one of:
  - **Standup/Sync**: recurring daily or frequent short meetings
  - **1:1**: two-person meetings, often with manager or direct reports
  - **Project Meeting**: meetings with 3+ attendees on specific topics
  - **External**: meetings with attendees outside the organization
  - **Focus/Block Time**: calendar blocks for individual work
- Identify key meetings (non-recurring, project-specific, or external)

#### Sent Emails
- Group by topic/thread when possible
- Identify key themes (project updates, reviews, requests, decisions)
- Note significant recipients (leadership, cross-team, external)

#### Meeting Transcripts
- For each transcript with user contributions:
  - Summarize what the user discussed or presented
  - Identify decisions made or action items taken
  - Note key topics the user spoke about
- If transcript content couldn't be parsed (Gemini Notes format), use the meeting title for context

#### GitHub Activity
- Summarize commits by repository (group related commits, describe outcomes not git mechanics)
- ALWAYS use full repository names including the org/owner prefix (e.g., `myorg/my-project`, NOT just `my-project`)
- List PRs opened, merged, and reviewed
- List issues opened and closed
- Note any new repositories created
- Highlight cross-team collaboration (reviews on other teams' repos, upstream contributions)

### Monthly mode: weekly report analysis

Parse each weekly report to extract:
- Workstream names and their status tags
- Sub-bullets (outcomes, decisions, artifacts)
- Blockers and at-risk items
- Recurring meeting lists
- Development items (org/repo entries)

### Analysis enrichment (both modes)

After the mode-specific analysis above, apply these additional analysis steps:

#### Workstream normalization

Scan all data for recurring topics across calendar, email, GitHub, and transcripts. Group them into named workstreams. Normalize names to the most current version.

- **Weekly**: note original names parenthetically when a name was normalized (e.g., "Ansible Grand Prix (formerly Ansible Alliance Quest)") so that monthly consolidation can detect name drift across weeks.
- **Monthly**: normalize across all weeks to the most current name used. If a workstream was called different things in different weeks, use the latest name throughout.

#### Outcome extraction

For each meeting or activity, identify what was decided, delivered, or unblocked -- not just that it happened. Prefer verbs like "agreed", "confirmed", "selected", "shipped", "resolved" over "discussed", "synced", "met about".

#### Blocker detection

Flag any item with language like "pending", "waiting", "TBC", "still outstanding", "not yet confirmed". Also flag:
- Items involving dependencies on third parties or other teams
- Items that slipped from previous weeks without resolution (monthly mode)

Collect these into a blockers list for Phase 3 confirmation.

#### Routine meeting detection

Identify recurring calendar events with no specific outcome. Mark them for collapsing into a single "Recurring:" line in the output. A recurring meeting becomes "significant" if:
- It had an external guest
- A notable decision was made
- It was a first occurrence
- Something one-off happened in that instance

## Phase 3: Present Summary and Ask Clarifying Questions

Present a brief summary of what was found across all data sources, then ask targeted questions.

### Questions for both modes

1. "What is the current status of [key workstream]? (Done / WIP / Blocked)" -- for each identified workstream
2. "I noticed these potential blockers: [list]. Are any actively blocking progress?"
3. "These recurring meetings had no notable outcomes in my analysis: [list]. Should any be called out separately, or should I collapse them all into a single Recurring line?"
4. "What were your top 2-3 outcomes this [week/month] that the data doesn't fully capture?"
5. "Any items to escalate or flag as at-risk?"
6. "What are your priorities for next [week/month]?"

### Weekly-only questions

1. "I found N meetings this week including [key meetings]. What were the most important outcomes or decisions from these?"
2. "You sent N emails, with themes around [topics]. Any notable progress or completions worth highlighting?"
3. "From your meeting transcripts, I see you discussed [topics]. Anything to add or correct about these?"
4. "On GitHub, you had N commits across [repos], [N PRs], [N issues]. Anything to highlight about this development work?"

### Monthly-only questions

1. "I identified these ongoing workstreams across multiple weeks: [list]. Are the names correct? Any that should be merged or renamed?"
2. "Which of these workstreams were completed this month, and which carry into next month?"

Wait for the user to respond to all questions before proceeding.

## Phase 3.5: Slack Message Enrichment

**Monthly mode**: skip this phase. Slack context was already incorporated into the individual weekly reports.

**Weekly mode**: since there is no Slack API access, ask the user to paste relevant Slack messages to add detail to the report.

For each key project or topic identified from the calendar, email, and GitHub analysis:
- Ask: "Do you have any Slack messages related to **[topic/project]** you'd like to include? Paste them here, or type 'skip' to move on."

For meetings that likely had Slack follow-up:
- Ask: "Any Slack follow-ups from **[meeting name]** worth including?"

When the user pastes Slack messages:
- Extract the relevant details (decisions, updates, action items)
- Note the channel/context if visible
- Incorporate into the appropriate report section

When the user types "skip" or "done", move to the next topic or proceed to report generation.

Do NOT ask about every single meeting or topic -- focus on the 3-5 most significant ones to avoid overwhelming the user.

## Phase 4: Generate Report

Output the status report inside a fenced code block (```markdown) so the user gets a copy button in the Claude Code UI. Also save to the appropriate path (see Output Paths below).

### Output Paths

- **Weekly**: `reports/YYYY-MM/status-report-YYYY-MM-DD.md` (using the end date of the week)
- **Monthly**: `reports/YYYY-MM/status-report-YYYY-MM-monthly.md`

Create the `reports/YYYY-MM/` directory if it does not exist.

### Grouped Sub-bullet Format

Use one parent line per workstream or project, with indented sub-bullets for individual outcomes, decisions, or actions. This separates "what it is" from "what happened."

Apply this format to any item with 2+ distinct outcomes. Single-outcome items can remain on one line.

Example:
```
Summit 2026 [BO2518 - Bancolombia Breakout] [WIP]
  - template deck shared with both speakers
  - speaker notes repo created
  - customer kickoff meeting being planned
  [BLOCKED: third speaker confirmation still pending]
```

### Status Tags

Add inline status tags to workstream parent lines:

| Tag | Meaning |
|-----|---------|
| [WIP] | In progress, on track |
| [DONE] | Completed this period |
| [BLOCKED: reason] | Blocked -- state the reason |
| [AT RISK: reason] | At risk -- state the concern |

Tags appear after the workstream name on the parent line. Blockers and at-risk items get their own indented line within the sub-bullets, not buried in sentences.

### Writing Guidelines

- **Outcome-first language** -- lead every sub-bullet with what was decided, delivered, or resolved -- not the activity. If a bullet starts with "met", "discussed", "synced", "attended" -- rewrite it to start with the outcome instead.
- **Direct and concise** -- write bullets as quick notes, not formal sentences
- **Include who and why** -- "Met with Acme Corp team including sales and consulting" not just "Customer meeting"
- **Name names** -- customers, partners, teammates involved
- **Link to artifacts** -- YouTube videos, Slack threads, docs, decks, Gemini notes
- **Mark WIP inline** -- use [WIP] tag on the parent line
- **Separate development work** -- list under "development:" with org/repo prefix
- **Describe outcomes not git mechanics** -- "Resolved critical CI pipeline issues" not "pushed 5 commits"
- **Always use full org/repo names** -- `myorg/my-project` not `my-project`
- **Group related small items** -- "org/ssl-certs, org/mcp-tools: Applied minor config changes across these projects"
- **Collapse routine meetings** -- 1:1s, standups, recurring community meetings -> single "Recurring:" line unless they had notable outcomes
- **Use status tags** -- every workstream parent line gets a status tag

### Weekly Report Template

```
[User's Full Name] - Week of [Month Day]

[Workstream Name] [status tag]
  - outcome or decision
  - artifact created or shared
  [BLOCKED: reason]

[Single-outcome item] [status tag if relevant]

Recurring: [collapsed list of routine meetings and 1:1s]

development:
[org/repo]: [outcome-focused description]. N commits, N PRs merged.
```

### Weekly Report Example

```
Jane Smith - Week of Feb 23

Summit 2026 [BO2518 - Bancolombia Breakout] [WIP]
  - co-presenter Andres Acevedo (Bancolombia) confirmed
  - session deck created from official Summit speaker template
  - internal sync held with Jose Calvo, Facundo Jaspe, Mauricio Palacio Elorza
  [BLOCKED: third speaker confirmation still pending]

Summit 2026 [LT2249 - AAP + NetBox] [WIP]
  - circuit-down selected as primary demo scenario with Mark York (NetBox Labs)
  - dev NetBox and AAP instances live
  [AT RISK: MCP servers setup still pending]

Enablement sync with Pat Lee - AIOps training delivery plan agreed [DONE]
Cisco DevNet monthly sync - automation alignment with Will Kinard, Marco Mazzotti (Cisco), Elle Lathram [WIP]

Recurring: 1:1s (Andrius, Tim Appnel), TeaMM, Community & PE, Ansible-Networking, AAP Office Hours

development:
org/api-gateway: Resolved two critical issues with authentication handling and CI build failures, updated entrypoint script and project docs. 8 commits, 2 PRs merged.
org/workshops: Updated workshop exercises to reflect platform version migration from 6.15 to 6.18. 3 commits, 1 PR merged.
```

### Monthly Report Template

When generating a monthly report, prepend a summary section before the weekly breakdown:

```
[User's Full Name] - [Month Year]


=== [MONTH] SUMMARY ===

Shipped / completed:
- [deliverable]: [one-line outcome]

Carrying into [next month]:
- [workstream]: [status and what remains]

Blockers / at risk:
- [item]: [reason]


--- Week of [Date] ---

[Workstream Name] [status tag]
  - outcome or decision
  [BLOCKED: reason]

[Single-outcome item]

Recurring: [collapsed list]

development:
[org/repo]: [outcome-focused description]. N commits, N PRs merged.


--- Week of [Date] ---
[...repeat for each week...]
```

The monthly summary block is synthesized from all weekly sections:
- **Shipped / completed**: workstreams that reached [DONE] during the month, with their key outcome
- **Carrying into [next month]**: workstreams still [WIP] at month end, with what remains
- **Blockers / at risk**: any [BLOCKED] or [AT RISK] items still unresolved at month end

## Phase 5: Review

After generating the report:
1. The report is already displayed in the code block with a copy button
2. Ask: "Would you like to adjust anything? If not, click the copy button above and paste into your Google Doc."
3. If the user requests changes, regenerate the report in a new code block

## Error Handling

- If the Apps Script URL is not configured, ask the user to get it from a teammate and save it to `.claude/skills/status-skill/scripts/config/apps-script-url.txt`
- If the user can't paste JSON (Apps Script issues), proceed with GitHub data and user input only
- If `gh` CLI is not authenticated, skip GitHub activity and note the gap
- If individual data sources fail, proceed with available data and note the gap
- If no transcripts are found, that's normal -- not all meetings have transcripts enabled
- **Monthly: no weekly reports found** -- offer to generate them one by one using weekly mode, then return to monthly consolidation
- **Monthly: partial weeks** -- list which weeks are available and which are missing, ask whether to proceed with partial data or generate the missing weeks first
