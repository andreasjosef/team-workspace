#!/usr/bin/env bash
# Resets the GitHub demo repo between demo runs: closes the open pull requests
# labelled from-support and deletes every task/* branch. Never touches main
# (nobody merges during a demo, and the ruleset forbids a force push anyway).
# Run from your laptop:
#   deploy/reset-demo.sh <owner/name>          # or GITHUB_REPO=<owner/name>
#   deploy/reset-demo.sh <owner/name> --dry-run
# gh uses GH_TOKEN if set, else its own login. The hub's fine-grained token is
# enough (Pull requests: write to close, Contents: write to delete branches):
#   read -rs GH_TOKEN && export GH_TOKEN    # paste it from the password manager
# Tasks live in the hub's memory: restart the hub to clear them (see
# docs/deploying.md, "Between demo runs").
set -euo pipefail

repo=${GITHUB_REPO:-}
dry=0
for arg in "$@"; do
  case $arg in
    --dry-run) dry=1 ;;
    -*) echo "Unknown option: $arg" >&2; exit 2 ;;
    *) repo=$arg ;;
  esac
done
[[ $repo =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
  || { echo "Usage: $0 <owner/name> [--dry-run]" >&2; exit 2; }
command -v gh >/dev/null || { echo "Needs the GitHub CLI (gh)." >&2; exit 1; }

run() {
  if (( dry )); then echo "  would run: $*"; else "$@" >/dev/null; fi
}

echo "Open from-support pull requests in $repo:"
prs=$(gh api --paginate "repos/$repo/pulls?state=open&per_page=100" \
  --jq '.[] | select(any(.labels[]; .name == "from-support")) | "\(.number)\t\(.head.ref)"')
if [[ -z $prs ]]; then echo "  none"; fi
while IFS=$'\t' read -r number ref; do
  [[ -n $number ]] || continue
  echo "  closing #$number ($ref)"
  run gh api -X PATCH "repos/$repo/pulls/$number" -f state=closed
done <<<"$prs"

echo "task/* branches in $repo:"
branches=$(gh api --paginate "repos/$repo/git/matching-refs/heads/task/" --jq '.[].ref')
if [[ -z $branches ]]; then echo "  none"; fi
while read -r ref; do
  [[ $ref == refs/heads/task/* ]] || continue
  echo "  deleting ${ref#refs/heads/}"
  run gh api -X DELETE "repos/$repo/git/$ref"
done <<<"$branches"

echo "Done. Now restart the hub to clear its tasks (docs/deploying.md, \"Between demo runs\")."
