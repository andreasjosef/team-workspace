# Deploying to Vultr

Everything runs on one VM: Caddy, Verdaccio and the egress proxy in Docker Compose; the hub as a systemd service on the host (it starts sandbox containers, so it doesn't live in one).

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

The hub works on its own git checkout of the product. For the demo, that's `demo/shop` as a fresh repo:

```sh
sudo -u hub cp -r /opt/team-workspace/demo/shop/. /var/lib/team-workspace/repo/
cd /var/lib/team-workspace/repo
sudo -u hub git init -q -b main && sudo -u hub git add . \
  && sudo -u hub git -c user.name=hub -c user.email=hub@localhost commit -qm "Demo shop"
sudo -u hub git tag demo-start      # reset between demo runs: git reset --hard demo-start
```

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
| `SANDBOX_RUNTIME`         | `runsc` if the setup script said gVisor works                               |
| `SANDBOX_PROXY_URL`       | `http://172.28.0.2:8080` (the default): no Docker DNS under `runsc`         |
| `DEPS_CACHE_DIR`          | `/var/lib/team-workspace/deps` (the default; the setup script creates it)   |
| `DOMAIN`                  | `<vm-ip>.sslip.io`: a real certificate with no DNS setup                    |
| `NODE_ENV`                | `production`                                                                |

**The model.** `deepseek-v4.1-flash-1017` is pinned: given the hub's real first prompt for INC-1042, it answered in the JSON edit format with a Vitest reproduction 5 times out of 5 (1.2–1.9 s each, 2026-11-25). Before switching models, list `/v1/models` and check the new one the same way; a 401 there means the key, not the model.

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
journalctl -u team-workspace-hub -f
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

Then run the three scenarios from [demo/README.md](../demo/README.md).

## Updating

```sh
cd /opt/team-workspace
sudo -u hub git pull
sudo -u hub -H corepack pnpm install --frozen-lockfile
sudo -u hub -H corepack pnpm --filter @app/web build   # Caddy serves the new dist at once
sudo systemctl restart team-workspace-hub              # forgets in-memory tasks
```

## Dependency cache

Each task with a `package-lock.json` reuses the `node_modules` installed for the same lockfile, from `DEPS_CACHE_DIR/<sha256 of the lockfile>`, mounted read-only into its sandboxes. The first task with a new lockfile installs in a sandbox with registry-only network, and only an install that passed the denied-log check and the install-script scanner is moved into the cache. A task whose lockfile changed gets a fresh install. To empty the cache (e.g. after a Verdaccio reset):

```sh
sudo systemctl stop team-workspace-hub
sudo rm -rf /var/lib/team-workspace/deps/*
sudo systemctl start team-workspace-hub
```
