import fs from "node:fs";
import path from "node:path";
import {
  normalizePortableEnvValue,
  parsePortableEnvText,
} from "./env-format.mjs";

export function parseEnvText(text) {
  const parsed = parsePortableEnvText(text);
  if (parsed.malformedLines.length > 0) {
    throw new Error(
      `Malformed environment assignments on lines ${parsed.malformedLines.join(", ")}.`,
    );
  }
  if (parsed.invalidValueLines.length > 0) {
    throw new Error(
      `Non-portable environment values on lines ${parsed.invalidValueLines
        .map(({ line }) => line)
        .join(", ")}.`,
    );
  }

  const values = new Map();
  for (const entry of parsed.entries) {
    values.set(entry.key, normalizePortableEnvValue(entry.rhs));
  }
  return values;
}

export function loadProjectEnv({
  cwd = process.cwd(),
  environment = process.env,
  files = [".env", ".env.local"],
} = {}) {
  const fileValues = new Map();
  const loadedFiles = [];

  // Read the base profile first and then apply the local profile as its override.
  for (const file of files) {
    const filePath = path.resolve(cwd, file);
    if (!fs.existsSync(filePath)) continue;
    const parsed = parseEnvText(fs.readFileSync(filePath, "utf8"));
    for (const [key, value] of parsed) fileValues.set(key, value);
    loadedFiles.push(file);
  }

  // Explicit process variables remain highest priority, matching Next's behavior.
  for (const [key, value] of fileValues) {
    if (!(key in environment)) environment[key] = value;
  }

  return {
    loadedFiles,
    loadedKeys: [...fileValues.keys()],
  };
}
