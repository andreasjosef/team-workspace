# Deploying to Vultr

Everything runs on one VM: Caddy, Verdaccio and the egress proxy in Docker Compose; the hub as a systemd service on the host (it starts sandbox containers, so it doesn't live in one).

**The quick way:** `bash deploy/vm-wizard.sh` from your laptop walks you through steps 1–5 below over SSH, runs the network checks, and probes the models you name. It doesn't create the demo repo on GitHub: do section 3's setup first, and the wizard asks for the repo and the token. It remembers its answers in `~/.local/state/team-workspace-vm/`, so it's safe to stop and re-run. The steps below are what it does.

## 1. Create the VM

- A dedicated SSH key for this VM, with a passphrase, in your ssh-agent: `ssh-keygen -t ed25519 -f ~/.ssh/team-workspace-vultr && ssh-add ~/.ssh/team-workspace-vultr`. Add its `.pub` under Vultr → Settings → SSH Keys.
- Vultr Cloud Compute, **Ubuntu 24.04**, 4 vCPU / 8 GB is comfortable (each sandbox gets 1 CPU / 1 GB; two tasks at once). Select only that SSH key. Note the public IP.
- gVisor (`runsc`) works on this plan: checked on 2026-11-25.

Vultr's Ubuntu image only has `root`. Log in once to make your own sudo user with the same key, then turn root logins off:

```sh
ssh -i ~/.ssh/team-workspace-vultr root@<vm-ip>
adduser --disabled-password --gecos "" <you> && usermod -aG sudo <you>
install -d -m 700 -o <you> -g <you> /home/<you>/.ssh
install -m 600 -o <you> -g <you> /root/.ssh/authorized_keys /home/<you>/.ssh/
echo '<you> ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-<you>
exit
ssh -i ~/.ssh/team-workspace-vultr <you>@<vm-ip>
echo 'PermitRootLogin no' | sudo tee /etc/ssh/sshd_config.d/00-no-root.conf && sudo systemctl reload ssh
```

## 2. Set it up (once)

The repo is private, so the VM gets its own read-only deploy key:

```sh
sudo ssh-keygen -t ed25519 -N '' -C 'team-workspace VM' -f /root/.ssh/team-workspace-deploy
sudo cat /root/.ssh/team-workspace-deploy.pub
# on your laptop: gh repo deploy-key add <that .pub> --repo andreasjosef/team-workspace --title "Vultr VM"
sudo GIT_SSH_COMMAND='ssh -i /root/.ssh/team-workspace-deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' \
  git clone git@github.com:andreasjosef/team-workspace.git /opt/team-workspace
sudo /opt/team-workspace/deploy/setup-vm.sh
```

Clone `main`, or the branch under test with `-b <branch>`. The script installs Docker, Node 24 and gVisor, creates the `hub` service user (in the `docker` group), opens only 22/80/443 in ufw, and tells you whether gVisor works on this VM type. `WITH_GVISOR=0` skips gVisor.

Then hand the deploy key to `hub`, which owns the checkout from step 4 on:

```sh
sudo install -d -m 700 -o hub -g hub /home/hub/.ssh
sudo install -m 600 -o hub -g hub /root/.ssh/team-workspace-deploy /home/hub/.ssh/deploy_key
```

## 3. The product repo

The product lives in its own GitHub repo, the **demo repo**: `demo/shop` with its tests, decisions and `.hub/` roles. The hub works on a clone of it (the **hub repo**, `HUB_REPO_DIR`). Before each task it fetches the demo repo's `main`, resets the clone to it and re-reads roles and decisions, so a pull request a developer merged shows up in the next task without a restart. A green task becomes a branch `task/<id>` pushed to the demo repo and a pull request on it. The hub never merges, and GitHub refuses to let its token do so.

### Demo repo setup (once, by hand, from your laptop)

Use a separate bot GitHub account as the token's owner if you can, with write access to the demo repo only: then "the hub can't merge" holds whoever set it up. A public repo is simplest: the fetch needs no token, and the judges can open the pull request.

1. **Create the repo from `demo/shop` and tag `demo-start`:**

   ```sh
   cp -r demo/shop /tmp/demo-shop && cd /tmp/demo-shop
   git init -q -b main && git add . && git commit -qm "Demo shop"
   git tag demo-start
   gh repo create <owner>/<name> --public --source . --push
   git push origin demo-start
   ```

2. **A ruleset on `main`** (Settings → Rules → Rulesets → New branch ruleset): target the default branch, enforcement Active, **bypass list empty**. Rules: Require a pull request before merging with 1 required approval, Block force pushes, Restrict deletions. Rulesets apply to admins too unless they're on the bypass list, so the empty list is what turns admin bypass off; that matters because a fine-grained token acts as its owner. The same from the command line:

   ```sh
   gh api -X POST repos/<owner>/<name>/rulesets --input - <<'EOF'
   {"name": "main: pull requests only", "target": "branch", "enforcement": "active",
    "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
    "bypass_actors": [],
    "rules": [{"type": "deletion"}, {"type": "non_fast_forward"},
      {"type": "pull_request", "parameters": {"required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": false, "require_code_owner_review": false,
        "require_last_push_approval": false, "required_review_thread_resolution": false}}]}
   EOF
   ```

   Optional, a second ruleset that keeps the token's owner to `task/*` branches: target all branches except `main` and `task/*`, rule Restrict creations, with the developers (not the token's owner) on its bypass list. The hub opens its pull requests as the token's owner, who can't approve their own, so a developer always does.

