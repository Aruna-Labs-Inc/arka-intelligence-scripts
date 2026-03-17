#!/usr/bin/env node
/**
 * Arka Intelligence - Claude Code Analytics Export Script
 *
 * Exports per-user Claude Code usage metrics from the Anthropic Admin API
 * into a JSON file for import into Arka Intelligence.
 *
 * Usage:
 *   npm run export:claude-code
 *
 * Authentication:
 *   Set environment variable:
 *   CLAUDE_ADMIN_API_KEY=sk-ant-admin...
 *
 *   Create an Admin API key at: https://console.anthropic.com/settings/admin-keys
 *   Requires organization admin role.
 *
 * Options:
 *   --output=<file>      Output file (default: claude-code-data.json)
 *   --org-slug=<slug>    Organization slug in Arka
 *   --days=<n>           How many days back to fetch (default: 7)
 *   --since=YYYY-MM-DD   Start date (overrides --days)
 */

import { execSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { shouldUpload, isUploadOnly, uploadToApi, readInputFile } from "./upload-helper";

// =============================================================================
// Types
// =============================================================================

interface ClaudeCodeRecord {
  date: string;
  actor: {
    type: "user_actor" | "api_actor";
    email_address?: string;
    api_key_name?: string;
  };
  organization_id: string;
  customer_type: string;
  terminal_type: string;
  core_metrics: {
    num_sessions: number;
    lines_of_code: { added: number; removed: number };
    commits_by_claude_code: number;
    pull_requests_by_claude_code: number;
  };
  tool_actions: {
    edit_tool: { accepted: number; rejected: number };
    multi_edit_tool: { accepted: number; rejected: number };
    write_tool: { accepted: number; rejected: number };
    notebook_edit_tool: { accepted: number; rejected: number };
  };
  model_breakdown: Array<{
    model: string;
    tokens: {
      input: number;
      output: number;
      cache_read: number;
      cache_creation: number;
    };
    estimated_cost: { amount: number; currency: string };
  }>;
}

interface UserMetrics {
  email: string;
  isActive: boolean;
  activeDays: number;
  firstActiveDate: string | null;
  lastActiveDate: string | null;
  totalSessions: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  totalCommits: number;
  totalPRs: number;
  toolActions: {
    editTool: { accepted: number; rejected: number; acceptanceRate: number | null };
    multiEditTool: { accepted: number; rejected: number; acceptanceRate: number | null };
    writeTool: { accepted: number; rejected: number; acceptanceRate: number | null };
    overall: { accepted: number; rejected: number; acceptanceRate: number | null };
  };
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
    total: number;
  };
  estimatedCostCents: number;
  terminalTypes: string[];
  modelBreakdown: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costCents: number;
  }>;
}

interface ExportPayload {
  metadata: {
    exportedAt: string;
    source: "claude-code";
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
    totalSessions: number;
    totalLinesAdded: number;
    totalLinesRemoved: number;
    totalCommits: number;
    totalPRs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostCents: number;
    totalCostDollars: number;
    overallAcceptanceRate: number | null;
  };
  users: UserMetrics[];
}

// =============================================================================
// API Helpers
// =============================================================================

