#!/usr/bin/env node
/**
 * Arka Intelligence - GitHub Data Export Script
 *
 * Exports pull requests, commits, issues, and contributors from a GitHub repository
 * into a JSON file that can be uploaded to Arka Intelligence.
 *
 * Usage:
 *   npm install
 *   npm run export -- <owner> [repo] [options]
 *
 * Example:
 *   npm run export -- myorg --output=data.json
 *   npm run export -- myorg myrepo --since=2025-01-01 --max-pages=50
 *
 * Options:
 *   --output=<file>      Output JSON file (default: arka-data.json)
 *   --org-slug=<slug>    Organization slug in Arka (default: repo owner)
 *   --since=<date>       Only export data after this date (YYYY-MM-DD)
 *   --max-pages=<n>      Maximum pages to fetch (default: 50, 100 items per page)
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";

// =============================================================================
// Types
// =============================================================================

interface GitHubPR {
  number: number;
  title: string;
  html_url: string;
  state: string;
  user: { login: string; id: number; avatar_url: string } | null;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  additions?: number;
  deletions?: number;
  commits: number;
  review_comments: number;
  labels: { name: string }[];
  requested_reviewers: { login: string }[];
  draft: boolean;
}

interface GitHubCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { date: string } | null;
    committer: { date: string } | null;
  };
  author: { login: string; id: number; avatar_url: string } | null;
  stats?: { additions: number; deletions: number };
}

interface GitHubReview {
  id: number;
  user: { login: string; id: number } | null;
  state: string;
  submitted_at: string;
  body: string;
}

interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  state: string;
  user: { login: string; id: number; avatar_url: string } | null;
  assignee: { login: string; id: number } | null;
  labels: { name: string }[];
  created_at: string;
  closed_at: string | null;
}

interface GitHubUser {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  avatar_url: string;
  type: string;
}

interface ExportOptions {
  owner: string;
  repo: string;
  orgSlug: string;
  outputFile: string;
  since?: Date;
  maxPages: number;
}

interface ExportPayload {
  metadata: {
    exportedAt: string;
    repository: string;
    organizationSlug: string;
    since: string | null;
    version: string;
  };
  contributors: Array<{
    externalUsername: string;
    externalId: string;
    displayName: string | null;
    email: string | null;
    avatarUrl: string | null;
  }>;
  pullRequests: Array<{
    externalId: string;
    externalUrl: string;
    title: string;
    authorUsername: string | null;
    state: "open" | "merged" | "closed";
    createdAt: string;
    mergedAt: string | null;
    closedAt: string | null;
    additions: number;
    deletions: number;
    commitsCount: number;
    reviewsCount: number;
    cycleTimeHours: number | null;
    metadata: {
      labels: string[];
      reviewers: string[];
      draft: boolean;
    };
  }>;
  commits: Array<{
    sha: string;
    externalUrl: string;
    prExternalId: string | null;
    authorUsername: string | null;
    message: string;
    committedAt: string;
    additions: number | null;
    deletions: number | null;
    isAiAssisted: boolean;
    aiTool: string | null;
    aiModel: string | null;
  }>;
  issues: Array<{
    externalId: string;
    externalUrl: string;
    title: string;
    authorUsername: string | null;
    assigneeUsername: string | null;
    state: "open" | "closed";
    createdAt: string;
    closedAt: string | null;
    resolvedAt: string | null;
    cycleTimeHours: number | null;
    metadata: {
      labels: string[];
    };
  }>;
  reviews: Array<{
    prExternalId: string;
    reviewerUsername: string | null;
    state: "approved" | "changes_requested" | "commented" | "dismissed";
    submittedAt: string;
    body: string | null;
  }>;
}

// =============================================================================
// Bot Detection
// =============================================================================

function isBot(username: string): boolean {
  const lower = username.toLowerCase();
  return (
    lower.endsWith("[bot]") ||
    lower.startsWith("dependabot") ||
    lower.startsWith("renovate") ||
    lower.startsWith("github-actions") ||
    lower.startsWith("codecov") ||
    lower.includes("-bot") ||
    lower.includes("_bot") ||
    lower === "web-flow"
  );
}

// =============================================================================
// AI Tool Detection
// =============================================================================

function detectAiTool(message: string): {
  isAiAssisted: boolean;
  tool: string | null;
  model: string | null;
} {
  const lower = message.toLowerCase();

  if (lower.includes("cursor:") || lower.includes("generated by cursor")) {
    return { isAiAssisted: true, tool: "Cursor", model: null };
  }

  if (
    lower.includes("copilot") ||
    lower.includes("co-pilot") ||
    lower.includes("github copilot")
  ) {
    return { isAiAssisted: true, tool: "GitHub Copilot", model: null };
  }

  if (lower.includes("claude") || lower.includes("anthropic")) {
    const match = message.match(/claude[\s-]*([\w.-]+)/i);
    return {
      isAiAssisted: true,
      tool: "Claude",
      model: match?.[1] || null,
    };
  }

  if (lower.includes("chatgpt") || lower.includes("gpt-")) {
    const match = message.match(/gpt-([\w.-]+)/i);
    return {
      isAiAssisted: true,
      tool: "ChatGPT",
      model: match ? `gpt-${match[1]}` : null,
    };
  }

  return { isAiAssisted: false, tool: null, model: null };
}

// =============================================================================
// GitHub API Helpers
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ghApi<T>(
  endpoint: string,
  params: Record<string, string> = {},
  retries = 3
): Promise<T> {
  const queryStr = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");

  const fullEndpoint = queryStr ? `${endpoint}?${queryStr}` : endpoint;
  const cmd = `gh api "${fullEndpoint}"`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = execSync(cmd, {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return JSON.parse(result);
    } catch (error: any) {
      const stderr = error.stderr?.toString() || "";
      const stdout = error.stdout?.toString() || "";

      if (stdout.includes('"status":"404"') || stdout.includes("Not Found")) {
        throw new Error(`Not found: ${endpoint}`);
      }

      const isConnectionError =
        stderr.includes("connection refused") ||
        stderr.includes("connection reset") ||
        stderr.includes("dial tcp");

      if (isConnectionError && attempt < retries) {
        const waitTime = Math.pow(2, attempt) * 2000;
        console.log(
          `Connection error, waiting ${waitTime / 1000}s before retry ${attempt + 1}/${retries}...`
        );
        await sleep(waitTime);
        continue;
      }

      if (
        (stdout.includes("rate limit") || stderr.includes("rate limit")) &&
        attempt < retries
      ) {
        const waitTime = Math.pow(2, attempt) * 1000;
        console.log(
          `Rate limited, waiting ${waitTime / 1000}s before retry ${attempt + 1}/${retries}...`
        );
        await sleep(waitTime);
        continue;
      }

      if (attempt === retries) {
        throw error;
      }

      const waitTime = Math.pow(2, attempt) * 500;
      await sleep(waitTime);
    }
  }

  throw new Error(`Failed after ${retries} retries`);
}

async function ghApiPaginated<T>(
  endpoint: string,
  params: Record<string, string> = {},
  maxPages = 10
): Promise<T[]> {
  const results: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    if (page > 1) await sleep(100);

    const pageResults = await ghApi<T[]>(endpoint, {
      ...params,
      per_page: "100",
      page: String(page),
    });

    if (!pageResults || pageResults.length === 0) break;
    results.push(...pageResults);

    if (page % 10 === 0) {
      console.log(`  Fetched page ${page}, ${results.length} items so far...`);
    }

    if (pageResults.length < 100) break;
  }

  return results;
}

async function fetchGitHubUserProfile(
  username: string
): Promise<GitHubUser | null> {
  try {
    return await ghApi<GitHubUser>(`users/${username}`);
  } catch {
    return null;
  }
}

async function fetchOrgMemberEmailMap(
  owner: string
): Promise<Map<string, string>> {
  const emailMap = new Map<string, string>();
  let cursor: string | null = null;

  while (true) {
    const afterClause = cursor ? `, after: "${cursor}"` : "";
    const query = `query { organization(login: "${owner}") { membersWithRole(first: 100${afterClause}) { nodes { login email } pageInfo { hasNextPage endCursor } } } }`;

    try {
      const cmd = `gh api graphql -f query='${query.replace(/'/g, "'\\''")}'`;
      const result = execSync(cmd, {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const data = JSON.parse(result);
      const membersData = data?.data?.organization?.membersWithRole;

      if (!membersData) break;

      for (const node of membersData.nodes) {
        if (node.login && node.email) {
          emailMap.set(node.login, node.email);
        }
      }

      if (!membersData.pageInfo.hasNextPage) break;
      cursor = membersData.pageInfo.endCursor;
    } catch (error: any) {
      const stderr = error.stderr?.toString() || "";
      const stdout = error.stdout?.toString() || "";
      if (cursor !== null) {
        // Failed mid-pagination — warn so the user knows emails may be incomplete
        console.warn(
          `Warning: failed to fetch all org member emails (got ${emailMap.size} so far). ` +
          `Emails for remaining members will fall back to public profile.`
        );
        if (stderr.includes("rate limit") || stdout.includes("rate limit")) {
          console.warn("Rate limit hit — consider re-running after the limit resets.");
        }
      }
      // First-page failure = not an org or no admin access, skip silently
      break;
    }
  }

  return emailMap;
}

interface GitHubRepo {
  name: string;
  archived: boolean;
}

async function fetchAllRepos(owner: string): Promise<string[]> {
  console.log(`Fetching all repos for ${owner}...`);

  let repos: GitHubRepo[] = [];

  // Try org repos first (works for org admins and gets private repos)
  try {
    repos = await ghApiPaginated<GitHubRepo>(`orgs/${owner}/repos`, {
      type: "all",
    }, 100);
  } catch {
    // Fall back to user repos
    repos = await ghApiPaginated<GitHubRepo>(`users/${owner}/repos`, {
      type: "all",
    }, 100);
  }

  const names = repos.filter((r) => !r.archived).map((r) => r.name);
  console.log(`Found ${names.length} repos (${repos.length - names.length} archived skipped)`);
  return names;
}

interface PrDetails {
  additions: number;
  deletions: number;
  commits: Array<{
    sha: string;
    message: string;
    authorUsername: string | null;
    authorDate: string;
    additions: number | null;
    deletions: number | null;
  }>;
}

async function fetchPrDetailsBatch(
  owner: string,
  repo: string,
  prNumbers: number[]
): Promise<Map<number, PrDetails>> {
  const results = new Map<number, PrDetails>();
  // Reduced from 100 to keep GraphQL response size manageable when including commits
  const batchSize = 25;

  for (let i = 0; i < prNumbers.length; i += batchSize) {
    const batch = prNumbers.slice(i, i + batchSize);

    const prQueries = batch
      .map(
        (num, idx) =>
          `pr${idx}: pullRequest(number: ${num}) {
            number additions deletions
            commits(first: 250) {
              nodes { commit { oid message author { date user { login } } additions deletions } }
            }
          }`
      )
      .join("\n");

    const query = `query { repository(owner: "${owner}", name: "${repo}") { ${prQueries} } }`;

    try {
      const cmd = `gh api graphql -f query='${query.replace(/'/g, "'\\''")}'`;
      const result = execSync(cmd, {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const data = JSON.parse(result);
      const repoData = data?.data?.repository || {};

      for (let idx = 0; idx < batch.length; idx++) {
        const pr = repoData[`pr${idx}`];
        if (pr && pr.number != null) {
          results.set(pr.number, {
            additions: pr.additions || 0,
            deletions: pr.deletions || 0,
            commits: (pr.commits?.nodes || []).map((node: any) => ({
              sha: node.commit.oid,
              message: node.commit.message,
              authorUsername: node.commit.author?.user?.login || null,
              authorDate: node.commit.author?.date || new Date().toISOString(),
              additions: node.commit.additions ?? null,
              deletions: node.commit.deletions ?? null,
            })),
          });
        }
      }
    } catch (error) {
      console.log(
        `GraphQL batch failed, falling back to individual fetches for ${batch.length} PRs`
      );
      for (const prNum of batch) {
        try {
          const pr = await ghApi<GitHubPR>(
            `repos/${owner}/${repo}/pulls/${prNum}`
          );
          // Fetch PR commits via REST as fallback (no per-commit stats available here)
          const prCommits = await ghApi<Array<{
            sha: string;
            html_url: string;
            commit: { message: string; author: { date: string } | null };
            author: { login: string } | null;
          }>>(`repos/${owner}/${repo}/pulls/${prNum}/commits`);
          results.set(prNum, {
            additions: pr.additions || 0,
            deletions: pr.deletions || 0,
            commits: prCommits.map((c) => ({
              sha: c.sha,
              message: c.commit.message,
              authorUsername: c.author?.login || null,
              authorDate: c.commit.author?.date || new Date().toISOString(),
              additions: null,
              deletions: null,
            })),
          });
        } catch {
          // Skip if individual fetch fails
        }
      }
    }

    if (i + batchSize < prNumbers.length) {
      await sleep(200);
    }
  }

  return results;
}

// =============================================================================
// Helpers
// =============================================================================

function calculateCycleTimeHours(
  start: string,
  end: string | null
): number | null {
  if (!end) return null;
  const hours =
    (new Date(end).getTime() - new Date(start).getTime()) / (1000 * 60 * 60);
  return parseFloat(hours.toFixed(2));
}

// =============================================================================
// Export Functions
// =============================================================================

async function exportPullRequests(
  options: ExportOptions
): Promise<{ pullRequests: ExportPayload["pullRequests"]; reviews: ExportPayload["reviews"]; commits: ExportPayload["commits"] }> {
  const { owner, repo, since, maxPages } = options;

  console.log(`Fetching PRs from ${owner}/${repo}...`);

  const prs = await ghApiPaginated<GitHubPR>(
    `repos/${owner}/${repo}/pulls`,
    { state: "all", sort: "updated", direction: "desc" },
    maxPages
  );

  const filteredPrs = since
    ? prs.filter((pr) => new Date(pr.created_at) >= since)
    : prs;

  console.log(`Processing ${filteredPrs.length} PRs...`);

  // Check which PRs need details fetched
  const prsNeedingDetails = filteredPrs
    .filter((pr) => pr.additions === undefined || pr.additions === null)
    .map((pr) => pr.number);

  console.log(
    `Fetching additions/deletions for ${prsNeedingDetails.length} PRs via GraphQL...`
  );
  const detailsMap = await fetchPrDetailsBatch(owner, repo, prsNeedingDetails);

  const exportedPRs: ExportPayload["pullRequests"] = [];
  const exportedReviews: ExportPayload["reviews"] = [];
  const exportedCommits: ExportPayload["commits"] = [];
  const validStates = new Set(["approved", "changes_requested", "commented", "dismissed"]);

  console.log(`Fetching reviews for ${filteredPrs.length} PRs...`);

  for (const pr of filteredPrs) {
    // Skip PRs from bots
    if (pr.user && isBot(pr.user.login)) continue;

    let state: "open" | "merged" | "closed" = "open";
    if (pr.merged_at) state = "merged";
    else if (pr.state === "closed") state = "closed";

    const details = detailsMap.get(pr.number);
    const additions = details?.additions ?? pr.additions ?? 0;
    const deletions = details?.deletions ?? pr.deletions ?? 0;

    // Fetch reviews for this PR
    let reviews: GitHubReview[] = [];
    try {
      reviews = await ghApi<GitHubReview[]>(
        `repos/${owner}/${repo}/pulls/${pr.number}/reviews`
      );
      await sleep(50);
    } catch {
      // Skip reviews for this PR if fetch fails
    }

    const prId = String(pr.number);

    for (const review of reviews) {
      if (review.user && isBot(review.user.login)) continue;
      const reviewState = review.state.toLowerCase();
      if (!validStates.has(reviewState)) continue; // skip PENDING

      exportedReviews.push({
        prExternalId: prId,
        reviewerUsername: review.user?.login || null,
        state: reviewState as ExportPayload["reviews"][number]["state"],
        submittedAt: review.submitted_at,
        body: review.body || null,
      });
    }

    exportedPRs.push({
      externalId: prId,
      externalUrl: pr.html_url,
      title: pr.title,
      authorUsername: pr.user?.login || null,
      state,
      createdAt: pr.created_at,
      mergedAt: pr.merged_at,
      closedAt: pr.closed_at,
      additions,
      deletions,
      commitsCount: pr.commits,
      reviewsCount: reviews.filter((r) => {
        const s = r.state.toLowerCase();
        return validStates.has(s);
      }).length,
      cycleTimeHours: calculateCycleTimeHours(pr.created_at, pr.merged_at),
      metadata: {
        labels: pr.labels.map((l) => l.name),
        reviewers: pr.requested_reviewers.map((r) => r.login),
        draft: pr.draft,
      },
    });

    // Collect commits linked to this PR
    for (const c of details?.commits || []) {
      if (isBot(c.authorUsername || "")) continue;
      const aiDetection = detectAiTool(c.message);
      exportedCommits.push({
        sha: c.sha,
        externalUrl: `https://github.com/${owner}/${repo}/commit/${c.sha}`,
        prExternalId: prId,
        authorUsername: c.authorUsername,
        message: c.message,
        committedAt: c.authorDate,
        additions: c.additions,
        deletions: c.deletions,
        isAiAssisted: aiDetection.isAiAssisted,
        aiTool: aiDetection.tool,
        aiModel: aiDetection.model,
      });
    }
  }

  console.log(`Exported ${exportedPRs.length} PRs, ${exportedReviews.length} reviews, ${exportedCommits.length} PR commits`);
  return { pullRequests: exportedPRs, reviews: exportedReviews, commits: exportedCommits };
}

async function exportCommits(
  options: ExportOptions,
  seenShas: Set<string>
): Promise<ExportPayload["commits"]> {
  const { owner, repo, since, maxPages } = options;

  console.log(`Fetching commits from ${owner}/${repo}...`);

  const params: Record<string, string> = {};
  if (since) params.since = since.toISOString();

  const commits = await ghApiPaginated<GitHubCommit>(
    `repos/${owner}/${repo}/commits`,
    params,
    maxPages
  );

  console.log(`Processing ${commits.length} commits...`);

  const exported: ExportPayload["commits"] = [];

  for (const c of commits) {
    // Skip commits already captured via a PR
    if (seenShas.has(c.sha)) continue;
    // Skip commits from bots
    if (c.author?.login && isBot(c.author.login)) continue;

    const aiDetection = detectAiTool(c.commit.message);

    exported.push({
      sha: c.sha,
      externalUrl: c.html_url,
      prExternalId: null,
      authorUsername: c.author?.login || null,
      message: c.commit.message,
      committedAt: c.commit.author?.date || c.commit.committer?.date || new Date().toISOString(),
      additions: c.stats?.additions || null,
      deletions: c.stats?.deletions || null,
      isAiAssisted: aiDetection.isAiAssisted,
      aiTool: aiDetection.tool,
      aiModel: aiDetection.model,
    });
  }

  console.log(`Exported ${exported.length} commits`);
  return exported;
}

async function exportIssues(
  options: ExportOptions
): Promise<ExportPayload["issues"]> {
  const { owner, repo, since, maxPages } = options;

  console.log(`Fetching issues from ${owner}/${repo}...`);

  try {
    const issueParams: Record<string, string> = {
      state: "all",
      sort: "updated",
      direction: "desc",
    };
    if (since) issueParams.since = since.toISOString();

    const issues = await ghApiPaginated<GitHubIssue>(
      `repos/${owner}/${repo}/issues`,
      issueParams,
      maxPages
    );

    // Filter out PRs (GitHub API returns PRs in issues endpoint)
    const realIssues = issues.filter((i) => !("pull_request" in i));

    console.log(`Processing ${realIssues.length} issues...`);

    const exported: ExportPayload["issues"] = [];

    for (const i of realIssues) {
      // Skip issues from bots
      if (i.user && isBot(i.user.login)) continue;
      if (i.assignee && isBot(i.assignee.login)) continue;

      exported.push({
        externalId: String(i.number),
        externalUrl: i.html_url,
        title: i.title,
        authorUsername: i.user?.login || null,
        assigneeUsername: i.assignee?.login || null,
        state: i.state === "closed" ? "closed" : "open",
        createdAt: i.created_at,
        closedAt: i.closed_at,
        resolvedAt: i.closed_at,
        cycleTimeHours: calculateCycleTimeHours(i.created_at, i.closed_at),
        metadata: {
          labels: i.labels.map((l) => l.name),
        },
      });
    }

    console.log(`Exported ${exported.length} issues`);
    return exported;
  } catch (error) {
    console.log(
      `⚠️  Could not fetch issues (may be disabled or in Jira). Continuing without issues...`
    );
    return [];
  }
}

async function exportContributors(
  pullRequests: ExportPayload["pullRequests"],
  commits: ExportPayload["commits"],
  issues: ExportPayload["issues"],
  owners: string[]
): Promise<ExportPayload["contributors"]> {
  console.log("Identifying contributors...");

  const usernames = new Set<string>();

  // Collect all unique usernames
  for (const pr of pullRequests) {
    if (pr.authorUsername) usernames.add(pr.authorUsername);
  }
  for (const commit of commits) {
    if (commit.authorUsername) usernames.add(commit.authorUsername);
  }
  for (const issue of issues) {
    if (issue.authorUsername) usernames.add(issue.authorUsername);
    if (issue.assigneeUsername) usernames.add(issue.assigneeUsername);
  }

  // Fetch and merge email maps for all orgs
  const orgEmailMap = new Map<string, string>();
  for (const owner of owners) {
    console.log(`Fetching org member emails for ${owner}...`);
    const map = await fetchOrgMemberEmailMap(owner);
    for (const [login, email] of map) orgEmailMap.set(login, email);
  }
  console.log(`Found emails for ${orgEmailMap.size} org members`);

  console.log(`Fetching profiles for ${usernames.size} contributors...`);

  const contributors: ExportPayload["contributors"] = [];

  for (const username of usernames) {
    const profile = await fetchGitHubUserProfile(username);

    if (profile) {
      // Prefer org admin email (includes private emails) over public profile email
      const email = orgEmailMap.get(profile.login) ?? profile.email;

      contributors.push({
        externalUsername: profile.login,
        externalId: String(profile.id),
        displayName: profile.name,
        email: email ?? null,
        avatarUrl: profile.avatar_url,
      });
    }
  }

  console.log(`Exported ${contributors.length} contributors`);
  return contributors;
}

// =============================================================================
// Main Function
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));

  if (positional.length < 1) {
    console.log("Usage:");
    console.log("  npm run export -- <owner> [owner2 ...] [options]");
    console.log("");
    console.log("Options:");
    console.log("  --repo=<name>        Only export a specific repo (single owner only)");
    console.log("  --output=<file>      Output file (default: arka-data.json)");
    console.log("  --org-slug=<slug>    Organization slug (default: first owner)");
    console.log("  --since=<date>       Only export after date (YYYY-MM-DD)");
    console.log("  --max-pages=<n>      Max pages per repo (default: 50)");
    console.log("");
    console.log("Examples:");
    console.log("  npm run export -- myorg                        # all repos");
    console.log("  npm run export -- myorg --repo=myrepo          # single repo");
    console.log("  npm run export -- org1 org2 org3               # multiple orgs");
    console.log("  npm run export -- myorg --since=2025-01-01");
    process.exit(1);
  }

  const owners = positional;

  let outputFile = "arka-data.json";
  let orgSlug = owners[0];
  let singleRepo: string | null = null;
  let since: Date | undefined;
  let maxPages = 50;

  for (const arg of args) {
    if (arg.startsWith("--repo=")) {
      singleRepo = arg.replace("--repo=", "");
    }
    if (arg.startsWith("--output=")) {
      outputFile = arg.replace("--output=", "");
    }
    if (arg.startsWith("--org-slug=")) {
      orgSlug = arg.replace("--org-slug=", "");
    }
    if (arg.startsWith("--since=")) {
      since = new Date(arg.replace("--since=", ""));
    }
    if (arg.startsWith("--max-pages=")) {
      maxPages = Number.parseInt(arg.replace("--max-pages=", ""), 10);
    }
  }

  const multiOwner = owners.length > 1;

  console.log("=".repeat(60));
  console.log(`Exporting GitHub data: ${owners.join(", ")}`);
  console.log(`Organization: ${orgSlug}`);
  console.log(`Since: ${since?.toISOString() || "all time"}`);
  console.log(`Max pages per repo: ${maxPages}`);
  console.log(`Output file: ${outputFile}`);
  console.log("=".repeat(60));
  console.log("");

  try {
    const allPullRequests: ExportPayload["pullRequests"] = [];
    const allCommits: ExportPayload["commits"] = [];
    const allIssues: ExportPayload["issues"] = [];
    const allReviews: ExportPayload["reviews"] = [];

    for (const owner of owners) {
      if (multiOwner) {
        console.log("");
        console.log(`=== Org: ${owner} ===`);
      }

      // Determine repos for this owner
      let repos: string[];
      if (singleRepo) {
        repos = [singleRepo];
      } else {
        repos = await fetchAllRepos(owner);
        if (repos.length === 0) {
          console.log(`No repos found for ${owner}, skipping.`);
          continue;
        }
      }

      const multiRepo = repos.length > 1;

      for (const repo of repos) {
        if (multiRepo || multiOwner) {
          console.log("");
          console.log(`--- Repo: ${owner}/${repo} ---`);
        }

        const options: ExportOptions = {
          owner,
          repo,
          orgSlug,
          outputFile,
          since,
          maxPages,
        };

        let prs: ExportPayload["pullRequests"] = [];
        let reviews: ExportPayload["reviews"] = [];
        let commits: ExportPayload["commits"] = [];
        let issues: ExportPayload["issues"] = [];
        try {
          let prCommits: ExportPayload["commits"] = [];
          ({ pullRequests: prs, reviews, commits: prCommits } = await exportPullRequests(options));
          const seenShas = new Set(prCommits.map((c) => c.sha));
          const directCommits = await exportCommits(options, seenShas);
          commits = [...prCommits, ...directCommits];
          issues = await exportIssues(options);
        } catch (err: any) {
          const out = err?.stdout?.toString() || err?.message || "";
          if (out.includes("409") || out.includes("Git Repository is empty")) {
            console.log(`Skipping ${owner}/${repo}: repository is empty.`);
            continue;
          }
          throw err;
        }

        // Prefix externalIds to avoid collisions across repos/orgs
        if (multiOwner || multiRepo) {
          const prefix = multiOwner ? `${owner}/${repo}` : repo;
          for (const pr of prs) pr.externalId = `${prefix}/${pr.externalId}`;
          for (const review of reviews) review.prExternalId = `${prefix}/${review.prExternalId}`;
          for (const issue of issues) issue.externalId = `${prefix}/${issue.externalId}`;
          for (const c of commits) {
            if (c.prExternalId) c.prExternalId = `${prefix}/${c.prExternalId}`;
          }
        }

        allPullRequests.push(...prs);
        allCommits.push(...commits);
        allIssues.push(...issues);
        allReviews.push(...reviews);
      }
    }

    const contributors = await exportContributors(
      allPullRequests,
      allCommits,
      allIssues,
      owners
    );

    // Build payload
    const repoLabel = singleRepo
      ? owners.map((o) => `${o}/${singleRepo}`).join(", ")
      : owners.map((o) => `${o}/*`).join(", ");

    const payload: ExportPayload = {
      metadata: {
        exportedAt: new Date().toISOString(),
        repository: repoLabel,
        organizationSlug: orgSlug,
        since: since?.toISOString() || null,
        version: "1.0.0",
      },
      contributors,
      pullRequests: allPullRequests,
      commits: allCommits,
      issues: allIssues,
      reviews: allReviews,
    };

    // Write to file
    writeFileSync(outputFile, JSON.stringify(payload, null, 2));

    console.log("");
    console.log("=".repeat(60));
    console.log("EXPORT COMPLETE");
    console.log("=".repeat(60));
    console.log(`  Repos:         ${repos.length}`);
    console.log(`  Contributors:  ${contributors.length}`);
    console.log(`  Pull Requests: ${allPullRequests.length}`);
    console.log(`  Reviews:       ${allReviews.length}`);
    console.log(`  Commits:       ${allCommits.length}`);
    console.log(`  Issues:        ${allIssues.length}`);
    console.log("");
    console.log(`Output written to: ${outputFile}`);
    console.log(
      `File size: ${(JSON.stringify(payload).length / 1024).toFixed(2)} KB`
    );
    console.log("");
    console.log("Next steps:");
    console.log("  1. Review the exported data in the JSON file");
    console.log("  2. Upload the file to your Arka Intelligence organization");

    process.exit(0);
  } catch (error) {
    console.error("Export failed:", error);
    process.exit(1);
  }
}

main();
