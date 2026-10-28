import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { resolve } from "node:path";
import { loadWebConfig } from "./web-config.mjs";

function fixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "airnobe-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test("keeps an existing library and pins its absolute path", t => {
  const root = fixture(t);
  mkdirSync(resolve(root, "AirnobeLibrary"));
  writeFileSync(resolve(root, "AirnobeLibrary/library.json"), "{}");
  assert.equal(loadWebConfig(root, {}).libraryDirectory, resolve(root, "AirnobeLibrary"));
  assert.equal(loadWebConfig(root, {}).libraryDirectory, resolve(root, "AirnobeLibrary"));
});
test("new installations use a directory outside the checkout; env overrides local configuration", t => {
  const root = fixture(t);
  assert.equal(loadWebConfig(root, {}).libraryDirectory, resolve(homedir(), "AirnobeLibrary"));
  assert.deepEqual(loadWebConfig(root, { AIRNOBE_LIBRARY_DIRECTORY: resolve(root, "other"), AIRNOBE_WEB_PORT: "5180" }), { libraryDirectory: resolve(root, "other"), port: 5180 });
});
test("rejects relative data paths and invalid ports", t => {
  const root = fixture(t);
  assert.throws(() => loadWebConfig(root, { AIRNOBE_LIBRARY_DIRECTORY: "relative" }), /绝对路径/);
  assert.throws(() => loadWebConfig(root, { AIRNOBE_WEB_PORT: "NaN" }), /端口/);
});