function getAdminApiKey(): string {
  const key = process.env.CLAUDE_ADMIN_API_KEY;
  if (!key) {
    console.error("Error: CLAUDE_ADMIN_API_KEY environment variable is required");
    console.error("");
    console.error("Set it like this:");
    console.error('  export CLAUDE_ADMIN_API_KEY="sk-ant-admin..."');
    console.error("");
    console.error("Create an Admin API key at: https://console.anthropic.com/settings/admin-keys");
    console.error("Requires organization admin role.");
    process.exit(1);
  }
  return key;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function anthropicApi<T>(
  apiKey: string,
  endpoint: string,
  params: Record<string, string> = {},
  retries = 3
): Promise<T> {
  const queryString = new URLSearchParams(params).toString();
  const url = `https://api.anthropic.com${endpoint}${queryString ? "?" + queryString : ""}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const cmd = `curl -s -w "\\n%{http_code}" \
        -H "anthropic-version: 2023-06-01" \
        -H "x-api-key: ${apiKey}" \
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
          `Authentication failed (HTTP ${statusCode}). Check CLAUDE_ADMIN_API_KEY.\nResponse: ${responseBody.slice(0, 300)}`
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

// =============================================================================
// Data Fetching
// =============================================================================

async function fetchRecordsForDate(apiKey: string, date: string): Promise<ClaudeCodeRecord[]> {
  const records: ClaudeCodeRecord[] = [];
  let page: string | undefined;

  do {
    const params: Record<string, string> = { starting_at: date, limit: "1000" };
    if (page) params.page = page;

    const response = await anthropicApi<{
      data: ClaudeCodeRecord[];
      has_more: boolean;
      next_page: string | null;
    }>(apiKey, "/v1/organizations/usage_report/claude_code", params);

    records.push(...response.data);
    page = response.has_more && response.next_page ? response.next_page : undefined;
  } while (page);

  return records;
}

// =============================================================================
// Metric Aggregation
// =============================================================================

function acceptanceRate(accepted: number, rejected: number): number | null {
  const total = accepted + rejected;
  return total > 0 ? parseFloat((accepted / total).toFixed(3)) : null;
}

async function aggregateMetrics(
  apiKey: string,
  startDate: Date,
  endDate: Date
): Promise<Map<string, UserMetrics>> {
  const userMap = new Map<string, UserMetrics>();

  const current = new Date(startDate);
  while (current <= endDate) {
    const dateStr = current.toISOString().split("T")[0];
    console.log(`  Fetching ${dateStr}...`);

    const records = await fetchRecordsForDate(apiKey, dateStr);

    for (const record of records) {
      if (record.actor.type !== "user_actor" || !record.actor.email_address) continue;

      const email = record.actor.email_address;

      if (!userMap.has(email)) {
        userMap.set(email, {
          email,
          isActive: false,
          activeDays: 0,
          firstActiveDate: null,
          lastActiveDate: null,
          totalSessions: 0,
          totalLinesAdded: 0,
          totalLinesRemoved: 0,
          totalCommits: 0,
          totalPRs: 0,
          toolActions: {
            editTool: { accepted: 0, rejected: 0, acceptanceRate: null },
            multiEditTool: { accepted: 0, rejected: 0, acceptanceRate: null },
            writeTool: { accepted: 0, rejected: 0, acceptanceRate: null },
            overall: { accepted: 0, rejected: 0, acceptanceRate: null },
          },
          tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
          estimatedCostCents: 0,
          terminalTypes: [],
          modelBreakdown: [],
        });
      }

      const user = userMap.get(email)!;

      if (record.core_metrics.num_sessions > 0) {
        user.isActive = true;
        user.activeDays++;
        if (!user.firstActiveDate || dateStr < user.firstActiveDate) user.firstActiveDate = dateStr;
        if (!user.lastActiveDate || dateStr > user.lastActiveDate) user.lastActiveDate = dateStr;
      }

      user.totalSessions += record.core_metrics.num_sessions;
      user.totalLinesAdded += record.core_metrics.lines_of_code.added;
      user.totalLinesRemoved += record.core_metrics.lines_of_code.removed;
      user.totalCommits += record.core_metrics.commits_by_claude_code;
      user.totalPRs += record.core_metrics.pull_requests_by_claude_code;

      const ta = record.tool_actions;
      user.toolActions.editTool.accepted += ta.edit_tool.accepted;
      user.toolActions.editTool.rejected += ta.edit_tool.rejected;
      user.toolActions.multiEditTool.accepted += ta.multi_edit_tool.accepted;
      user.toolActions.multiEditTool.rejected += ta.multi_edit_tool.rejected;
      user.toolActions.writeTool.accepted += ta.write_tool.accepted;
      user.toolActions.writeTool.rejected += ta.write_tool.rejected;

      if (record.terminal_type && !user.terminalTypes.includes(record.terminal_type)) {
        user.terminalTypes.push(record.terminal_type);
      }

      for (const mb of record.model_breakdown) {
        user.tokens.input += mb.tokens.input;
        user.tokens.output += mb.tokens.output;
        user.tokens.cacheRead += mb.tokens.cache_read;
        user.tokens.cacheCreation += mb.tokens.cache_creation;
        user.estimatedCostCents += mb.estimated_cost.amount;

        const existing = user.modelBreakdown.find((m) => m.model === mb.model);
        if (existing) {
          existing.inputTokens += mb.tokens.input;
          existing.outputTokens += mb.tokens.output;
          existing.cacheReadTokens += mb.tokens.cache_read;
          existing.cacheCreationTokens += mb.tokens.cache_creation;
          existing.costCents += mb.estimated_cost.amount;
        } else {
          user.modelBreakdown.push({
            model: mb.model,
            inputTokens: mb.tokens.input,
            outputTokens: mb.tokens.output,
            cacheReadTokens: mb.tokens.cache_read,
            cacheCreationTokens: mb.tokens.cache_creation,
            costCents: mb.estimated_cost.amount,
          });
        }
      }
    }

    current.setDate(current.getDate() + 1);
    await sleep(200);
  }

  // Finalize acceptance rates
  for (const user of userMap.values()) {
    user.tokens.total =
      user.tokens.input + user.tokens.output + user.tokens.cacheRead + user.tokens.cacheCreation;
    user.toolActions.editTool.acceptanceRate = acceptanceRate(
      user.toolActions.editTool.accepted,
      user.toolActions.editTool.rejected
    );
    user.toolActions.multiEditTool.acceptanceRate = acceptanceRate(
      user.toolActions.multiEditTool.accepted,
      user.toolActions.multiEditTool.rejected
    );
    user.toolActions.writeTool.acceptanceRate = acceptanceRate(
      user.toolActions.writeTool.accepted,
      user.toolActions.writeTool.rejected
    );
    const totalAccepted =
      user.toolActions.editTool.accepted +
      user.toolActions.multiEditTool.accepted +
      user.toolActions.writeTool.accepted;
    const totalRejected =
      user.toolActions.editTool.rejected +
      user.toolActions.multiEditTool.rejected +
      user.toolActions.writeTool.rejected;
    user.toolActions.overall.accepted = totalAccepted;
    user.toolActions.overall.rejected = totalRejected;
    user.toolActions.overall.acceptanceRate = acceptanceRate(totalAccepted, totalRejected);
    user.modelBreakdown.sort((a, b) => b.costCents - a.costCents);
  }

  return userMap;
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith("--"));

  let outputFile = "claude-code-data.json";
  let orgSlug = "my-org";
  let days = 7;
  let sinceOverride: Date | undefined;

  for (const flag of flags) {
    if (flag.startsWith("--output=")) outputFile = flag.replace("--output=", "");
    if (flag.startsWith("--org-slug=")) orgSlug = flag.replace("--org-slug=", "");
    if (flag.startsWith("--days=")) days = parseInt(flag.replace("--days=", ""), 10);
    if (flag.startsWith("--since=")) sinceOverride = new Date(flag.replace("--since=", ""));
  }

  // --upload-only: skip export, read existing file and upload
  if (isUploadOnly()) {
    const inputFile = flags.find((a) => a.startsWith("--input="))?.replace("--input=", "") || outputFile;
    const data = readInputFile(inputFile);
    console.log(`Read ${inputFile}: ${data.users?.length ?? 0} users`);
    const uploadPayload = {
      metadata: {
        source: "claude-code" as const,
        organizationSlug: data.metadata?.organizationSlug || orgSlug,
        startDate: data.metadata?.startDate,
        endDate: data.metadata?.endDate,
        exportedAt: data.metadata?.exportedAt || new Date().toISOString(),
        version: "1.0",
      },
      users: (data.users || []).map((u: any) => ({
        email: u.email,
        githubUsername: "",
        tool: "claude-code" as const,
        name: u.email,
        isActive: u.isActive,
        activeDays: u.activeDays ?? 0,
        tabsAccepted: 0,
        tabsTotal: 0,
        agentEditsAccepted: u.toolActions?.overall?.accepted ?? 0,
        agentEditsRejected: u.toolActions?.overall?.rejected ?? 0,
        commandsRun: 0,
        planModeUses: 0,
        askModeUses: 0,
        modelsUsed: (u.modelBreakdown || []).map((m: any) => m.model),
        linesWithAi: u.totalLinesAdded ?? 0,
        totalLines: (u.totalLinesAdded ?? 0) + (u.totalLinesRemoved ?? 0),
        prsWithAi: u.totalPRs ?? 0,
        totalPrs: u.totalPRs ?? 0,
      })),
    };
    await uploadToApi("ai-tools", uploadPayload);
    process.exit(0);
  }

  const endDate = new Date();
  endDate.setUTCHours(0, 0, 0, 0);
  // API only has data older than 1 hour; use yesterday as safe end date
  endDate.setDate(endDate.getDate() - 1);

  const startDate = sinceOverride ?? new Date(endDate);
  if (!sinceOverride) {
    startDate.setDate(endDate.getDate() - (days - 1));
  }

  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];

  console.log("=".repeat(60));
  console.log("Exporting Claude Code analytics");
  console.log(`Organization: ${orgSlug}`);
  console.log(`Date range: ${startStr} → ${endStr} (${days} days)`);
  console.log(`Output file: ${outputFile}`);
  console.log("=".repeat(60));
  console.log("");

  const apiKey = getAdminApiKey();

  try {
    console.log("Fetching usage data...");
    const userMap = await aggregateMetrics(apiKey, startDate, endDate);
    const users = Array.from(userMap.values()).sort((a, b) => b.totalSessions - a.totalSessions);

    const activeUsers = users.filter((u) => u.isActive);
    const inactiveUsers = users.filter((u) => !u.isActive);

    const totalInputTokens = users.reduce((s, u) => s + u.tokens.input, 0);
    const totalOutputTokens = users.reduce((s, u) => s + u.tokens.output, 0);
    const totalCostCents = users.reduce((s, u) => s + u.estimatedCostCents, 0);
    const totalAccepted = users.reduce((s, u) => s + u.toolActions.overall.accepted, 0);
    const totalRejected = users.reduce((s, u) => s + u.toolActions.overall.rejected, 0);

    const payload: ExportPayload = {
      metadata: {
        exportedAt: new Date().toISOString(),
        source: "claude-code",
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
        totalSessions: users.reduce((s, u) => s + u.totalSessions, 0),
        totalLinesAdded: users.reduce((s, u) => s + u.totalLinesAdded, 0),
        totalLinesRemoved: users.reduce((s, u) => s + u.totalLinesRemoved, 0),
        totalCommits: users.reduce((s, u) => s + u.totalCommits, 0),
        totalPRs: users.reduce((s, u) => s + u.totalPRs, 0),
        totalInputTokens,
        totalOutputTokens,
        totalCostCents,
        totalCostDollars: parseFloat((totalCostCents / 100).toFixed(2)),
        overallAcceptanceRate: acceptanceRate(totalAccepted, totalRejected),
      },
      users,
    };

    writeFileSync(outputFile, JSON.stringify(payload, null, 2));

    console.log("");
    console.log("=".repeat(60));
    console.log("EXPORT COMPLETE");
    console.log("=".repeat(60));
    console.log(`  Total users:     ${users.length}`);
    console.log(`  Active users:    ${activeUsers.length}`);
    console.log(`  Inactive users:  ${inactiveUsers.length}`);
    console.log(
      `  Utilization:     ${(payload.summary.utilizationRate * 100).toFixed(0)}%`
    );
    console.log(`  Total sessions:  ${payload.summary.totalSessions}`);
    console.log(`  Total tokens:    ${(totalInputTokens + totalOutputTokens).toLocaleString()}`);
    console.log(`  Est. cost:       $${payload.summary.totalCostDollars.toFixed(2)}`);
    if (inactiveUsers.length > 0) {
      console.log("");
      console.log(`  Inactive seats (${inactiveUsers.length}):`);
      for (const u of inactiveUsers) console.log(`    - ${u.email}`);
    }
    console.log("");
    console.log(`Output written to: ${outputFile}`);
    console.log(`File size: ${(JSON.stringify(payload).length / 1024).toFixed(2)} KB`);

    if (shouldUpload()) {
      const uploadPayload = {
        metadata: {
          source: "claude-code" as const,
          organizationSlug: payload.metadata.organizationSlug,
          startDate: payload.metadata.startDate,
          endDate: payload.metadata.endDate,
          exportedAt: payload.metadata.exportedAt,
          version: "1.0",
        },
        users: payload.users.map((u: any) => ({
          email: u.email,
          githubUsername: "",
          tool: "claude-code" as const,
          name: u.email,
          isActive: u.isActive,
          activeDays: u.activeDays ?? 0,
          tabsAccepted: 0,
          tabsTotal: 0,
          agentEditsAccepted: u.toolActions?.overall?.accepted ?? 0,
          agentEditsRejected: u.toolActions?.overall?.rejected ?? 0,
          commandsRun: 0,
          planModeUses: 0,
          askModeUses: 0,
          modelsUsed: (u.modelBreakdown || []).map((m: any) => m.model),
          linesWithAi: u.totalLinesAdded ?? 0,
          totalLines: (u.totalLinesAdded ?? 0) + (u.totalLinesRemoved ?? 0),
          prsWithAi: u.totalPRs ?? 0,
          totalPrs: u.totalPRs ?? 0,
        })),
      };
      await uploadToApi("ai-tools", uploadPayload);
    } else {
      console.log("");
      console.log("Tip: add --upload to export and upload in one step");
    }

    process.exit(0);
  } catch (error) {
    console.error("Export failed:", error);
    process.exit(1);
  }
}

main();
