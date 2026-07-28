#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizePortableEnvValue,
  parsePortableEnvText,
} from "./lib/env-format.mjs";

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

const allowedNonEmptyExampleKeys = new Set([
  "APP_BASE_URL",
  "DISCORD_BIND_ROLE_COLOR",
  "DISCORD_BIND_ROLE_NAME",
  "DISCORD_LIVE_GAMES_CHANNEL_ID",
  "DISCORD_RANK_ROLE_PREFIX",
  "DISCORD_REDIRECT_URI",
  "DISCORD_SYNC_SERVER_ROLES_ROLE_ID",
  "DISCORD_VERIFIED_ROLE_COLOR",
  "DISCORD_VERIFIED_ROLE_NAME",
  "LEADERBOARD_CRON_DELAY_MS",
  "LEADERBOARD_CRON_LIMIT",
  "LEADERBOARD_CRON_MATCH_BACKFILL_COUNT",
  "LEADERBOARD_CRON_MATCHES_COUNT",
  "LEADERBOARD_CRON_MAX_LIMIT",
  "LEADERBOARD_CRON_SYNC_MATCHES",
  "LEADERBOARD_CRON_SYNC_TFT_MATCHES",
  "LOCAL_APP_URL",
  "MATCH_RETENTION_LIMIT",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_ENABLE_BULK_SUBMIT",
  "RIOT_429_FALLBACK_MS",
  "RIOT_ACCOUNT_REGION",
  "RIOT_MAX_RETRY_WAIT_MS",
  "RIOT_MIN_REQUEST_INTERVAL_MS",
  "RIOT_RATE_LIMIT_SAFETY_FACTOR",
  "RIOT_REQUEST_TIMEOUT_MS",
  "RIOT_TOURNAMENT_API_ENABLED",
  "RSO_REDIRECT_URI",
  "TFT_MATCH_CRON_DELAY_MS",
  "TFT_MATCH_CRON_LIMIT",
  "TFT_MATCH_CRON_MATCHES_COUNT",
  "TFT_MATCH_CRON_MAX_LIMIT",
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

export function parseEnvDocument(text, label = "<memory>") {
  const parsed = parsePortableEnvText(text);
  const { entries } = parsed;

  const occurrences = new Map();
  for (const entry of entries) {
    const existing = occurrences.get(entry.key) ?? [];
    existing.push(entry);
    occurrences.set(entry.key, existing);
  }

  return {
    ...parsed,
    label,
    occurrences,
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
      ...new Set(entries.map((entry) => normalizePortableEnvValue(entry.rhs)).filter(Boolean)),
    ];
    if (nonEmptyValues.length > 1) {
      conflicts.push({ key, lines: entries.map((entry) => entry.line) });
      continue;
    }

    // All RiftBoard loaders use last-assignment-wins semantics within one file.
    // Keeping the final declaration also preserves an intentional trailing blank
    // used to revoke a previously configured value.
    const selected = entries.at(-1);
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
  if (document.invalidValueLines.length > 0) {
    throw new EnvSchemaError(
      `${kind} ${document.label} has non-portable values: ${document.invalidValueLines
        .map(({ key, line, reason }) => `${key} (line ${line}: ${reason})`)
        .join(", ")}`,
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
  const snapshot = await readCurrentText(filePath);
  if (snapshot.exists) {
    if (!snapshot.regular) {
      throw new EnvSchemaError(
        `${path.basename(filePath)} must be a regular file; symbolic links and special files are not synchronized.`,
      );
    }
    return {
      ...parseEnvDocument(
        snapshot.text,
        path.relative(repoRoot, filePath) || path.basename(filePath),
      ),
      ...snapshot,
    };
  }

  if (required) {
    const error = new Error(`Missing environment file: ${path.basename(filePath)}`);
    error.code = "ENOENT";
    throw error;
  }
  return {
    ...parseEnvDocument("", path.relative(repoRoot, filePath) || path.basename(filePath)),
    ...snapshot,
  };
}

export async function readCurrentText(filePath) {
  let before;
  try {
    before = await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { exists: false, regular: false, text: "", dev: null, ino: null };
    }
    throw error;
  }

  if (!before.isFile() || before.isSymbolicLink()) {
    return {
      exists: true,
      regular: false,
      text: "",
      dev: before.dev,
      ino: before.ino,
    };
  }

  const text = await fs.readFile(filePath, "utf8");
  const after = await fs.lstat(filePath);
  if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino) {
    throw new EnvSchemaError(
      `${path.basename(filePath)} changed while env:sync was reading it; retry the command.`,
    );
  }
  return {
    exists: true,
    regular: true,
    text,
    dev: after.dev,
    ino: after.ino,
    mode: after.mode,
    uid: after.uid,
    gid: after.gid,
  };
}

function sameSnapshot(left, right) {
  return (
    left.exists === right.exists &&
    (!left.exists ||
      (left.regular === right.regular &&
        left.dev === right.dev &&
        left.ino === right.ino &&
        left.mode === right.mode &&
        left.uid === right.uid &&
        left.gid === right.gid &&
        left.text === right.text))
  );
}

async function assertUnchanged(filePath, expected) {
  const current = await readCurrentText(filePath);
  if (!sameSnapshot(current, expected)) {
    throw new EnvSchemaError(
      `${path.basename(filePath)} changed while env:sync was running; no newer edit was overwritten.`,
    );
  }
}

async function stageReplacement(filePath, text, expected) {
  await assertUnchanged(filePath, expected);

  if (expected.exists && !expected.regular) {
    throw new EnvSchemaError(
      `${path.basename(filePath)} must be a regular file; symbolic links and special files are not synchronized.`,
    );
  }
  const tempPath = `${filePath}.sync-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const mode = expected.exists ? expected.mode & 0o7777 : 0o600;
  const handle = await fs.open(tempPath, "wx", mode);
  try {
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (expected.exists && process.platform !== "win32") {
      await fs.chown(tempPath, expected.uid, expected.gid).catch((error) => {
        if (error?.code !== "EPERM") throw error;
      });
    }
    await fs.chmod(tempPath, mode);
    await assertUnchanged(filePath, expected);
    return { tempPath, filePath, text, expected };
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function commitReplacement(staged) {
  await assertUnchanged(staged.filePath, staged.expected);
  await fs.rename(staged.tempPath, staged.filePath);
}

export async function writeFilePreservingMetadata(filePath, text, expected) {
  const staged = await stageReplacement(filePath, text, expected);
  try {
    await commitReplacement(staged);
  } catch (error) {
    await fs.rm(staged.tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function rollbackWrite(filePath, appliedText, original) {
  const current = await readCurrentText(filePath);
  if (!current.exists || !current.regular || current.text !== appliedText) return false;

  if (!original.exists) {
    // Never delete a path that did not exist before the transaction: an
    // external creator could have raced with rollback. Leave the complete,
    // newly-created profile in place and report that rollback was incomplete.
    return false;
  }

  await writeFilePreservingMetadata(filePath, original.text, current);
  return true;
}

async function writePlansWithRollback(writes) {
  await Promise.all(
    writes.map(({ path: filePath, original }) => assertUnchanged(filePath, original)),
  );

  const stagedWrites = [];
  const applied = [];
  try {
    for (const write of writes) {
      stagedWrites.push({
        ...write,
        staged: await stageReplacement(write.path, write.plan.text, write.original),
      });
    }

    await Promise.all(
      stagedWrites.map(({ path: filePath, original }) => assertUnchanged(filePath, original)),
    );
    for (const write of stagedWrites) {
      await commitReplacement(write.staged);
      applied.push(write);
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const write of applied.reverse()) {
      try {
        const restored = await rollbackWrite(write.path, write.plan.text, write.original);
        if (!restored) rollbackFailures.push(path.basename(write.path));
      } catch {
        rollbackFailures.push(path.basename(write.path));
      }
    }
    for (const write of stagedWrites) {
      await fs.rm(write.staged.tempPath, { force: true }).catch(() => {});
    }

    if (rollbackFailures.length > 0) {
      throw new EnvSchemaError(
        `${error instanceof Error ? error.message : String(error)} Rollback could not restore: ${rollbackFailures.join(", ")}`,
      );
    }
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

async function syncTargetsUnlocked(targetNames) {
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
    { path: productionPath, plan: productionPlan, original: productionDocument },
    { path: localPath, plan: localPlan, original: localDocument },
  ].filter(({ path: filePath, plan }) => {
    const current = filePath === productionPath ? productionDocument.text : localDocument.text;
    return current !== plan.text;
  });

  await writePlansWithRollback(writes);

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

async function syncTargets(targetNames) {
  const lockPath = path.join(repoRoot, ".env.sync.lock");
  let lockHandle;
  try {
    lockHandle = await fs.open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new EnvSchemaError(
        "Another env:sync process appears to be running. Remove .env.sync.lock only if no sync is active.",
      );
    }
    throw error;
  }

  try {
    await syncTargetsUnlocked(targetNames);
  } finally {
    await lockHandle.close().catch(() => {});
    await fs.rm(lockPath, { force: true }).catch(() => {});
  }
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
    {
      expression: /\bprocess\.env(?:\?\.|\.)([A-Z][A-Z0-9_]*)\b/g,
      group: 1,
    },
    {
      expression: /\bprocess\.env\[\s*(["'`])([A-Z][A-Z0-9_]*)\1\s*\]/g,
      group: 2,
    },
    {
      expression: /\b(?:[Mm]ustEnv|[Oo]ptEnv|Env|EnvStatic|numberFromEnv|GetEnvironmentVariable)\(\s*["']([A-Z][A-Z0-9_]*)["']/g,
      group: 1,
    },
    {
      expression: /\$env:([A-Z][A-Z0-9_]*)\b/g,
      group: 1,
    },
  ];
  for (const { expression, group } of patterns) {
    for (const match of source.matchAll(expression)) keys.add(match[group]);
  }

  for (const match of source.matchAll(/\{([^{}]+)\}\s*=\s*process\.env\b/g)) {
    for (const part of match[1].split(",")) {
      const key = part.trim().replace(/^\.\.\./, "").split(/[:=]/, 1)[0].trim();
      if (/^[A-Z][A-Z0-9_]*$/.test(key)) keys.add(key);
    }
  }
  return keys;
}

