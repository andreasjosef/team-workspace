#!/bin/sh
# GIT_ASKPASS for the hub's push to GitHub (pushBranch in workspace.ts).
# git runs this with its prompt as $1 and reads the answer from stdout. The
# token comes from HUB_PUSH_TOKEN, which only that one git process gets: it's
# never written to git config, a remote URL or a workspace.
case "$1" in
  Username*) printf '%s\n' 'x-access-token' ;;
  *) printf '%s\n' "$HUB_PUSH_TOKEN" ;;
esac
