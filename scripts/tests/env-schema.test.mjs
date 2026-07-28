import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EnvSchemaError,
  findEnvironmentReferences,
  parseEnvDocument,
  readCurrentText,
  renderTarget,
  writeFilePreservingMetadata,
} from "../env-schema.mjs";
import { loadProjectEnv, parseEnvText } from "../lib/load-project-env.mjs";

test("renderTarget preserves values while safely resolving harmless duplicates", () => {
  const schema = parseEnvDocument('ALPHA=""\nBETA="default"\n', ".env.example");
  const target = parseEnvDocument(
    'BETA="kept"\nALPHA=\nALPHA="local-value"\n',
    ".env.local",
  );

  const result = renderTarget(schema, target);

  assert.equal(result.text, 'ALPHA="local-value"\nBETA="kept"\n');
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.deduplicated.map(({ key }) => key), ["ALPHA"]);
  assert.equal(result.reordered, true);
});

test("renderTarget refuses conflicting non-empty duplicate values", () => {
  const schema = parseEnvDocument('ALPHA=""\n', ".env.example");
  const target = parseEnvDocument('ALPHA="one"\nALPHA="two"\n', ".env.local");

  assert.throws(
    () => renderTarget(schema, target),
    (error) => error instanceof EnvSchemaError && /conflicting duplicate/.test(error.message),
  );
});

test("a trailing blank duplicate remains blank instead of reviving an old value", () => {
  const schema = parseEnvDocument('ALPHA=""\n', ".env.example");
  const target = parseEnvDocument('ALPHA="old-value"\nALPHA=\n', ".env.local");

  const result = renderTarget(schema, target);

  assert.equal(result.text, "ALPHA=\n");
});

test("local rendering inherits production while production never inherits local", () => {
  const schema = parseEnvDocument('PUBLIC_URL="example"\nLOCAL_ONLY=""\n', ".env.example");
  const production = parseEnvDocument('PUBLIC_URL="production"\n', ".env");
  const local = parseEnvDocument('LOCAL_ONLY="local"\n', ".env.local");

  const productionPlan = renderTarget(schema, production);
  assert.equal(productionPlan.text, 'PUBLIC_URL="production"\nLOCAL_ONLY=""\n');

  const syncedProduction = parseEnvDocument(productionPlan.text, ".env (synced)");
  const localPlan = renderTarget(schema, local, { fallbackDocument: syncedProduction });
  assert.equal(localPlan.text, 'PUBLIC_URL="production"\nLOCAL_ONLY="local"\n');
});

test("source reference extraction covers supported language forms", () => {
  const references = findEnvironmentReferences(`
    process.env.DIRECT_KEY;
    process.env?.OPTIONAL_KEY;
    process.env["BRACKET_KEY"];
    process.env[\`TEMPLATE_KEY\`];
    const { DESTRUCTURED_KEY, RENAMED_KEY: localName } = process.env;
    mustEnv("HELPER_KEY");
    MustEnv("CSHARP_HELPER_KEY");
    Environment.GetEnvironmentVariable("CSHARP_KEY");
    $env:POWERSHELL_KEY
  `);

  assert.deepEqual(
    [...references].sort(),
    [
      "BRACKET_KEY",
      "CSHARP_HELPER_KEY",
      "CSHARP_KEY",
      "DESTRUCTURED_KEY",
      "DIRECT_KEY",
      "HELPER_KEY",
      "OPTIONAL_KEY",
      "POWERSHELL_KEY",
      "RENAMED_KEY",
      "TEMPLATE_KEY",
    ],
  );
});

test("shared loader gives process variables priority, then local, then base", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "riftboard-env-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  await fs.writeFile(
    path.join(directory, ".env"),
    'BASE_ONLY="base"\nOVERRIDE="base"\nPROCESS_WINS="base"\n',
  );
  await fs.writeFile(
    path.join(directory, ".env.local"),
    'OVERRIDE="local"\nLOCAL_ONLY="local"\nPROCESS_WINS="local"\n',
  );

  const environment = { PROCESS_WINS: "process" };
  loadProjectEnv({ cwd: directory, environment });

  assert.deepEqual(environment, {
    PROCESS_WINS: "process",
    BASE_ONLY: "base",
    OVERRIDE: "local",
    LOCAL_ONLY: "local",
  });
});

test("safe writes refuse to overwrite a file changed after it was read", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "riftboard-env-race-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, ".env");
  await fs.writeFile(file, 'ALPHA="original"\n', { mode: 0o600 });
  const original = await readCurrentText(file);
  await fs.writeFile(file, 'ALPHA="newer-editor-save"\n');

  await assert.rejects(
    () => writeFilePreservingMetadata(file, 'ALPHA="pipeline"\n', original),
    /changed while env:sync was running/,
  );
  assert.equal(await fs.readFile(file, "utf8"), 'ALPHA="newer-editor-save"\n');
});

test("safe writes atomically replace an existing regular file", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "riftboard-env-replace-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, ".env");
  await fs.writeFile(file, 'ALPHA="original"\n', { mode: 0o600 });
  const original = await readCurrentText(file);

  await writeFilePreservingMetadata(file, 'ALPHA="updated"\n', original);

  assert.equal(await fs.readFile(file, "utf8"), 'ALPHA="updated"\n');
  assert.deepEqual(await fs.readdir(directory), [".env"]);
});

test("safe writes create a complete missing profile without temp artifacts", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "riftboard-env-create-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, ".env");
  const missing = await readCurrentText(file);

  await writeFilePreservingMetadata(file, 'ALPHA="created"\n', missing);

  assert.equal(await fs.readFile(file, "utf8"), 'ALPHA="created"\n');
  assert.deepEqual(await fs.readdir(directory), [".env"]);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  }
});

test(
  "safe writes refuse symbolic-link profiles",
  { skip: process.platform === "win32" },
  async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "riftboard-env-link-test-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const target = path.join(directory, "target");
    const link = path.join(directory, ".env");
    await fs.writeFile(target, 'ALPHA="outside"\n');
    await fs.symlink(target, link);
    const snapshot = await readCurrentText(link);

    await assert.rejects(
      () => writeFilePreservingMetadata(link, 'ALPHA="pipeline"\n', snapshot),
      /must be a regular file/,
    );
    assert.equal(await fs.readFile(target, "utf8"), 'ALPHA="outside"\n');
  },
);

test(
  "safe writes preserve existing POSIX permissions",
  { skip: process.platform === "win32" },
  async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "riftboard-env-mode-test-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, ".env");
    await fs.writeFile(file, 'ALPHA="original"\n', { mode: 0o600 });
    const original = await readCurrentText(file);

    await writeFilePreservingMetadata(file, 'ALPHA="updated"\n', original);

    const mode = (await fs.stat(file)).mode & 0o777;
    assert.equal(mode, 0o600);
  },
);

test("schema and runtime parser enforce the same portable syntax", () => {
  assert.deepEqual(
    Object.fromEntries(parseEnvText('ALPHA="available"\nURL="https://example.test/#fragment"\n')),
    {
      ALPHA: "available",
      URL: "https://example.test/#fragment",
    },
  );
  assert.throws(
    () => parseEnvText("export ALPHA=value\n"),
    /Malformed environment assignments on lines 1/,
  );
  assert.throws(
    () => parseEnvText("FRAGMENT=https://example.test/#section\nEXPANDS=$OTHER\n"),
    /Non-portable environment values on lines 1, 2/,
  );
});
