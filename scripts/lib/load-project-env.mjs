import fs from "node:fs";
import path from "node:path";

function parseValue(rawValue) {
  const trimmed = rawValue.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function parseEnvText(text) {
  const values = new Map();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(`Malformed environment assignment on line ${index + 1}.`);
    }

    const key = line.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment key on line ${index + 1}.`);
    }

    values.set(key, parseValue(line.slice(separator + 1)));
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
