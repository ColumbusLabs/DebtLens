#!/usr/bin/env bash
set -euo pipefail

action_path="${GITHUB_ACTION_PATH:-$(pwd)}"
runner_temp="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
action_ref="${DL_ACTION_REF:-${GITHUB_ACTION_REF:-}}"
action_repo="${DL_ACTION_REPOSITORY:-${GITHUB_ACTION_REPOSITORY:-ColumbusLabs/DebtLens}}"

cd "$action_path"

# Version tags can fetch a self-contained runtime asset. Source checkouts keep
# the install/build fallback for local development and unreleased branches.
if [ ! -f dist/cli/index.js ] && [[ "$action_ref" == v* ]]; then
  asset_path="$runner_temp/debtlens-action-dist.tgz"
  asset_url="https://github.com/${action_repo}/releases/download/${action_ref}/debtlens-action-dist.tgz"
  checksum_path="${asset_path}.sha256"
  checksum_url="${asset_url}.sha256"
  if curl -fsSL "$asset_url" -o "$asset_path"; then
    if curl -fsSL "$checksum_url" -o "$checksum_path"; then
      if command -v sha256sum >/dev/null 2>&1; then
        (cd "$(dirname "$asset_path")" && sha256sum -c "$(basename "$checksum_path")")
      else
        expected="$(awk '{ print $1 }' "$checksum_path")"
        actual="$(shasum -a 256 "$asset_path" | awk '{ print $1 }')"
        if [ "$expected" != "$actual" ]; then
          echo "DebtLens: release runtime checksum mismatch." >&2
          exit 1
        fi
      fi
    else
      echo "DebtLens: release runtime checksum missing; refusing to extract untrusted asset." >&2
      exit 1
    fi
    tar -xzf "$asset_path" -C "$action_path"
  else
    echo "DebtLens: release runtime asset not found; falling back to source build."
  fi
fi

if [ ! -f dist/cli/index.js ]; then
  npm ci
  npm run build
elif [ ! -d node_modules ]; then
  npm ci --omit=dev
fi
