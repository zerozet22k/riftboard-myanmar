export function normalizePortableEnvValue(rhs) {
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

export function portableEnvValueIssue(rhs) {
  const trimmed = rhs.trim();
  if (trimmed.includes("$")) return "dollar expansion is not portable";

  const startsWithQuote = trimmed.startsWith('"') || trimmed.startsWith("'");
  const endsWithQuote = trimmed.endsWith('"') || trimmed.endsWith("'");
  const fullyQuoted =
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")));
  if ((startsWithQuote || endsWithQuote) && !fullyQuoted) {
    return "quotes must wrap the complete value";
  }
  if (!fullyQuoted && trimmed.includes("#")) {
    return "values containing # must be quoted";
  }
  return null;
}

export function parsePortableEnvText(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalEol = text.endsWith("\n");
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (hadFinalEol) lines.pop();

  const entries = [];
  const malformedLines = [];
  const invalidValueLines = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match || !/^[A-Z][A-Z0-9_]*$/.test(match[1])) {
      malformedLines.push(index + 1);
      continue;
    }

    const entry = {
      key: match[1],
      rhs: match[2],
      line: index + 1,
    };
    const valueIssue = portableEnvValueIssue(entry.rhs);
    if (valueIssue) {
      invalidValueLines.push({ key: entry.key, line: entry.line, reason: valueIssue });
    }
    entries.push(entry);
  }

  return {
    text,
    lines,
    eol,
    hadFinalEol,
    entries,
    malformedLines,
    invalidValueLines,
  };
}
