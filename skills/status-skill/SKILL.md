---
name: status-skill
description: "Generate a weekly status report for your manager by analyzing Google Calendar events, sent emails, Google Meet transcripts, Google Docs/Slides activity, GitHub commits/PRs, and Slack messages. Use this skill whenever the user mentions status reports, weekly updates, manager updates, what they worked on this week, or wants to summarize their work activity. Run with /status-skill for the past week, or /status-skill 2026-02-23 2026-03-01 for a custom date range."
argument-hint: "[start-date end-date] (default: past week Mon-Fri)"
---

# Weekly Status Report Generator

Generate a status report by combining data from six sources: Google Calendar, Gmail, Google Meet transcripts, Google Docs/Slides activity, GitHub, and Slack. The Google Workspace data comes from an Apps Script web app that the user opens in their browser and pastes the JSON output. GitHub data is fetched directly via `gh` CLI. Slack data is fetched automatically via MCP tools when the Slack MCP server is configured.

This separation exists because corporate SSO prevents direct API calls to Google Workspace from the CLI, while GitHub's `gh` CLI and the Slack MCP server work natively.

## Setup

- **Apps Script URL config**: `scripts/config/apps-script-url.txt` (save the deployed URL here, get it from a teammate)
- **GitHub fetch script**: `scripts/fetch-github.js` (requires `gh` CLI authenticated via `gh auth login`)
- **Slack MCP server**: Optional but recommended. When configured, Slack messages are fetched automatically. See the README for setup instructions.
- **Data format reference**: `references/data-format.md` (full JSON schema for all data sources -- read this if you need to understand a specific field)

## Phase 0: Gather User Info

Check memory for all four values first. If any are missing, ask the user and then suggest they save all of them to memory in one go so future runs skip this phase entirely.

