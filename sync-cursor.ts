#!/usr/bin/env node
/**
 * Arka Intelligence - Cursor Analytics Export Script
 *
 * Exports per-user Cursor usage metrics from the Cursor Analytics API
 * into a JSON file for import into Arka Intelligence.
 *
 * Usage:
 *   npm run export:cursor
 *
 * Authentication:
 *   Set environment variable:
 *   CURSOR_API_KEY=your-api-key
 *
 *   Generate an API key in Cursor team settings:
 *   Cursor → Settings → Team → Analytics API → Generate Key
 *   Requires enterprise team plan.
 *
 * Options:
 *   --output=<file>      Output file (default: cursor-data.json)
 *   --org-slug=<slug>    Organization slug in Arka
 *   --days=<n>           How many days back to fetch (default: 7)
 *   --since=YYYY-MM-DD   Start date (overrides --days)
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";

// =============================================================================
// Types
// =============================================================================

// Cursor API response shapes (by-user endpoints)
interface CursorByUserRecord {
  userId: string;
  email?: string;
  name?: string;
  // Metrics vary by endpoint — we use a flexible shape and pick what we need
  [key: string]: unknown;
}

interface CursorApiResponse<T> {
  data: T[];
  pagination?: { page: number; pageSize: number; total: number };
  params?: { userMappings?: Record<string, { email?: string; name?: string }> };
}

interface UserMetrics {
  userId: string;
  email: string | null;
  name: string | null;
  isActive: boolean;
  // Agent edits (Composer/Agent mode)
  agentEdits: {
    accepted: number;
    rejected: number;
    acceptanceRate: number | null;
  };
  // Tab completions (autocomplete)
  tabs: {
    accepted: number;
    total: number;
    acceptanceRate: number | null;
  };
  // Daily active sessions
  activeDays: number;
  // Models used
  modelsUsed: string[];
  // Commands run (terminal/slash commands)
  commandsRun: number;
  // Plan mode usage
  planModeUses: number;
  // Ask mode usage
  askModeUses: number;
}

interface ExportPayload {
  metadata: {
    exportedAt: string;
    source: "cursor";
    organizationSlug: string;
    startDate: string;
    endDate: string;
    version: string;
  };
  summary: {
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    utilizationRate: number;
    totalAgentEditsAccepted: number;
    totalAgentEditsRejected: number;
    overallAgentEditAcceptanceRate: number | null;
    totalTabsAccepted: number;
    overallTabAcceptanceRate: number | null;
  };
  users: UserMetrics[];
}

// =============================================================================
// API Helpers
// =============================================================================

const CURSOR_API_BASE = "https://api.cursor.com";

function getApiKey(): string {
  const key = process.env.CURSOR_API_KEY;
  if (!key) {
    console.error("Error: CURSOR_API_KEY environment variable is required");
    console.error("");
    console.error("Set it like this:");
    console.error('  export CURSOR_API_KEY="your-api-key"');
    console.error("");
    console.error("Generate a key in Cursor team settings:");
    console.error("  Cursor → Settings → Team → Analytics API → Generate Key");
    console.error("  (Requires enterprise team plan)");
    process.exit(1);
  }
  return key;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cursorApi<T>(
  apiKey: string,
  endpoint: string,
  params: Record<string, string> = {},
  retries = 3
): Promise<CursorApiResponse<T>> {
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  const queryString = new URLSearchParams(params).toString();
  const url = `${CURSOR_API_BASE}${endpoint}${queryString ? "?" + queryString : ""}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const cmd = `curl -s -w "\\n%{http_code}" \
        -H "Authorization: Basic ${auth}" \
        -H "Content-Type: application/json" \
        "${url}"`;

      const rawOutput = execSync(cmd, {
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
      });

      const lastNewline = rawOutput.lastIndexOf("\n");
      const statusCode = parseInt(rawOutput.slice(lastNewline + 1).trim(), 10);
      const responseBody = rawOutput.slice(0, lastNewline);

      if (statusCode === 401 || statusCode === 403) {
        throw new Error(
          `Authentication failed (HTTP ${statusCode}). Check CURSOR_API_KEY.\nResponse: ${responseBody.slice(0, 300)}`
        );
      }
      if (statusCode === 429) {
        const waitTime = Math.pow(2, attempt) * 5000;
        console.warn(`Rate limited, waiting ${waitTime / 1000}s...`);
        await sleep(waitTime);
        continue;
      }
      if (statusCode >= 400) {
        throw new Error(`API error (HTTP ${statusCode}): ${responseBody.slice(0, 300)}`);
      }

      return JSON.parse(responseBody);
    } catch (error: any) {
      if (error.message?.includes("Authentication failed")) throw error;
      if (attempt === retries) throw error;
      const waitTime = Math.pow(2, attempt) * 1000;
      console.warn(`Request failed (attempt ${attempt}/${retries}), retrying in ${waitTime / 1000}s...`);
      await sleep(waitTime);
    }
  }

  throw new Error("Failed after retries");
}

// Fetch all pages for a by-user endpoint
async function fetchAllPages<T>(
  apiKey: string,
  endpoint: string,
  dateParams: Record<string, string>
): Promise<{ records: T[]; userMappings: Record<string, { email?: string; name?: string }> }> {
  const records: T[] = [];
  let userMappings: Record<string, { email?: string; name?: string }> = {};
  let page = 1;
  const pageSize = 500;

  while (true) {
    const params = { ...dateParams, page: String(page), pageSize: String(pageSize) };
    const response = await cursorApi<T>(apiKey, endpoint, params);

    records.push(...response.data);

    if (response.params?.userMappings) {
      Object.assign(userMappings, response.params.userMappings);
    }

    const total = response.pagination?.total ?? 0;
    if (records.length >= total || response.data.length === 0) break;
    page++;
    await sleep(300);
  }

  return { records, userMappings };
}

// =============================================================================
// Data Fetching & Aggregation
// =============================================================================

function acceptanceRate(accepted: number, total: number): number | null {
  return total > 0 ? parseFloat((accepted / total).toFixed(3)) : null;
}

async function fetchAndBuild(
  apiKey: string,
  startDate: string,
  endDate: string
): Promise<Map<string, UserMetrics>> {
  const userMap = new Map<string, UserMetrics>();
  const dateParams = { startDate, endDate };

  function ensureUser(
    userId: string,
    mappings: Record<string, { email?: string; name?: string }>
  ): UserMetrics {
    if (!userMap.has(userId)) {
      const info = mappings[userId] || {};
      userMap.set(userId, {
        userId,
        email: info.email || null,
        name: info.name || null,
        isActive: false,
        agentEdits: { accepted: 0, rejected: 0, acceptanceRate: null },
        tabs: { accepted: 0, total: 0, acceptanceRate: null },
        activeDays: 0,
        modelsUsed: [],
        commandsRun: 0,
        planModeUses: 0,
        askModeUses: 0,
      });
    }
    return userMap.get(userId)!;
  }

  // Agent edits
  console.log("  Fetching agent edit metrics...");
  {
    const { records, userMappings } = await fetchAllPages<{
      userId: string;
      accepted?: number;
      rejected?: number;
    }>(apiKey, "/analytics/by-user/agent-edits", dateParams);

    for (const r of records) {
      const user = ensureUser(r.userId, userMappings);
      user.agentEdits.accepted += r.accepted ?? 0;
      user.agentEdits.rejected += r.rejected ?? 0;
      if ((r.accepted ?? 0) > 0 || (r.rejected ?? 0) > 0) user.isActive = true;
    }
  }

  // Tab completions
  console.log("  Fetching tab completion metrics...");
  {
    const { records, userMappings } = await fetchAllPages<{
      userId: string;
      accepted?: number;
      total?: number;
    }>(apiKey, "/analytics/by-user/tabs", dateParams);

    for (const r of records) {
      const user = ensureUser(r.userId, userMappings);
      user.tabs.accepted += r.accepted ?? 0;
      user.tabs.total += r.total ?? 0;
      if ((r.accepted ?? 0) > 0) user.isActive = true;
    }
  }

  // Daily active users (to count active days)
  console.log("  Fetching daily active user metrics...");
  {
    const { records, userMappings } = await fetchAllPages<{
      userId: string;
      activeDays?: number;
      date?: string;
    }>(apiKey, "/analytics/by-user/dau", dateParams);

    for (const r of records) {
      const user = ensureUser(r.userId, userMappings);
      // DAU endpoint may return one row per user with total active days,
      // or one row per day — handle both
      user.activeDays += r.activeDays ?? (r.date ? 1 : 0);
      if ((r.activeDays ?? 0) > 0 || r.date) user.isActive = true;
    }
  }

  // Models used
  console.log("  Fetching model usage metrics...");
  {
    const { records, userMappings } = await fetchAllPages<{
      userId: string;
      model?: string;
    }>(apiKey, "/analytics/by-user/models", dateParams);

    for (const r of records) {
      const user = ensureUser(r.userId, userMappings);
      if (r.model && !user.modelsUsed.includes(r.model)) {
        user.modelsUsed.push(r.model);
      }
    }
  }

  // Commands
  console.log("  Fetching command usage metrics...");
  {
    const { records, userMappings } = await fetchAllPages<{
      userId: string;
      count?: number;
    }>(apiKey, "/analytics/by-user/commands", dateParams);

    for (const r of records) {
      const user = ensureUser(r.userId, userMappings);
      user.commandsRun += r.count ?? 0;
    }
  }

  // Plan mode
  console.log("  Fetching plan mode metrics...");
  {
    const { records, userMappings } = await fetchAllPages<{
      userId: string;
      count?: number;
    }>(apiKey, "/analytics/by-user/plans", dateParams);

    for (const r of records) {
      const user = ensureUser(r.userId, userMappings);
      user.planModeUses += r.count ?? 0;
    }
  }

  // Ask mode
  console.log("  Fetching ask mode metrics...");
  {
    const { records, userMappings } = await fetchAllPages<{
      userId: string;
      count?: number;
    }>(apiKey, "/analytics/by-user/ask-mode", dateParams);

    for (const r of records) {
      const user = ensureUser(r.userId, userMappings);
      user.askModeUses += r.count ?? 0;
    }
  }

  // Finalize acceptance rates
  for (const user of userMap.values()) {
    const editTotal = user.agentEdits.accepted + user.agentEdits.rejected;
    user.agentEdits.acceptanceRate = acceptanceRate(user.agentEdits.accepted, editTotal);
    user.tabs.acceptanceRate = acceptanceRate(user.tabs.accepted, user.tabs.total);
  }

  return userMap;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("--"));

  let outputFile = "cursor-data.json";
  let orgSlug = "my-org";
  let days = 7;
  let sinceOverride: string | undefined;

  for (const flag of flags) {
    if (flag.startsWith("--output=")) outputFile = flag.replace("--output=", "");
    if (flag.startsWith("--org-slug=")) orgSlug = flag.replace("--org-slug=", "");
    if (flag.startsWith("--days=")) days = parseInt(flag.replace("--days=", ""), 10);
    if (flag.startsWith("--since=")) sinceOverride = flag.replace("--since=", "");
  }

  const endDate = new Date();
  endDate.setUTCHours(0, 0, 0, 0);
  const endStr = endDate.toISOString().split("T")[0];

  let startStr: string;
  if (sinceOverride) {
    startStr = sinceOverride;
  } else {
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - (days - 1));
    startStr = startDate.toISOString().split("T")[0];
  }

  console.log("=".repeat(60));
  console.log("Exporting Cursor analytics");
  console.log(`Organization: ${orgSlug}`);
  console.log(`Date range: ${startStr} → ${endStr} (${days} days)`);
  console.log(`Output file: ${outputFile}`);
  console.log("=".repeat(60));
  console.log("");

  const apiKey = getApiKey();

  try {
    console.log("Fetching usage data...");
    const userMap = await fetchAndBuild(apiKey, startStr, endStr);
    const users = Array.from(userMap.values()).sort(
      (a, b) => b.agentEdits.accepted - a.agentEdits.accepted
    );

    const activeUsers = users.filter((u) => u.isActive);
    const inactiveUsers = users.filter((u) => !u.isActive);

    const totalEditsAccepted = users.reduce((s, u) => s + u.agentEdits.accepted, 0);
    const totalEditsRejected = users.reduce((s, u) => s + u.agentEdits.rejected, 0);
    const totalTabsAccepted = users.reduce((s, u) => s + u.tabs.accepted, 0);
    const totalTabsTotal = users.reduce((s, u) => s + u.tabs.total, 0);

    const payload: ExportPayload = {
      metadata: {
        exportedAt: new Date().toISOString(),
        source: "cursor",
        organizationSlug: orgSlug,
        startDate: startStr,
        endDate: endStr,
        version: "1.0.0",
      },
      summary: {
        totalUsers: users.length,
        activeUsers: activeUsers.length,
        inactiveUsers: inactiveUsers.length,
        utilizationRate:
          users.length > 0
            ? parseFloat((activeUsers.length / users.length).toFixed(3))
            : 0,
        totalAgentEditsAccepted: totalEditsAccepted,
        totalAgentEditsRejected: totalEditsRejected,
        overallAgentEditAcceptanceRate: acceptanceRate(
          totalEditsAccepted,
          totalEditsAccepted + totalEditsRejected
        ),
        totalTabsAccepted,
        overallTabAcceptanceRate: acceptanceRate(totalTabsAccepted, totalTabsTotal),
      },
      users,
    };

    writeFileSync(outputFile, JSON.stringify(payload, null, 2));

    console.log("");
    console.log("=".repeat(60));
    console.log("EXPORT COMPLETE");
    console.log("=".repeat(60));
    console.log(`  Total users:        ${users.length}`);
    console.log(`  Active users:       ${activeUsers.length}`);
    console.log(`  Inactive users:     ${inactiveUsers.length}`);
    console.log(
      `  Utilization:        ${(payload.summary.utilizationRate * 100).toFixed(0)}%`
    );
    console.log(`  Agent edits accepted: ${totalEditsAccepted.toLocaleString()}`);
    if (payload.summary.overallAgentEditAcceptanceRate !== null) {
      console.log(
        `  Edit acceptance:    ${(payload.summary.overallAgentEditAcceptanceRate * 100).toFixed(1)}%`
      );
    }
    if (inactiveUsers.length > 0) {
      console.log("");
      console.log(`  Inactive seats (${inactiveUsers.length}):`);
      for (const u of inactiveUsers) {
        console.log(`    - ${u.email ?? u.userId}`);
      }
    }
    console.log("");
    console.log(`Output written to: ${outputFile}`);
    console.log(`File size: ${(JSON.stringify(payload).length / 1024).toFixed(2)} KB`);
    process.exit(0);
  } catch (error) {
    console.error("Export failed:", error);
    process.exit(1);
  }
}

main();