3. **The `from-support` label**, which the hub puts on every pull request it opens (report-id labels such as `INC-1042` are created on the fly):

   ```sh
   gh label create from-support --repo <owner>/<name> --color 0e8a16 --description "Opened by the hub from a support report"
   ```

4. **A fine-grained token** (GitHub → Settings → Developer settings → Fine-grained tokens), signed in as the token's owner. Repository access: only the demo repo. Permissions: Contents read and write, Pull requests read and write, Metadata read. Nothing else. Expiry: the day after the event. Save it in the team's password manager. Adding labels may also need Issues read and write: without it, the task log says "Labelling pull request #N failed: … 403" and the pull request stays open without labels. Add Issues if you want the labels; nothing else needs it.

5. **Clone the demo repo as the hub repo on the VM**, over https, with no credentials in the URL. The directory exists and is empty after `setup-vm.sh`:

   ```sh
   sudo -u hub git clone -q https://github.com/<owner>/<name>.git /var/lib/team-workspace/repo
   ```

   **Its `origin` and `GITHUB_REPO` must name the same repo.** The hub pushes `task/<id>` to the hub repo's `origin`, while `GITHUB_REPO` (in `.env`, section 4) only builds the API URLs that open the pull request; nothing checks that they match. A hub repo without an `origin` (made with `git init`) never fetches: every task starts from the same local `main`.

6. **Check that the token can't push to `main` or merge**, on your laptop in `/tmp/demo-shop`, once the hub has opened its first pull request (run INC-1042 after section 5 below). The token goes in through the same `GIT_ASKPASS` helper the hub uses, never on the command line:

   ```sh
   read -rs HUB_PUSH_TOKEN && export HUB_PUSH_TOKEN     # paste the token
   git commit -q --allow-empty -m "must be refused"
   GIT_ASKPASS=<team-workspace>/apps/hub/src/tasks/git-askpass.sh \
     git -c credential.helper= push origin HEAD:main     # expect: refused, repository rule violations
   git reset -q --hard origin/main
   GH_TOKEN=$HUB_PUSH_TOKEN gh api -X PUT repos/<owner>/<name>/pulls/<n>/merge   # expect: refused (405)
   unset HUB_PUSH_TOKEN
   ```

   Both must be refused. If either goes through, the ruleset has a bypass: fix it before the demo.

### A merged `main` the hub can't load

