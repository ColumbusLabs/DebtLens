import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

describe("Action runtime bootstrap", () => {
  it("downloads a tagged release runtime before falling back to npm", () => {
    const root = mkdtempSync(join(tmpdir(), "debtlens-action-bootstrap-"));
    const actionPath = join(root, "action");
    const runnerTemp = join(root, "runner");
    const payload = join(root, "payload");
    const fakeBin = join(root, "bin");
    const marker = join(root, "npm-called");
    const tarball = join(root, "debtlens-action-dist.tgz");
    const checksum = join(root, "debtlens-action-dist.tgz.sha256");

    mkdirSync(join(actionPath, "scripts"), { recursive: true });
    mkdirSync(runnerTemp, { recursive: true });
    mkdirSync(join(payload, "dist", "cli"), { recursive: true });
    mkdirSync(join(payload, "node_modules", ".bin"), { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(payload, "dist", "cli", "index.js"), "console.log('ok');\n");
    writeFileSync(join(payload, "node_modules", ".keep"), "");

    const tarResult = spawnSync("tar", ["-C", payload, "-czf", tarball, "."], {
      encoding: "utf8",
    });
    assert.equal(tarResult.status, 0, tarResult.stderr);
    const checksumResult = spawnSync(
      "shasum",
      ["-a", "256", "-b", tarball],
      { encoding: "utf8" },
    );
    assert.equal(checksumResult.status, 0, checksumResult.stderr);
    writeFileSync(
      checksum,
      checksumResult.stdout.replace(tarball, "debtlens-action-dist.tgz"),
    );

    const curlShim = join(fakeBin, "curl");
    writeFileSync(
      curlShim,
      `#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    out="$1"
  else
    url="$1"
  fi
  shift || true
done
if [[ "$url" == *.sha256 ]]; then
  cp "$TEST_RELEASE_CHECKSUM" "$out"
else
  cp "$TEST_RELEASE_TARBALL" "$out"
fi
`,
    );
    chmodSync(curlShim, 0o755);

    const npmShim = join(fakeBin, "npm");
    writeFileSync(
      npmShim,
      `#!/usr/bin/env bash
echo npm-called >> "$TEST_NPM_MARKER"
exit 42
`,
    );
    chmodSync(npmShim, 0o755);

    const result = spawnSync("bash", ["scripts/prepare-action-runtime.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        GITHUB_ACTION_PATH: actionPath,
        RUNNER_TEMP: runnerTemp,
        DL_ACTION_REF: "v0.3.0",
        DL_ACTION_REPOSITORY: "ColumbusLabs/DebtLens",
        TEST_RELEASE_TARBALL: tarball,
        TEST_RELEASE_CHECKSUM: checksum,
        TEST_NPM_MARKER: marker,
      },
    });

    try {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(existsSync(join(actionPath, "dist", "cli", "index.js")), true);
      assert.equal(existsSync(marker), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("verifies the downloaded runtime tarball instead of the checksum filename", () => {
    const root = mkdtempSync(join(tmpdir(), "debtlens-action-bootstrap-"));
    const actionPath = join(root, "action");
    const runnerTemp = join(root, "runner");
    const payload = join(root, "payload");
    const fakeBin = join(root, "bin");
    const marker = join(root, "npm-called");
    const tarball = join(root, "debtlens-action-dist.tgz");
    const checksum = join(root, "debtlens-action-dist.tgz.sha256");

    mkdirSync(join(actionPath, "scripts"), { recursive: true });
    mkdirSync(runnerTemp, { recursive: true });
    mkdirSync(join(payload, "dist", "cli"), { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(join(payload, "dist", "cli", "index.js"), "console.log('ok');\n");

    const tarResult = spawnSync("tar", ["-C", payload, "-czf", tarball, "."], {
      encoding: "utf8",
    });
    assert.equal(tarResult.status, 0, tarResult.stderr);
    writeFileSync(
      checksum,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  /dev/null\n",
    );

    const curlShim = join(fakeBin, "curl");
    writeFileSync(
      curlShim,
      `#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    shift
    out="$1"
  else
    url="$1"
  fi
  shift || true
done
if [[ "$url" == *.sha256 ]]; then
  cp "$TEST_RELEASE_CHECKSUM" "$out"
else
  cp "$TEST_RELEASE_TARBALL" "$out"
fi
`,
    );
    chmodSync(curlShim, 0o755);

    const npmShim = join(fakeBin, "npm");
    writeFileSync(
      npmShim,
      `#!/usr/bin/env bash
echo npm-called >> "$TEST_NPM_MARKER"
exit 42
`,
    );
    chmodSync(npmShim, 0o755);

    const result = spawnSync("bash", ["scripts/prepare-action-runtime.sh"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        GITHUB_ACTION_PATH: actionPath,
        RUNNER_TEMP: runnerTemp,
        DL_ACTION_REF: "v0.3.0",
        DL_ACTION_REPOSITORY: "ColumbusLabs/DebtLens",
        TEST_RELEASE_TARBALL: tarball,
        TEST_RELEASE_CHECKSUM: checksum,
        TEST_NPM_MARKER: marker,
      },
    });

    try {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /checksum mismatch/);
      assert.equal(existsSync(join(actionPath, "dist", "cli", "index.js")), false);
      assert.equal(existsSync(marker), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
