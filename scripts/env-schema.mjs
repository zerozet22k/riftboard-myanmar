#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const examplePath = path.join(repoRoot, ".env.example");
const defaultTargets = [".env", ".env.local"];

const sensitiveExampleKeys = new Set([
  "MONGODB_URI",
  "RIOT_API_KEY",
  "RIOT_TFT_API_KEY",
  "SUBMIT_CODE",
  "CRON_KEY",
  "SCHEDULER_TOKEN",
  "CRON_SECRET",
  "COMMUNITY_RUNNER_TOKEN",
  "REFRESH_RUNNER_TOKEN",
  "COMMUNITY_JOIN_CODE",
  "TOURNAMENT_HOST_CODE",
  "RIOT_TOURNAMENT_CALLBACK_TOKEN",
  "APP_SESSION_SECRET",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_BOT_TOKEN",
  "RSO_CLIENT_SECRET",
  "ADMIN_SECRET",
]);

const sourceAliasKeys = new Set([
  "COMMUNITY_DISCORD_INVITE_URL",
  "DATABASE_URL",
  "DISCORD_CLIENT_ID",
  "DISCORD_EMOJI_MAP",
  "DISCORD_INVITE_URL",
  "DISCORD_SERVER_GUILD_ID",
  "MONGO_URI",
  "NEXT_PUBLIC_COMMUNITY_DISCORD_URL",
  "NEXT_PUBLIC_DISCORD_INVITE_URL",
  "NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION",
  "PUBLIC_APP_URL",
  "RIOT_RSO_CLIENT_ID",
  "RIOT_RSO_CLIENT_SECRET",
  "TFT_API_KEY",
]);

const platformKeys = new Set([
  "NODE_ENV",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
]);

const sourceExtensions = new Set([".cs", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".ps1"]);
const skippedSourceDirectories = new Set([
  ".git",
  ".next",
  "bin",
  "dist",
  "host-share",
  "node_modules",
  "obj",
  "publish",
  "tests",
]);

const directEmojiKeys = [
  "CHALLENGER",
  "GRANDMASTER",
  "MASTER",
  "DIAMOND",
  "EMERALD",
  "PLATINUM",
  "GOLD",
  "SILVER",
  "BRONZE",
  "IRON",
  "TOP",
  "JUNGLE",
  "MID",
  "BOT",
  "SUPPORT",
].map((name) => `DISCORD_EMOJI_${name}`);

export class EnvSchemaError extends Error {}

function detectEol(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeValue(rhs) {
  const trimmed = rhs.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function parseEnvDocument(text, label = "<memory>") {
  const eol = detectEol(text);
  const hadFinalEol = text.endsWith("\n");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (hadFinalEol) lines.pop();

  const entries = [];
  const malformedLines = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match || !/^[A-Z][A-Z0-9_]*$/.test(match[1])) {
      malformedLines.push(index + 1);
      continue;
    }

    entries.push({
      key: match[1],
      rhs: match[2],
      line: index + 1,
    });
  }

  const occurrences = new Map();
  for (const entry of entries) {
    const existing = occurrences.get(entry.key) ?? [];
    existing.push(entry);
    occurrences.set(entry.key, existing);
  }

  return {
    label,
    text,
    lines,
    eol,
    hadFinalEol,
    entries,
    occurrences,
    malformedLines,
  };
}

function resolveValues(document, { allowSafeDuplicates = false } = {}) {
  const values = new Map();
  const deduplicated = [];
  const conflicts = [];

  for (const [key, entries] of document.occurrences) {
    if (entries.length === 1) {
      values.set(key, entries[0]);
      continue;
    }

    if (!allowSafeDuplicates) {
      conflicts.push({ key, lines: entries.map((entry) => entry.line) });
      continue;
    }

    const nonEmptyValues = [
      ...new Set(entries.map((entry) => normalizeValue(entry.rhs)).filter(Boolean)),
    ];
    if (nonEmptyValues.length > 1) {
      conflicts.push({ key, lines: entries.map((entry) => entry.line) });
      continue;
    }

    const selected =
      nonEmptyValues.length === 1
        ? entries.findLast((entry) => normalizeValue(entry.rhs) === nonEmptyValues[0])
        : entries.at(-1);
    values.set(key, selected);
    deduplicated.push({ key, lines: entries.map((entry) => entry.line) });
  }

  return { values, deduplicated, conflicts };
}

function assertWellFormed(document, kind) {
  if (document.malformedLines.length > 0) {
    throw new EnvSchemaError(
      `${kind} ${document.label} has malformed lines: ${document.malformedLines.join(", ")}`,
    );
  }
}

function schemaDetails(schemaDocument) {
  assertWellFormed(schemaDocument, "Schema");
  const resolved = resolveValues(schemaDocument);
  if (resolved.conflicts.length > 0) {
    const names = resolved.conflicts.map(({ key }) => key).join(", ");
    throw new EnvSchemaError(`Schema ${schemaDocument.label} has duplicate keys: ${names}`);
  }

  return {
    keys: schemaDocument.entries.map((entry) => entry.key),
    values: resolved.values,
  };
}