Roles, prompts and decisions come from the demo repo's `main`, and the role is re-read after each sync, so a merged change to `.hub/roles/` applies from the next task on, tasks already queued included. If a merged `main` doesn't load (a broken role file, say), the hub resets the clone back to the last `main` that did, runs the task from there and says so in the task log. A failed fetch (GitHub down) does the same: the task goes on from the last good `main`. Fix it with another pull request; the next task picks it up.

### Without GitHub

Leave `GITHUB_REPO` unset and the hub publishes a green task as a `task/<id>` branch in the hub repo itself, with a `file://` link instead of a pull request. A `git init` repo works for that (see the README's "Run the real pipeline locally").

## 4. Deploy the app

```sh
cd /opt/team-workspace
sudo chown -R hub:hub .
sudo -u hub git config core.sshCommand \
  'ssh -i /home/hub/.ssh/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new'
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
sudo -u hub -H --preserve-env=COREPACK_ENABLE_DOWNLOAD_PROMPT corepack pnpm install --frozen-lockfile
sudo -u hub -H --preserve-env=COREPACK_ENABLE_DOWNLOAD_PROMPT corepack pnpm --filter @app/web build
sudo docker build -t team-workspace-sandbox:latest packages/sandbox/image

sudo -u hub cp .env.example .env && sudo chmod 600 .env
sudo -u hub nano .env
```

In `.env`:

| Key                       | Value                                                                       |
| ------------------------- | --------------------------------------------------------------------------- |
| `RUNNER`                  | `real` (or `mock` as the fallback for the demo)                             |
| `HUB_REPO_DIR`            | `/var/lib/team-workspace/repo`                                              |
| `INCIDENTS_FILE`          | `/opt/team-workspace/demo/incidents.json`                                   |
| `VULTR_INFERENCE_API_KEY` | from the password manager; type it in the editor, never on the command line |
| `INFERENCE_MODEL`         | `deepseek-v4.1-flash-1017` (pinned; see below)                              |
| `GITHUB_REPO`             | `<owner>/<name>` of the demo repo: the same repo as the hub repo's `origin` |
| `GITHUB_TOKEN`            | the fine-grained token from section 3; type it in the editor too            |
| `SANDBOX_RUNTIME`         | `runsc` if the setup script said gVisor works                               |
| `SANDBOX_PROXY_URL`       | `http://172.28.0.2:8080` (the default): no Docker DNS under `runsc`         |
| `DEPS_CACHE_DIR`          | `/var/lib/team-workspace/deps` (the default; the setup script creates it)   |
| `DOMAIN`                  | `<vm-ip>.sslip.io`: a real certificate with no DNS setup                    |
| `NODE_ENV`                | `production`                                                                |

**The model.** `deepseek-v4.1-flash-1017` is pinned: given the hub's real first prompt for INC-1042, it answered in the JSON edit format with a Vitest reproduction 5 times out of 5 (1.2–1.9 s each, 2026-11-25). Before switching models, list `/v1/models` and check the new one the same way with `node deploy/probe-model.ts <model> 5` (it reads the key from stdin; usage at the top of the file). A 401 there means the key, not the model.

Then start everything:

```sh
sudo docker compose --env-file .env --profile vm up -d --build
sudo cp deploy/team-workspace-hub.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now team-workspace-hub
```

## 5. Check it

```sh
curl https://<vm-ip>.sslip.io/api/health
curl https://<vm-ip>.sslip.io/api/roles          # three roles, from the repo's .hub/
journalctl -u team-workspace-hub -f              # "Publishing pull requests to <owner>/<name>"
sudo docker compose logs -f egress-proxy         # refused requests show up here
```

The sandbox network rules, with a sandbox started like the hub starts one (drop `--runtime=runsc` if you run on `runc`):

```sh
P=http://172.28.0.2:8080
SB="sudo docker run --rm --runtime=runsc --network sandbox --read-only --tmpfs /tmp:rw,exec,size=512m -e HOME=/tmp/home"
PX="-e npm_config_registry=http://verdaccio:4873/ -e npm_config_proxy=$P -e HTTP_PROXY=$P -e HTTPS_PROXY=$P -e http_proxy=$P -e https_proxy=$P"
# Installs work, from Verdaccio through the proxy:
$SB $PX team-workspace-sandbox:latest sh -c 'cd /tmp && npm init -y >/dev/null && npm install is-number'
# DNS doesn't leave the sandbox network (expect a failure):
$SB team-workspace-sandbox:latest nslookup example.com
# Anything but Verdaccio is refused and lands in the denied log:
$SB $PX team-workspace-sandbox:latest wget -q -O /dev/null http://example.com/
curl -s http://127.0.0.1:8081/denied     # lists GET http://example.com/
# Code that ignores the proxy can't get out either (expect a failure):
$SB team-workspace-sandbox:latest wget -q -T 8 -O /dev/null http://1.1.1.1/
```

All four held on 2026-11-25 (Ubuntu 24.04, gVisor).

Then run the three scenarios from [demo/README.md](../demo/README.md). INC-1042 should end with a pull request on the demo repo; then run the two refusal checks from section 3, step 6.

## Between demo runs

`main` doesn't move during a demo (nobody merges), so a reset only removes what the tasks added. From your laptop, with the hub's token (or your own `gh` login):

```sh
read -rs GH_TOKEN && export GH_TOKEN                   # paste the token
deploy/reset-demo.sh <owner>/<name>                    # --dry-run lists what it would do
unset GH_TOKEN
```

It closes the open `from-support` pull requests and deletes the `task/*` branches on GitHub; no force push. Tasks live in the hub's memory, so restart the hub to clear them, and drop the `task/*` branches the hub left in its own clone:

```sh
ssh <you>@<vm-ip> 'cd /var/lib/team-workspace/repo && sudo -u hub git for-each-ref --format="%(refname:short)" refs/heads/task/ | xargs -r sudo -u hub git branch -D; sudo systemctl restart team-workspace-hub'
```

If someone did merge into `main`, don't force-push it back (the ruleset forbids it anyway): revert it with a pull request.

## Updating

```sh
ssh <you>@<vm-ip> sudo /opt/team-workspace/deploy/update.sh            # the branch it's on
ssh <you>@<vm-ip> sudo /opt/team-workspace/deploy/update.sh <branch>   # switch branch first
```

It pulls (`--ff-only`, as `hub`), runs `pnpm install --frozen-lockfile` and the web build, rebuilds the sandbox image only if `packages/sandbox/image/` changed since the last update, re-installs the systemd unit only if `deploy/team-workspace-hub.service` changed, runs `docker compose --env-file .env --profile vm up -d --build`, restarts the hub (which forgets in-memory tasks) and fails unless `/api/health` answers on `127.0.0.1:3000` within 30 s. It prints the old and new commit. The last updated commit is kept in `/var/lib/team-workspace/last-update`; delete it to force a full rebuild. Safe to run twice; it never touches `.env`, the hub repo or the deps cache.

There's no push-based deploy on purpose: that would put an SSH key with sudo on the VM into GitHub secrets.

By hand, the core of it is:

```sh
cd /opt/team-workspace
sudo -u hub git pull --ff-only
sudo -u hub -H corepack pnpm install --frozen-lockfile
sudo -u hub -H corepack pnpm --filter @app/web build
sudo docker build -t team-workspace-sandbox:latest packages/sandbox/image   # if it changed
sudo docker compose --env-file .env --profile vm up -d --build
sudo systemctl restart team-workspace-hub
```

## Dependency cache

Each task with a `package-lock.json` reuses the `node_modules` installed for the same lockfile, from `DEPS_CACHE_DIR/<sha256 of the lockfile>`, mounted read-only into its sandboxes. The first task with a new lockfile installs in a sandbox with registry-only network, and only an install that passed the denied-log check and the install-script scanner is moved into the cache. A task whose lockfile changed gets a fresh install. To empty the cache (e.g. after a Verdaccio reset):

```sh
sudo systemctl stop team-workspace-hub
sudo rm -rf /var/lib/team-workspace/deps/*
sudo systemctl start team-workspace-hub
```
