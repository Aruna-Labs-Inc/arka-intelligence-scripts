#!/usr/bin/env node
/**
 * Arka Intelligence - Jira Issue Export Script
 *
 * Exports issues from Jira into a JSON file for import into Arka Intelligence.
 *
 * Usage:
 *   npm install
 *   npm run export:jira -- <jira-domain> <project-key> [options]
 *
 * Example:
 *   npm run export:jira -- mycompany.atlassian.net PROJ --output=jira-data.json
 *   npm run export:jira -- mycompany.atlassian.net PROJ --since=2025-01-01
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
  projectKey: string;
  orgSlug: string;
  outputFile: string;
  since?: Date;
  maxResults: number;
}

interface JiraExportPayload {
  metadata: {
    exportedAt: string;
    source: "jira";
    projectKey: string;
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
  retries = 3
): Promise<T> {
  const auth = getAuthHeader();
  const url = `https://${domain}/rest/api/3/${endpoint}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const cmd = `curl -s -X GET -H "Authorization: Basic ${auth}" -H "Content-Type: application/json" "${url}"`;
      const result = execSync(cmd, {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
      });

      const parsed = JSON.parse(result);

      // Check for error responses
      if (parsed.errorMessages || parsed.errors) {
        throw new Error(
          `Jira API error: ${JSON.stringify(parsed.errorMessages || parsed.errors)}`
        );
      }

      return parsed;
    } catch (error: any) {
      if (attempt === retries) {
        throw error;
      }

      const waitTime = Math.pow(2, attempt) * 500;
      console.log(`API error, retrying in ${waitTime / 1000}s...`);
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

  console.log(`Fetching issues from Jira project ${projectKey}...`);

  // Build JQL query
  let jql = `project = ${projectKey}`;
  if (since) {
    jql += ` AND created >= "${since.toISOString().split("T")[0]}"`;
  }
  jql += ` ORDER BY created DESC`;

  const endpoint = `search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}&fields=summary,status,issuetype,creator,assignee,reporter,created,updated,resolutiondate,labels,priority,customfield_10016`;

  const response = await jiraApi<{
    issues: JiraIssue[];
    total: number;
  }>(domain, endpoint);

  console.log(
    `Found ${response.total} issues, processing ${response.issues.length}...`
  );

  const exported: JiraExportPayload["issues"] = [];

  for (const issue of response.issues) {
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

  if (args.length < 2) {
    console.log("Usage: npm run export:jira -- <domain> <project-key> [options]");
    console.log("");
    console.log("Options:");
    console.log("  --output=<file>      Output file (default: jira-data.json)");
    console.log(
      "  --org-slug=<slug>    Organization slug (default: project key)"
    );
    console.log("  --since=<date>       Only export after date (YYYY-MM-DD)");
    console.log("  --max-results=<n>    Max issues to fetch (default: 1000)");
    console.log("");
    console.log("Authentication:");
    console.log("  Set JIRA_EMAIL and JIRA_API_TOKEN environment variables");
    console.log("");
    console.log("Example:");
    console.log(
      "  npm run export:jira -- mycompany.atlassian.net PROJ --output=jira-data.json"
    );
    process.exit(1);
  }

  const domain = args[0];
  const projectKey = args[1];

  let outputFile = "jira-data.json";
  let orgSlug = projectKey.toLowerCase();
  let since: Date | undefined;
  let maxResults = 1000;

  for (const arg of args.slice(2)) {
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
  console.log(`Exporting Jira issues: ${domain}/${projectKey}`);
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
        projectKey,
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