1. **Full name** (for transcript speaker matching and report header)
2. **Work email** (for the Apps Script URL query parameters)
3. **GitHub username** (for fetching dev activity)
4. **Apps Script URL**: Check if `scripts/config/apps-script-url.txt` exists. If not, ask the user to get the deployed web app URL from a teammate (it's shared per-org via Slack or team docs) and save it:
   ```
   echo "<url>" > scripts/config/apps-script-url.txt
   ```

After gathering any missing values, prompt: "Want me to save your name, email, GitHub username, and Apps Script URL to memory so you don't have to enter them again?"

## Phase 1: Fetch Data

Parse `$ARGUMENTS` for optional start and end dates. Default to the past week (Monday through Friday) if none provided.

### Google Workspace data

Ask the user to open this URL in their browser and paste the JSON output:

```
<apps-script-url>?start=YYYY-MM-DD&end=YYYY-MM-DD&user=<email>&userName=<Full%20Name>
```

Save the pasted JSON to `tmp/workspace-data-YYYY-MM-DD.json` (using the report end date) inside the project directory. Never use `/tmp/` or any path outside the project.

The JSON contains these top-level keys. Each section may have an `error` field if that data source failed -- note any errors but continue with available data.

- `metadata` -- date range, user info, generation timestamp
- `calendar` -- `total`, `totalMeetingMinutes`, and `events[]` array with `summary`, `start`, `end`, `durationMinutes`, `attendees[]`, `organizer`, `isRecurring`, `isAllDay`
- `email` -- `sent[]` array with `subject`, `to`, `date`, `snippet`; plus `received_summary` with `total` count and `top_senders[]`
- `transcripts` -- `transcripts[]` array with `meeting_title`, `doc_url`, `participants[]`, `user_contributions[]` (each has `timestamp` and `text`)
- `documents` -- `documents[]` array with `name`, `type` (doc/slides), `url`, `isOwner`, `wasCreatedThisWeek`

### GitHub activity

Run the GitHub fetch script:

```
cd <skill-directory>/scripts && node fetch-github.js --user <github-username> --start YYYY-MM-DD --end YYYY-MM-DD --output <project-dir>/tmp/github-activity-YYYY-MM-DD.json
```

The script prints the output file path. Read that file. It contains:

- `commits` -- `total_count`, `repos[]` (full org/repo names), `details[]` with `repo`, `message`, `date`, `url`
- `pull_requests_opened`, `pull_requests_merged`, `pull_requests_reviewed` -- each with `total_count` and `details[]`
- `issues_opened`, `issues_closed` -- each with `total_count` and `details[]`
- `repositories_created` -- any new repos

### Slack activity

Check if the Slack MCP server is available by calling `mcp__slack__whoami`. If it fails or the tool is not available, skip Slack data collection and note the gap. The `whoami` call returns the authenticated user's Slack username.

If the Slack MCP is available, run three searches (use the date range from Phase 1, adding one day to the end date since Slack's `before:` is exclusive). Set `limit` to 200 for each.

1. **Messages sent by the user**: Call `mcp__slack__search_messages` with query `from:me after:YYYY-MM-DD before:YYYY-MM-DD`.

2. **Messages sent to the user**: Call `mcp__slack__search_messages` with query `to:me after:YYYY-MM-DD before:YYYY-MM-DD`. This captures DMs and direct messages others sent to the user.

3. **Messages mentioning the user**: Call `mcp__slack__search_messages` with query `@username after:YYYY-MM-DD before:YYYY-MM-DD` where `username` is from the `whoami` result. This captures channel messages where others tagged the user.

Deduplicate across all three result sets (the same message can appear in multiple searches).

Save the combined Slack results to `tmp/slack-activity-YYYY-MM-DD.json` (using the report end date) inside the project directory for reference.

Note: The Slack MCP uses browser session tokens, not an OAuth app. If the tokens have expired, the API calls will fail. Tell the user to refresh their tokens (see README) and skip Slack data for this run.

## Phase 2: Analyze Data

### Calendar Events
- Count total meetings and meeting hours
- Categorize meetings: Standup/Sync (recurring short), 1:1 (two-person), Project Meeting (3+ attendees), External (outside org attendees), Focus/Block Time
- Identify key meetings -- non-recurring, project-specific, or external ones that represent real work

### Sent Emails
- Group by topic/thread
- Identify key themes (project updates, reviews, requests, decisions)
- Note significant recipients (leadership, cross-team, external)

### Meeting Transcripts
- For transcripts with user contributions: summarize what the user discussed, decisions made, action items
- If transcript content has errors or is in Gemini Notes format, use the meeting title for context

### Google Docs/Slides Activity
- Note documents created this week (new artifacts worth mentioning)
- Note documents the user owns vs. contributed to
- Presentations often indicate demos, talks, or customer-facing work

### GitHub Activity
- Summarize commits by repository, grouping related commits and describing outcomes (not git mechanics)
- Use full org/repo names (e.g., `myorg/my-project`, not just `my-project`)
- List PRs opened, merged, and reviewed
- Highlight cross-team collaboration (reviews on other teams' repos)

### Slack Messages (if available)
- Group messages by channel or topic thread
- Identify key themes: project updates, decisions, action items, questions answered, help provided
- Note significant interactions: cross-team conversations, leadership threads, customer-related discussions
- Look for decisions or commitments made in Slack that should appear in the status report
- Skip routine messages (greetings, acknowledgments, simple reactions) and focus on substantive content
- Note channels where the user was most active as context for their work areas

### Cross-Source Correlation (if Slack data available)

After analyzing each source individually, look for connections across Google Workspace and Slack data. The goal is to build a richer picture of each work item by linking related signals from different sources.

**Calendar to Slack**: Match meeting titles and attendee names against Slack channel names, message content, and participants. A calendar event "Acme Corp Migration Sync" likely has related Slack messages in a channel or thread mentioning "Acme" or "migration". Slack follow-ups after a meeting often contain action items and decisions that the calendar event alone does not capture.

**Email to Slack**: Match email subjects and recipients against Slack messages. The same topic is often discussed in both channels. Look for cases where an email thread and a Slack thread cover the same decision or deliverable.

**Transcripts to Slack**: Match transcript meeting titles and discussion topics against Slack threads. Meeting transcripts capture what was said in the meeting; Slack captures the before-and-after context (prep, follow-up, action items).

**Documents to Slack**: Match document names and links against Slack messages. When a doc or deck is shared in Slack, the surrounding conversation often explains why it was created and who it's for.

**GitHub to Slack**: Match repo names, PR titles, and commit messages against Slack messages. Slack often has the discussion behind a code change (why it was needed, who requested it, what it unblocked).

Build a list of **correlated work items**: topics or projects that appear in two or more data sources. For each correlated item, note which sources mention it and what each source adds. These correlated items are the strongest candidates for status report bullets because they represent substantive work with multiple touchpoints.

Also note **Slack-only items**: topics that appear in Slack but not in any Google Workspace or GitHub data. These may represent ad-hoc help, troubleshooting, or conversations that are worth mentioning but would otherwise be missed.

## Phase 3: Summary and Clarifying Questions

Present a brief summary of what was found, then ask targeted questions. The goal is to fill gaps that data alone can't capture -- the user knows the significance and context better than any data source.

1. "I found N meetings including [key ones]. What were the most important outcomes or decisions?"
2. "You sent N emails about [topics]. Any notable progress worth highlighting?"
3. "From transcripts, you discussed [topics]. Anything to add or correct?"
4. "On GitHub: N commits across [repos], N PRs. Anything to highlight?"
5. "I see you worked on [doc/slides names]. What were these for?"
6. If Slack data was collected: "From Slack, I see you were active in [channels/threads] discussing [topics]. Any key decisions or context to add?"
7. If correlated items were found, ask about the most significant ones: "I noticed [topic] came up in both your [meeting/email] and Slack conversations with [people]. What was the outcome or current status?" Focus on the top 3-5 correlated items to avoid overwhelming the user.
8. If Slack-only items were found: "I also saw Slack activity around [topic] that didn't match any meetings or emails. Worth including in your status?"
9. "Top 2-3 accomplishments this week that might not show up in the data?"
10. "Any blockers, risks, or items needing escalation?"
11. "Top priorities for next week?"

Wait for the user to respond before proceeding.

## Phase 3.5: Slack Context (if MCP not available)

If the Slack MCP server was not available in Phase 1, fall back to manual collection. Focus on the 3-5 most significant topics to avoid overwhelming the user.

For key projects/topics identified from the analysis:
- "Do you have any Slack messages related to [topic/project]? Paste them or type 'skip'."

For meetings that likely had Slack follow-up:
- "Any Slack follow-ups from [meeting name] worth including?"

Extract decisions, updates, and action items from pasted messages.

If Slack data was already fetched automatically in Phase 1, skip this phase entirely.

## Phase 4: Generate Report

Generate the report as a **markdown file**, then run the conversion script to produce HTML and Slack versions.

### Step 1: Generate Markdown

Write the report as a markdown file to `reports/YYYY-MM/status-report-YYYY-MM-DD.md` (using the end date). Use this structure:

```markdown
# [User's Full Name] - Week of [Month Day]

[N] things | [N] other things | [N] repos

## Highlights

- **Lead text** - short description of impact
- **Lead text** - short description of impact

## [Section Name]

- **Lead text** - description with context on who, why, and link to artifacts
- **Lead text** - description
  - **Sub-item lead** - nested detail

## Documents

- Doc name ([link](url))

## Development

- **org/repo-name**: Outcome-focused description of what was done and why
```

### Markdown format rules

- `#` for the report header (name and week)
- First line after the header: stats line with counts separated by `|`
- `## Highlights` with 3-5 top items, each as `- **Lead** - description`
- `##` sections for grouping activity items when 2+ items fit a natural category. Common categories include Customer Engagement, Partner Work, Content, Labs, Internal -- but let the actual data determine the groupings each week. Use Title Case for section names.
- Each activity item as `- **Lead text** - description`. The lead is the natural subject (person, project, event name) before the separator dash.
- Nested items indented with 2 spaces: `  - **Sub-item** - description`
- Links as standard markdown: `[text](url)`
- Use single dashes (` - `) as separators. Never use em dashes or smart quotes.
- `## Documents` with `- Doc name ([link](url))` for each
- `## Development` with `- **org/repo**: description` for each repo

### Writing guidelines

- **Direct and concise** -- write bullets as quick notes, not formal sentences
- **Include who and why** -- "Met with Acme Corp team including sales and consulting" not just "Customer meeting"
- **Name names** -- customers, partners, teammates involved
- **Link to artifacts** -- YouTube videos, Slack threads, docs, decks, Gemini notes
- **Mark WIP inline** -- "WIP - Network Refresh 2026" not a separate section
- **Describe outcomes not git mechanics** -- "Resolved critical CI pipeline issues" not "pushed 5 commits"
- **Always use full org/repo names** -- `myorg/my-project` not `my-project`
- **Group related small items** -- "org/ssl-certs, org/mcp-tools: Applied minor config changes across these projects"
- **Skip routine meetings** -- don't list daily standups or recurring syncs unless something notable happened

### Example

```markdown
# Jane Smith - Week of Feb 23

3 customer meetings | 2 documents | 4 repos

## Highlights

- **Acme Corp architecture review** - networking architecture questions resolved, database team looped in
- **AIOps workshop updated** - exercises migrated to platform v6.18

## Customer Engagement

- **Acme Corp** (Dana Kim) - networking architecture questions, looping in the database team
- **Nasdaq Sync** [Teleport] - helping out teammate on migration blockers

## Internal

- **Enablement sync with Pat Lee** - reviewed AIOps training delivery plan
- **Webinar planning sync** - Q1 AIOps webinar tracker
- **AI training coordination with Alex Chen** - product pitch prep

## Documents

- AIOps Workshop Deck - updated exercises for platform v6.18 ([link](https://example.com/deck))
- Q1 Planning Doc - created new quarterly objectives tracker ([link](https://example.com/doc))

## Development

- **org/api-gateway**: Resolved two critical issues with authentication handling and CI build failures, updated entrypoint script and project docs.
- **org/workshops**: Updated workshop exercises to reflect platform version migration from 6.15 to 6.18.
- **org/product-demos**: Cross-team code review for updates to the demo bootstrap branch.
- **org/ssl-certs, org/mcp-tools, org/service-config**: Applied minor configuration changes and documentation updates across these projects.
```

### Step 2: Convert to HTML and Slack

After generating the markdown file, run the conversion script:

```
cd <skill-directory>/scripts && node convert-report.js \
  --input <project-dir>/reports/YYYY-MM/status-report-YYYY-MM-DD.md \
  --html <project-dir>/reports/YYYY-MM/html/status-report-YYYY-MM-DD.html \
  --slack <project-dir>/reports/YYYY-MM/slack/status-report-YYYY-MM-DD.txt \
  --template <skill-directory>/templates/status-report.html
```

The script uses `marked` (vendored at `scripts/vendor/marked.js`) to parse the markdown and produces:
- **HTML** with Red Hat fonts and styling that pastes cleanly into Google Docs (open in browser, select all, paste)
- **Slack mrkdwn** that pastes directly into Slack with bold leads, blockquote highlights, and formatted links

## Phase 5: Review

1. Output the markdown report inside a fenced code block (```markdown) so the user gets a copy button
2. Tell the user: "I also generated an HTML version at reports/YYYY-MM/html/status-report-YYYY-MM-DD.html (open in browser, select all, paste into Google Docs) and a Slack version at reports/YYYY-MM/slack/status-report-YYYY-MM-DD.txt (copy and paste into Slack)."
3. Ask: "Would you like to adjust anything?"
4. If the user requests changes, regenerate the markdown file and re-run the conversion script

## Error Handling

- If the Apps Script URL is not configured, ask the user to get it from a teammate and save it to `scripts/config/apps-script-url.txt`
- If the user can't paste JSON, proceed with GitHub data, Slack data, and user input only
- If `gh` CLI is not authenticated, skip GitHub activity and note the gap
- If individual data sources fail (have `error` fields), proceed with what's available and note gaps
- If no transcripts are found, that's normal -- not all meetings have transcripts enabled
- If no documents are found, skip the documents section
- If the Slack MCP server is not configured or tokens have expired, fall back to manual Slack paste (Phase 3.5) or skip Slack entirely
- If Slack search returns no results for the date range, that's fine -- the user may not have been active in Slack that week
