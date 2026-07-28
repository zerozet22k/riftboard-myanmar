import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EnvSchemaError,
  findEnvironmentReferences,
  parseEnvDocument,
  renderTarget,
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
    process.env["BRACKET_KEY"];
    mustEnv("HELPER_KEY");
    Environment.GetEnvironmentVariable("CSHARP_KEY");
    $env:POWERSHELL_KEY
  `);

  assert.deepEqual(
    [...references].sort(),
    ["BRACKET_KEY", "CSHARP_KEY", "DIRECT_KEY", "HELPER_KEY", "POWERSHELL_KEY"],
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

test("shared parser rejects malformed assignments without echoing their contents", () => {
  assert.throws(
    () => parseEnvText("NOT AN ASSIGNMENT"),
    (error) =>
      /Malformed environment assignment on line 1/.test(error.message) &&
      !error.message.includes("NOT AN ASSIGNMENT"),
  );
});