function compareKeyOrder(left, right) {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

export function inspectTarget(schemaDocument, targetDocument) {
  const schema = schemaDetails(schemaDocument);
  const resolved = resolveValues(targetDocument);
  const targetKeys = [...targetDocument.occurrences.keys()];
  const schemaKeySet = new Set(schema.keys);
  const targetKeySet = new Set(targetKeys);

  return {
    malformedLines: targetDocument.malformedLines,
    duplicates: resolved.conflicts,
    missing: schema.keys.filter((key) => !targetKeySet.has(key)),
    extra: targetKeys.filter((key) => !schemaKeySet.has(key)),
    ordered:
      resolved.conflicts.length === 0 &&
      compareKeyOrder(schema.keys, targetDocument.entries.map((entry) => entry.key)),
  };
}

export function renderTarget(
  schemaDocument,
  targetDocument,
  { fallbackDocument = null } = {},
) {
  const schema = schemaDetails(schemaDocument);
  assertWellFormed(targetDocument, "Target");

  const target = resolveValues(targetDocument, { allowSafeDuplicates: true });
  if (target.conflicts.length > 0) {
    const details = target.conflicts
      .map(({ key, lines }) => `${key} (lines ${lines.join(", ")})`)
      .join("; ");
    throw new EnvSchemaError(
      `Target ${targetDocument.label} has conflicting duplicate values: ${details}`,
    );
  }

  let fallback = null;
  if (fallbackDocument) {
    assertWellFormed(fallbackDocument, "Fallback");
    fallback = resolveValues(fallbackDocument, { allowSafeDuplicates: true });
    if (fallback.conflicts.length > 0) {
      const names = fallback.conflicts.map(({ key }) => key).join(", ");
      throw new EnvSchemaError(`Fallback ${fallbackDocument.label} has conflicting keys: ${names}`);
    }
  }

  const schemaKeySet = new Set(schema.keys);
  const extras = [...target.values.keys()].filter((key) => !schemaKeySet.has(key));
  if (extras.length > 0) {
    throw new EnvSchemaError(
      `Target ${targetDocument.label} has keys absent from .env.example: ${extras.join(", ")}`,
    );
  }

  const selected = new Map();
  const added = [];
  for (const key of schema.keys) {
    if (target.values.has(key)) {
      selected.set(key, target.values.get(key).rhs);
    } else if (fallback?.values.has(key)) {
      selected.set(key, fallback.values.get(key).rhs);
      added.push(key);
    } else {
      selected.set(key, schema.values.get(key).rhs);
      added.push(key);
    }
  }

  const renderedLines = schemaDocument.lines.map((line) => {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (!match) return line;
    return `${match[1]}=${selected.get(match[1])}`;
  });

  const eol = targetDocument.eol || schemaDocument.eol;
  const text = `${renderedLines.join(eol)}${eol}`;
  const uniqueCurrentOrder = [...targetDocument.occurrences.keys()];

  return {
    text,
    added,
    deduplicated: target.deduplicated,
    reordered: !compareKeyOrder(schema.keys, uniqueCurrentOrder),
  };
}

async function readDocument(filePath, { required = true } = {}) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return parseEnvDocument(text, path.relative(repoRoot, filePath) || path.basename(filePath));
  } catch (error) {
    if (!required && error?.code === "ENOENT") {
      return parseEnvDocument("", path.relative(repoRoot, filePath) || path.basename(filePath));
    }
    throw error;
  }
}

async function writeAtomically(filePath, text) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tempPath, text, { encoding: "utf8", flag: "wx" });
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function describeTargetProblems(label, result) {
  const messages = [];
  if (result.malformedLines.length > 0) {
    messages.push(`malformed lines ${result.malformedLines.join(", ")}`);
  }
  if (result.duplicates.length > 0) {
    messages.push(
      `duplicate keys ${result.duplicates
        .map(({ key, lines }) => `${key} (lines ${lines.join(", ")})`)
        .join(", ")}`,
    );
  }
  if (result.missing.length > 0) messages.push(`missing ${result.missing.join(", ")}`);
  if (result.extra.length > 0) messages.push(`unknown ${result.extra.join(", ")}`);
  if (!result.ordered && result.missing.length === 0 && result.extra.length === 0) {
    messages.push("key order differs from .env.example");
  }
  return messages.map((message) => `[env] ${label}: ${message}`);
}

