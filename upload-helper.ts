/**
 * Shared upload helper — used by all sync-*.ts scripts when --upload is passed.
 */

import { readFileSync, existsSync } from "fs";

const DEFAULT_API_URL = "https://intel.arka.so/api/v1";

export function getApiKey(): string {
  if (process.env.API_ADMIN_KEY) return process.env.API_ADMIN_KEY;
  try {
    const env = readFileSync(".env", "utf-8");
    const match = env.match(/^API_ADMIN_KEY=(.+)$/m);
    if (match) return match[1].trim();
  } catch {}
  console.error(
    "Error: API_ADMIN_KEY not set. Set it in .env or as an environment variable."
  );
  process.exit(1);
}

export function getApiUrl(): string {
  const arg = process.argv.find((a) => a.startsWith("--api-url="));
  return arg ? arg.split("=").slice(1).join("=") : DEFAULT_API_URL;
}

export function shouldUpload(): boolean {
  return process.argv.includes("--upload") || process.argv.includes("--upload-only");
}

export function isUploadOnly(): boolean {
  return process.argv.includes("--upload-only");
}

export function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

export function readInputFile(file: string): any {
  if (!existsSync(file)) {
    console.error(`File not found: ${file}`);
    console.error("Run the export first, or check the --input path.");
    process.exit(1);
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}

export async function uploadToApi(
  type: string,
  body: unknown
): Promise<void> {
  const apiUrl = getApiUrl();
  const apiKey = getApiKey();
  const url = `${apiUrl}/uploads/${type}`;

  console.log("");
  console.log(`Uploading to ${url} ...`);

  if (isDryRun()) {
    const json = JSON.stringify(body, null, 2);
    console.log(`[dry-run] Would POST ${(json.length / 1024).toFixed(1)} KB`);
    return;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Upload failed (${res.status}): ${text}`);
    process.exit(1);
  }

  const result: any = await res.json();
  console.log("Upload successful!");
  console.log(`  Upload ID:  ${result.uploadId}`);
  console.log(`  Records:    ${result.recordCount}`);
  if (result.diffSummary) {
    const d = result.diffSummary;
    console.log(`  Added:      ${d.added}`);
    console.log(`  Changed:    ${d.changed}`);
    console.log(`  Unchanged:  ${d.unchanged}`);
    if (d.missingFromUpload) console.log(`  Missing:    ${d.missingFromUpload}`);
  }
}
