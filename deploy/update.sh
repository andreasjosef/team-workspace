#!/usr/bin/env bash
# Update the VM to the latest commit of its branch. Run as root on the VM:
#   sudo /opt/team-workspace/deploy/update.sh [branch]
# The optional branch switches the checkout first. Idempotent: a second run
# changes nothing and still ends with a healthy hub. Never touches .env, the
# demo repo or the deps cache.
set -euo pipefail

APP=/opt/team-workspace
# The commit of the last successful update. Outside the checkout, so a pull
# never touches it; with no record, everything is rebuilt.
STATE=/var/lib/team-workspace/last-update
SERVICE=team-workspace-hub
UNIT=/etc/systemd/system/$SERVICE.service
IMAGE=team-workspace-sandbox:latest
HEALTH=http://127.0.0.1:3000/api/health

as_hub() { sudo -u hub -H env COREPACK_ENABLE_DOWNLOAD_PROMPT=0 "$@"; }

# Everything runs from main, which bash has parsed in full before the pull
# below rewrites this file.
main() {
  [[ $EUID -eq 0 ]] || { echo "Run as root: sudo $0" >&2; exit 1; }
  cd "$APP"

  local old new last
  old=$(as_hub git rev-parse HEAD)

  if [[ $# -gt 0 ]]; then
    # Never let the argument read as an option, to git or anything after it.
    [[ $1 != -* ]] || { echo "Not a branch name: $1" >&2; exit 1; }
    as_hub git check-ref-format --branch "$1" >/dev/null
    as_hub git fetch origin
    as_hub git checkout "$1" -- # the trailing -- keeps $1 a branch, never a path
  fi
  as_hub git pull --ff-only
  new=$(as_hub git rev-parse HEAD)

  as_hub corepack pnpm install --frozen-lockfile
  as_hub corepack pnpm --filter @app/web build # Caddy serves the new dist at once

  # Diff against the last update; no record, or one git doesn't know, means rebuild.
  last=$(cat "$STATE" 2>/dev/null || true)
  if [[ -z $last ]] || ! as_hub git cat-file -e "$last^{commit}" 2>/dev/null \
    || ! as_hub git diff --quiet "$last" "$new" -- packages/sandbox/image \
    || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo "Rebuilding the sandbox image"
    docker build -t "$IMAGE" packages/sandbox/image
  else
    echo "Sandbox image unchanged"
  fi

  if ! cmp -s deploy/$SERVICE.service "$UNIT"; then
    echo "Installing the new service unit"
    cp deploy/$SERVICE.service "$UNIT"
    systemctl daemon-reload
  fi

  # Picks up egress proxy, Verdaccio or Caddy changes; a no-op otherwise.
  docker compose --env-file .env --profile vm up -d --build

  # Printed before the health wait, so a failed update still says what it ran.
  echo "Updating $old -> $new ($(as_hub git rev-parse --abbrev-ref HEAD))"
  systemctl restart "$SERVICE" # forgets in-memory tasks
  local i
  for i in $(seq 30); do
    if curl -fsS -o /dev/null "$HEALTH"; then break; fi
    if [[ $i -eq 30 ]]; then
      echo "The hub did not answer $HEALTH after 30 s. journalctl -u $SERVICE -n 50:" >&2
      journalctl -u "$SERVICE" -n 50 --no-pager >&2 || true
      exit 1
    fi
    sleep 1
  done

  echo "$new" >"$STATE.tmp" && mv "$STATE.tmp" "$STATE"
  echo "Updated $old -> $new. Hub is healthy."
}

main "$@"
# The pull may have rewritten this file; bash reads a script as it runs, so
# stop here rather than read whatever now sits past this point.
exit