async function checkTargets(targetNames) {
  const schemaDocument = await readDocument(examplePath);
  schemaDetails(schemaDocument);
  const problems = [];

  for (const targetName of targetNames) {
    const targetPath = path.resolve(repoRoot, targetName);
    let targetDocument;
    try {
      targetDocument = await readDocument(targetPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        problems.push(`[env] ${targetName}: file is missing`);
        continue;
      }
      throw error;
    }
    problems.push(...describeTargetProblems(targetName, inspectTarget(schemaDocument, targetDocument)));
  }

  if (problems.length > 0) {
    problems.forEach((problem) => console.error(problem));
    throw new EnvSchemaError("Environment profiles do not match .env.example.");
  }

  console.log(`[env] ${targetNames.join(" and ")} match the .env.example key schema.`);
}

async function syncTargets(targetNames) {
  if (targetNames.length !== 2 || targetNames[0] !== ".env" || targetNames[1] !== ".env.local") {
    throw new EnvSchemaError("Sync currently requires the managed targets: .env and .env.local");
  }

  const schemaDocument = await readDocument(examplePath);
  schemaDetails(schemaDocument);
  const productionPath = path.join(repoRoot, ".env");
  const localPath = path.join(repoRoot, ".env.local");
  const productionDocument = await readDocument(productionPath, { required: false });
  const localDocument = await readDocument(localPath, { required: false });

  // The production profile is never populated from local-only values.
  const productionPlan = renderTarget(schemaDocument, productionDocument);
  const syncedProduction = parseEnvDocument(productionPlan.text, ".env (synced)");

  // Missing local values inherit the production profile before falling back to example defaults.
  const localPlan = renderTarget(schemaDocument, localDocument, {
    fallbackDocument: syncedProduction,
  });

  const writes = [
    { path: productionPath, plan: productionPlan },
    { path: localPath, plan: localPlan },
  ].filter(({ path: filePath, plan }) => {
    const current = filePath === productionPath ? productionDocument.text : localDocument.text;
    return current !== plan.text;
  });

  for (const { path: filePath, plan } of writes) {
    await writeAtomically(filePath, plan.text);
  }

  for (const [targetName, plan] of [
    [".env", productionPlan],
    [".env.local", localPlan],
  ]) {
    const notes = [];
    if (plan.added.length > 0) notes.push(`added ${plan.added.length} keys`);
    if (plan.deduplicated.length > 0) {
      notes.push(`safely deduplicated ${plan.deduplicated.map(({ key }) => key).join(", ")}`);
    }
    if (plan.reordered) notes.push("canonicalized key order");
    console.log(`[env] ${targetName}: ${notes.join("; ") || "already synchronized"}.`);
  }

  await checkTargets(targetNames);
}

async function collectSourceFiles(directory, output = []) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && skippedSourceDirectories.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectSourceFiles(fullPath, output);
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      output.push(fullPath);
    }
  }
  return output;
}

export function findEnvironmentReferences(source) {
  const keys = new Set();
  const patterns = [
    /\bprocess\.env\.([A-Z][A-Z0-9_]*)\b/g,
    /\bprocess\.env\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g,
    /\b(?:mustEnv|optEnv|Env|EnvStatic|numberFromEnv|GetEnvironmentVariable)\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
    /\$env:([A-Z][A-Z0-9_]*)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) keys.add(match[1]);
  }
  return keys;
}

async function checkExample() {
  const schemaDocument = await readDocument(examplePath);
  const schema = schemaDetails(schemaDocument);
  const schemaKeySet = new Set(schema.keys);
  const unsafeDefaults = [...sensitiveExampleKeys].filter((key) => {
    const entry = schema.values.get(key);
    return entry && normalizeValue(entry.rhs) !== "";
  });
  if (unsafeDefaults.length > 0) {
    throw new EnvSchemaError(
      `.env.example contains non-empty sensitive defaults: ${unsafeDefaults.join(", ")}`,
    );
  }

  const sourceKeys = new Set(directEmojiKeys);
  const sourceFiles = await collectSourceFiles(repoRoot);
  for (const sourceFile of sourceFiles) {
    const source = await fs.readFile(sourceFile, "utf8");
    for (const key of findEnvironmentReferences(source)) sourceKeys.add(key);
  }

  const undocumented = [...sourceKeys]
    .filter(
      (key) =>
        !schemaKeySet.has(key) &&
        !sourceAliasKeys.has(key) &&
        !platformKeys.has(key),
    )
    .sort();
  if (undocumented.length > 0) {
    throw new EnvSchemaError(
      `Source code reads keys absent from .env.example: ${undocumented.join(", ")}`,
    );
  }

  console.log(
    `[env] .env.example is valid: ${schema.keys.length} keys; ${sourceKeys.size} source references classified.`,
  );
}

async function main() {
  const [command = "check", ...targetArgs] = process.argv.slice(2);
  const targets = targetArgs.length > 0 ? targetArgs : defaultTargets;

  if (command === "check") {
    await checkTargets(targets);
  } else if (command === "sync") {
    await syncTargets(targets);
  } else if (command === "check-example") {
    await checkExample();
  } else {
    throw new EnvSchemaError(
      "Usage: node scripts/env-schema.mjs <check|sync|check-example> [.env .env.local]",
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`[env] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
