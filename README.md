# Status Report Skill for Claude Code

A Claude Code skill that generates weekly and monthly status reports by pulling data from Google Calendar, Gmail, Google Meet transcripts, and GitHub activity. Monthly reports consolidate existing weekly report files into a month-level summary.

## Requirements

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [GitHub CLI (`gh`)](https://cli.github.com/) -- authenticated via `gh auth login`
- Access to a Google Workspace Apps Script web app (shared by your team)

## Quick Start

### 1. Install the skill

Clone this repo into your Claude Code skills directory:

```bash
git clone https://github.com/ansible-tmm/status-skill.git ~/.claude/skills/status-report
```

### 2. Configure the Apps Script URL

Get the Apps Script web app URL from your team (shared via Slack or team docs), then save it:

```bash
mkdir -p ~/.claude/skills/status-report/scripts/config
echo "<url-from-teammate>" > ~/.claude/skills/status-report/scripts/config/apps-script-url.txt
```

### 3. Run the skill

In Claude Code:

```
/status-report
```

With no arguments, it defaults to last week (Monday-Friday). You can also use natural language for the date range:

```
/status-report first week of February
/status-report last two weeks
/status-report 2026-02-24 2026-02-28
```

For monthly reports that consolidate existing weekly reports:

```
/status-report monthly
/status-report monthly 2026-03
```

## How It Works

### Weekly mode
1. **Google Workspace data**: You open the Apps Script URL in your browser and paste the JSON output (required due to corporate SSO)
2. **GitHub activity**: Fetched automatically via `gh` CLI
3. **Analysis**: Claude analyzes all data sources and asks clarifying questions
4. **Slack enrichment**: Optionally paste relevant Slack messages for additional context
5. **Report**: Generates a markdown status report saved to `reports/YYYY-MM/`

### Monthly mode
1. **Read weekly reports**: Reads existing weekly report files from `reports/YYYY-MM/`
2. **Consolidation**: Normalizes workstream names across weeks, synthesizes a month-level summary
3. **Report**: Generates a monthly report with a summary block + weekly detail sections

## File Structure

```
status-report/
  SKILL.md                          # Skill definition (Claude Code reads this)
  README.md                         # This file
  scripts/
    fetch-github.js                 # GitHub activity fetcher (uses gh CLI)
    config/
      apps-script-url.txt.example   # Setup instructions
      # apps-script-url.txt         <- gitignored, get URL from teammate
```

## Sharing the Apps Script URL

The Apps Script URL is gitignored because it contains a deployment ID. Share it with teammates via:
- Team Slack channel
- Internal wiki/docs
- Direct message

Since the web app is deployed with "Anyone within the organization" access, all org members can use the same URL.