async function checkExample() {
  const trackedEnvFiles = execFileSync(
    "git",
    ["ls-files", "--", ":(glob)**/.env*"],
    { cwd: repoRoot, encoding: "utf8" },
  )
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const unexpectedTrackedEnvFiles = trackedEnvFiles.filter(
    (entry) => entry !== ".env.example",
  );
  if (!trackedEnvFiles.includes(".env.example") || unexpectedTrackedEnvFiles.length > 0) {
    throw new EnvSchemaError(
      `Tracked environment files must contain only .env.example; found: ${trackedEnvFiles.join(", ") || "none"}`,
    );
  }

  const schemaDocument = await readDocument(examplePath);
  const schema = schemaDetails(schemaDocument);
  const schemaKeySet = new Set(schema.keys);
  const unsafeDefaults = [...sensitiveExampleKeys].filter((key) => {
    const entry = schema.values.get(key);
    return entry && normalizePortableEnvValue(entry.rhs) !== "";
  });
  if (unsafeDefaults.length > 0) {
    throw new EnvSchemaError(
      `.env.example contains non-empty sensitive defaults: ${unsafeDefaults.join(", ")}`,
    );
  }
  const unexpectedNonEmptyDefaults = schema.keys.filter((key) => {
    const entry = schema.values.get(key);
    return (
      entry &&
      normalizePortableEnvValue(entry.rhs) !== "" &&
      !allowedNonEmptyExampleKeys.has(key)
    );
  });
  if (unexpectedNonEmptyDefaults.length > 0) {
    throw new EnvSchemaError(
      `.env.example has non-empty defaults that require explicit review: ${unexpectedNonEmptyDefaults.join(", ")}`,
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
