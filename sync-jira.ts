#!/usr/bin/env node
/**
 * Arka Intelligence - Jira Issue Export Script
 *
 * Exports issues from Jira into a JSON file for import into Arka Intelligence.
 *
 * Usage:
 *   npm install
 *   npm run export:jira -- <jira-domain> [project-key] [options]
 *
 * Example:
 *   npm run export:jira -- mycompany.atlassian.net PROJ --output=jira-data.json
 *   npm run export:jira -- mycompany.atlassian.net PROJ --since=2025-01-01
 *   npm run export:jira -- mycompany.atlassian.net --since=2025-01-01
 *
 * Authentication:
 *   Set environment variables:
 *   JIRA_EMAIL=your-email@company.com
 *   JIRA_API_TOKEN=your-api-token
 *
 *   Create API token: https://id.atlassian.com/manage-profile/security/api-tokens
 *
 * Options:
 *   --output=<file>      Output JSON file (default: jira-data.json)
 *   --org-slug=<slug>    Organization slug in Arka (default: project key)
 *   --since=<date>       Only export issues created after this date (YYYY-MM-DD)
 *   --max-results=<n>    Maximum issues to fetch (default: 1000)
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";

// =============================================================================
// Types
// =============================================================================

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: {
      name: string;
      statusCategory: {
        key: string;
      };
    };
    issuetype: {
      name: string;
    };
    creator?: {
      emailAddress?: string;
      displayName?: string;
    };
    assignee?: {
      emailAddress?: string;
      displayName?: string;
    };
    reporter?: {
      emailAddress?: string;
      displayName?: string;
    };
    created: string;
    updated: string;
    resolutiondate?: string | null;
    labels: string[];
    priority?: {
      name: string;
    };
    customfield_10016?: number; // Story points
  };
}

interface ExportOptions {
  domain: string;
  projectKey?: string;
  orgSlug: string;
  outputFile: string;
  since?: Date;
  maxResults: number;
}

interface JiraExportPayload {
  metadata: {
    exportedAt: string;
    source: "jira";
    projectKey: string | null;
    organizationSlug: string;
    since: string | null;
    version: string;
  };
  issues: Array<{
    externalId: string;
    externalUrl: string;
    title: string;
    issueType: string;
    authorEmail: string | null;
    assigneeEmail: string | null;
    reporterEmail: string | null;
    state: "open" | "in_progress" | "resolved" | "closed";
    priority: string | null;
    storyPoints: number | null;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
    resolvedAt: string | null;
    cycleTimeHours: number | null;
    metadata: {
      labels: string[];
      statusName: string;
    };
  }>;
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

function mapJiraState(
  statusCategory: string
): "open" | "in_progress" | "resolved" | "closed" {
  switch (statusCategory.toLowerCase()) {
    case "new":
    case "to do":
      return "open";
    case "indeterminate":
    case "in progress":
      return "in_progress";
    case "done":
      return "resolved";
    default:
      return "open";
  }
}

// =============================================================================
// Jira API Helpers
// =============================================================================

function getAuthHeader(): string {
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;

  if (!email || !token) {
    console.error(
      "Error: JIRA_EMAIL and JIRA_API_TOKEN environment variables are required"
    );
    console.error("");
    console.error("Set them like this:");
    console.error('  export JIRA_EMAIL="your-email@company.com"');
    console.error('  export JIRA_API_TOKEN="your-api-token"');
    console.error("");
    console.error(
      "Create an API token at: https://id.atlassian.com/manage-profile/security/api-tokens"
    );
    process.exit(1);
  }

  return Buffer.from(`${email}:${token}`).toString("base64");
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function jiraApi<T>(
  domain: string,
  endpoint: string,
  body?: object,
  retries = 3
): Promise<T> {
  const auth = getAuthHeader();
  const url = `https://${domain}/rest/api/3/${endpoint}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    let rawOutput = "";
    try {
      let cmd: string;
      if (body) {
        const bodyJson = JSON.stringify(body).replace(/'/g, "'\\''");
        cmd = `curl -s -w "\\n%{http_code}" -X POST -H "Authorization: Basic ${auth}" -H "Content-Type: application/json" -d '${bodyJson}' "${url}"`;
      } else {
        cmd = `curl -s -w "\\n%{http_code}" -X GET -H "Authorization: Basic ${auth}" -H "Content-Type: application/json" "${url}"`;
      }
      rawOutput = execSync(cmd, {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
      });

      // curl -w appends the status code on a new line
      const lastNewline = rawOutput.lastIndexOf("\n");
      const statusCode = parseInt(rawOutput.slice(lastNewline + 1).trim(), 10);
      const responseBody = rawOutput.slice(0, lastNewline);

      // Fail fast on auth errors — retrying won't help
      if (statusCode === 401 || statusCode === 403) {
        throw new Error(
          `Authentication failed (HTTP ${statusCode}). Check JIRA_EMAIL and JIRA_API_TOKEN.\nResponse: ${responseBody.slice(0, 200)}`
        );
      }

      // Rate limited — respect Retry-After if present, otherwise back off hard
      if (statusCode === 429) {
        const waitTime = Math.pow(2, attempt) * 5000;
        console.warn(`Rate limited (429), waiting ${waitTime / 1000}s before retry ${attempt + 1}/${retries}...`);
        await sleep(waitTime);
        continue;
      }

      if (statusCode >= 500) {
        throw new Error(`Jira server error (HTTP ${statusCode}): ${responseBody.slice(0, 200)}`);
      }

      const parsed = JSON.parse(responseBody);

      if (parsed.errorMessages?.length || parsed.errors) {
        throw new Error(
          `Jira API error: ${JSON.stringify(parsed.errorMessages || parsed.errors)}`
        );
      }

      return parsed;
    } catch (error: any) {
      // Don't retry auth failures
      if (error.message?.includes("Authentication failed")) throw error;

      if (attempt === retries) {
        console.error(`Failed after ${retries} attempts for ${endpoint}`);
        throw error;
      }

      const isNetwork =
        error.message?.includes("connection refused") ||
        error.message?.includes("connection reset") ||
        error.message?.includes("Could not resolve host");

      const waitTime = isNetwork
        ? Math.pow(2, attempt) * 2000
        : Math.pow(2, attempt) * 500;

      console.warn(
        `Request failed (attempt ${attempt}/${retries}): ${error.message?.slice(0, 120) ?? "unknown error"}`
      );
      console.warn(`Retrying in ${waitTime / 1000}s...`);
      await sleep(waitTime);
    }
  }

  throw new Error(`Failed after ${retries} retries`);
}

// =============================================================================
// Export Function
// =============================================================================

async function exportJiraIssues(
  options: ExportOptions
): Promise<JiraExportPayload["issues"]> {
  const { domain, projectKey, since, maxResults } = options;

  console.log(
    projectKey
      ? `Fetching issues from Jira project ${projectKey}...`
      : `Fetching all Jira issues...`
  );

  // Build JQL query
  const conditions: string[] = [];
  if (projectKey) conditions.push(`project = ${projectKey}`);
  if (since) conditions.push(`created >= "${since.toISOString().split("T")[0]}"`);
  const jql = (conditions.length > 0 ? conditions.join(" AND ") + " " : "") + "ORDER BY created DESC";

  const fields = ["summary", "status", "issuetype", "creator", "assignee", "reporter", "created", "updated", "resolutiondate", "labels", "priority", "customfield_10016"];
  const pageSize = 100;
  const allIssues: JiraIssue[] = [];
  let nextPageToken: string | undefined;
  let total: number | undefined;

  do {
    const requestBody: Record<string, unknown> = { jql, maxResults: pageSize, fields };
    if (nextPageToken) requestBody.nextPageToken = nextPageToken;

    const response = await jiraApi<{ issues: JiraIssue[]; total?: number; nextPageToken?: string; warningMessages?: string[]; [key: string]: unknown }>(
      domain, "search/jql", requestBody
    );

    if (allIssues.length === 0) {
      total = response.total;
      if (response.issues.length === 0) {
        console.warn("Warning: API returned 0 issues.");
        // Print any warnings or unexpected fields Jira included in the response
        const { issues: _, nextPageToken: __, total: ___, ...rest } = response;
        if (Object.keys(rest).length > 0) {
          console.warn("API response:", JSON.stringify(rest, null, 2));
        }
        console.warn(`JQL used: ${jql}`);
        console.warn("Tip: try passing a project key — npm run export:jira -- <domain> <PROJECT>");
      } else {
        console.log(`Found ${total ?? "unknown number of"} issues, fetching...`);
      }
    }

    allIssues.push(...response.issues);
    nextPageToken = response.nextPageToken;

    if (allIssues.length % 500 === 0 && allIssues.length > 0) {
      console.log(`  Fetched ${allIssues.length}${total != null ? `/${total}` : ""}...`);
    }

    if (allIssues.length >= maxResults) break;
    if (!nextPageToken) break;
    await sleep(100);
  } while (true);

  console.log(`Processing ${allIssues.length} issues...`);

  const exported: JiraExportPayload["issues"] = [];

  for (const issue of allIssues) {
    const state = mapJiraState(issue.fields.status.statusCategory.key);

    exported.push({
      externalId: issue.key,
      externalUrl: `https://${domain}/browse/${issue.key}`,
      title: issue.fields.summary,
      issueType: issue.fields.issuetype.name,
      authorEmail: issue.fields.creator?.emailAddress || null,
      assigneeEmail: issue.fields.assignee?.emailAddress || null,
      reporterEmail: issue.fields.reporter?.emailAddress || null,
      state,
      priority: issue.fields.priority?.name || null,
      storyPoints: issue.fields.customfield_10016 || null,
      createdAt: issue.fields.created,
      updatedAt: issue.fields.updated,
      closedAt:
        state === "closed" || state === "resolved"
          ? issue.fields.resolutiondate || issue.fields.updated
          : null,
      resolvedAt: issue.fields.resolutiondate,
      cycleTimeHours: calculateCycleTimeHours(
        issue.fields.created,
        issue.fields.resolutiondate
      ),
      metadata: {
        labels: issue.fields.labels,
        statusName: issue.fields.status.name,
      },
    });
  }

  console.log(`Exported ${exported.length} issues`);
  return exported;
}

// =============================================================================
// Main Function
// =============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1 || args[0].startsWith("--")) {
    console.log("Usage: npm run export:jira -- <domain> [project-key] [options]");
    console.log("");
    console.log("Options:");
    console.log("  --output=<file>      Output file (default: jira-data.json)");
    console.log(
      "  --org-slug=<slug>    Organization slug (default: project key or domain)"
    );
    console.log("  --since=<date>       Only export after date (YYYY-MM-DD)");
    console.log("  --max-results=<n>    Max issues to fetch (default: 1000)");
    console.log("");
    console.log("Authentication:");
    console.log("  Set JIRA_EMAIL and JIRA_API_TOKEN environment variables");
    console.log("");
    console.log("Examples:");
    console.log(
      "  npm run export:jira -- mycompany.atlassian.net PROJ --output=jira-data.json"
    );
    console.log(
      "  npm run export:jira -- mycompany.atlassian.net --since=2025-01-01"
    );
    process.exit(1);
  }

  // Separate positional args from flags
  const positionalArgs = args.filter((a) => !a.startsWith("--"));
  const flagArgs = args.filter((a) => a.startsWith("--"));

  const domain = positionalArgs[0];
  const projectKey = positionalArgs[1]; // optional

  let outputFile = "jira-data.json";
  let orgSlug = (projectKey || domain.split(".")[0]).toLowerCase();
  let since: Date | undefined;
  let maxResults = 1000;

  for (const arg of flagArgs) {
    if (arg.startsWith("--output=")) {
      outputFile = arg.replace("--output=", "");
    }
    if (arg.startsWith("--org-slug=")) {
      orgSlug = arg.replace("--org-slug=", "");
    }
    if (arg.startsWith("--since=")) {
      since = new Date(arg.replace("--since=", ""));
    }
    if (arg.startsWith("--max-results=")) {
      maxResults = Number.parseInt(arg.replace("--max-results=", ""), 10);
    }
  }

  console.log("=".repeat(60));
  console.log(`Exporting Jira issues: ${domain}${projectKey ? `/${projectKey}` : ""}`);
  console.log(`Organization: ${orgSlug}`);
  console.log(`Since: ${since?.toISOString() || "all time"}`);
  console.log(`Max results: ${maxResults}`);
  console.log(`Output file: ${outputFile}`);
  console.log("=".repeat(60));
  console.log("");

  try {
    const options: ExportOptions = {
      domain,
      projectKey,
      orgSlug,
      outputFile,
      since,
      maxResults,
    };

    const issues = await exportJiraIssues(options);

    const payload: JiraExportPayload = {
      metadata: {
        exportedAt: new Date().toISOString(),
        source: "jira",
        projectKey: projectKey || null,
        organizationSlug: orgSlug,
        since: since?.toISOString() || null,
        version: "1.0.0",
      },
      issues,
    };

    writeFileSync(outputFile, JSON.stringify(payload, null, 2));

    console.log("");
    console.log("=".repeat(60));
    console.log("EXPORT COMPLETE");
    console.log("=".repeat(60));
    console.log(`  Issues: ${issues.length}`);
    console.log("");
    console.log(`Output written to: ${outputFile}`);
    console.log(
      `File size: ${(JSON.stringify(payload).length / 1024).toFixed(2)} KB`
    );
    console.log("");
    console.log("Next steps:");
    console.log("  1. Review the exported data in the JSON file");
    console.log("  2. Upload the file to your Arka Intelligence organization");
    console.log(
      "  3. Map issue emails to GitHub usernames for complete analytics"
    );

    process.exit(0);
  } catch (error) {
    console.error("Export failed:", error);
    process.exit(1);
  }
}

main();
