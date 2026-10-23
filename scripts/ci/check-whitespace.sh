#!/usr/bin/env bash
# Checks for trailing whitespace and conflict markers in the diff.
#
# On pull_request: compares against the PR base SHA.
# On push: compares against the before SHA (the previous commit on the branch).
# Fallback: compares HEAD^..HEAD (new branches, initial commits, workflow_dispatch).
set -euo pipefail

if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
  comparison_base="${PR_BASE_SHA:-}"
else
  comparison_base="${PUSH_BEFORE_SHA:-}"
fi

# Byte-pinned upstream snapshots (.gitattributes: whitespace=false) keep intentional
# whitespace from the publisher; exclude them from diff whitespace checks.
whitespace_exclude=(
  ':(exclude)tests/fixtures/ade-immobili-italia-2026/i18n-it.json'
)

if [[ "$comparison_base" =~ ^[0-9a-f]{40}$ ]] \
  && [[ "$comparison_base" != "0000000000000000000000000000000000000000" ]] \
  && git cat-file -e "${comparison_base}^{commit}"; then
  git diff --check "$comparison_base" HEAD -- . "${whitespace_exclude[@]}"
else
  git diff --check HEAD^ HEAD -- . "${whitespace_exclude[@]}"
fi
