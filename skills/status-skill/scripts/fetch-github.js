#!/usr/bin/env node

/**
 * Fetch GitHub activity for a user within a date range using the `gh` CLI.
 * Collects: commits, PRs opened/merged/reviewed, issues opened/closed, repos created.
 *
 * Usage:
 *   node fetch-github.js --user anshulbehl [--start 2026-02-02] [--end 2026-02-06] [--output path/to/output.json]
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";

function parseArgs(args) {
  const parsed = {
    user: null,
    start: null,
    end: null,
    output: null,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--user":
        parsed.user = args[++i];
        break;
      case "--start":
        parsed.start = args[++i];
        break;
      case "--end":
        parsed.end = args[++i];
        break;
      case "--output":
        parsed.output = args[++i];
        break;
    }
  }

  if (!parsed.user) {
    console.error("Error: --user is required");
    process.exit(1);
  }

  // Default: Monday to Friday of current/past week
  if (!parsed.start || !parsed.end) {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysToMonday);
    if (daysToMonday === 0) {
      monday.setDate(monday.getDate() - 7);
    }
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    parsed.start = monday.toISOString().slice(0, 10);
    parsed.end = friday.toISOString().slice(0, 10);
  }

  if (!parsed.output) {
    parsed.output = `tmp/github-activity-${parsed.start}-to-${parsed.end}.json`;
  }

  return parsed;
}

function ghApi(endpoint) {
  try {
    const result = execSync(
      `gh api "${endpoint}" --cache 1h`,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }
    );
    return JSON.parse(result);
  } catch (err) {
    console.error(`Warning: gh api call failed for ${endpoint}: ${err.message}`);
    return { total_count: 0, items: [] };
  }
}

function fetchGitHubActivity(user, start, end) {
  const dateRange = `${start}..${end}`;

  console.error(`Fetching GitHub activity for ${user} (${start} to ${end})...`);

  // Commits authored
  console.error("  - commits...");
  const commits = ghApi(
    `/search/commits?q=author:${user}+author-date:${dateRange}&sort=author-date&order=desc&per_page=100`
  );

  // PRs opened
  console.error("  - PRs opened...");
  const prsOpened = ghApi(
    `/search/issues?q=author:${user}+type:pr+created:${dateRange}&sort=created&order=desc&per_page=100`
  );

  // PRs merged
  console.error("  - PRs merged...");
  const prsMerged = ghApi(
    `/search/issues?q=author:${user}+type:pr+is:merged+merged:${dateRange}&sort=updated&order=desc&per_page=100`
  );

  // PRs reviewed
  console.error("  - PRs reviewed...");
  const prsReviewed = ghApi(
    `/search/issues?q=reviewed-by:${user}+type:pr+updated:${dateRange}&sort=updated&order=desc&per_page=100`
  );

  // Issues opened
  console.error("  - issues opened...");
  const issuesOpened = ghApi(
    `/search/issues?q=author:${user}+type:issue+created:${dateRange}&sort=created&order=desc&per_page=100`
  );

  // Issues closed (user involvement)
  console.error("  - issues closed...");
  const issuesClosed = ghApi(
    `/search/issues?q=involves:${user}+type:issue+is:closed+closed:${dateRange}&sort=updated&order=desc&per_page=100`
  );

  // Repos created
  console.error("  - repos created...");
  const reposCreated = ghApi(
    `/search/repositories?q=user:${user}+created:${dateRange}&sort=created&order=desc&per_page=100`
  );

  return {
    meta: {
      username: user,
      start_date: start,
      end_date: end,
      retrieved_at: new Date().toISOString(),
    },
    commits: {
      total_count: commits.total_count || 0,
      repos: [...new Set((commits.items || []).map((c) => c.repository?.full_name).filter(Boolean))].sort(),
      details: (commits.items || []).map((c) => ({
        repo: c.repository?.full_name,
        message: c.commit?.message?.split("\n")[0] || "",
        date: c.commit?.author?.date,
        sha: c.sha?.slice(0, 7),
        url: c.html_url,
      })),
    },
    pull_requests_opened: {
      total_count: prsOpened.total_count || 0,
      details: (prsOpened.items || []).map((pr) => ({
        repo: pr.repository_url?.replace("https://api.github.com/repos/", ""),
        title: pr.title,
        url: pr.html_url,
        state: pr.state,
        created_at: pr.created_at,
      })),
    },
    pull_requests_merged: {
      total_count: prsMerged.total_count || 0,
      details: (prsMerged.items || []).map((pr) => ({
        repo: pr.repository_url?.replace("https://api.github.com/repos/", ""),
        title: pr.title,
        url: pr.html_url,
        merged_at: pr.pull_request?.merged_at,
      })),
    },
    pull_requests_reviewed: {
      total_count: prsReviewed.total_count || 0,
      details: (prsReviewed.items || []).map((pr) => ({
        repo: pr.repository_url?.replace("https://api.github.com/repos/", ""),
        title: pr.title,
        url: pr.html_url,
      })),
    },
    issues_opened: {
      total_count: issuesOpened.total_count || 0,
      details: (issuesOpened.items || []).map((issue) => ({
        repo: issue.repository_url?.replace("https://api.github.com/repos/", ""),
        title: issue.title,
        url: issue.html_url,
        created_at: issue.created_at,
      })),
    },
    issues_closed: {
      total_count: issuesClosed.total_count || 0,
      details: (issuesClosed.items || []).map((issue) => ({
        repo: issue.repository_url?.replace("https://api.github.com/repos/", ""),
        title: issue.title,
        url: issue.html_url,
        closed_at: issue.closed_at,
      })),
    },
    repositories_created: {
      total_count: reposCreated.total_count || 0,
      details: (reposCreated.items || []).map((repo) => ({
        full_name: repo.full_name,
        description: repo.description || "",
        url: repo.html_url,
        created_at: repo.created_at,
      })),
    },
  };
}

const config = parseArgs(process.argv.slice(2));
const activity = fetchGitHubActivity(config.user, config.start, config.end);

writeFileSync(config.output, JSON.stringify(activity, null, 2));
console.error(`GitHub activity saved to ${config.output}`);
console.log(config.output);
