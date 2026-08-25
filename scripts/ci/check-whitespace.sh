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

if [[ "$comparison_base" =~ ^[0-9a-f]{40}$ ]] \
  && [[ "$comparison_base" != "0000000000000000000000000000000000000000" ]] \
  && git cat-file -e "${comparison_base}^{commit}"; then
  git diff --check "$comparison_base" HEAD
else
  git diff --check HEAD^ HEAD
fi
