# Deploying to Vultr

Everything runs on one VM: Caddy, Verdaccio and the egress proxy in Docker Compose; the hub as a systemd service on the host (it starts sandbox containers, so it doesn't live in one).

## 1. Create the VM

- Vultr Cloud Compute, **Ubuntu 24.04**, 4 vCPU / 8 GB is comfortable (each sandbox gets 1 CPU / 1 GB; two tasks at once).
- Add your SSH key. Note the public IP.

## 2. Set it up (once)

```sh
ssh <you>@<vm-ip>
sudo git clone https://github.com/<team>/team-workspace /opt/team-workspace
sudo /opt/team-workspace/deploy/setup-vm.sh
```

The script installs Docker, Node 24 and gVisor, creates the `hub` service user (in the `docker` group), opens only 22/80/443 in ufw, and tells you whether gVisor works on this VM type. `WITH_GVISOR=0` skips gVisor.

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
sudo -u hub corepack pnpm install --frozen-lockfile
sudo -u hub corepack pnpm --filter @app/web build
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
| `INFERENCE_MODEL`         | the model picked from `/v1/models`                                          |
| `SANDBOX_RUNTIME`         | `runsc` if the setup script said gVisor works                               |
| `DOMAIN`                  | `<vm-ip>.sslip.io`: a real certificate with no DNS setup                    |
| `NODE_ENV`                | `production`                                                                |

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
# DNS must not leave the sandbox network:
sudo docker run --rm --network sandbox team-workspace-sandbox:latest nslookup example.com   # expect NXDOMAIN
```

Then run the three scenarios from [demo/README.md](../demo/README.md).

## Updating

```sh
cd /opt/team-workspace
sudo -u hub git pull
sudo -u hub corepack pnpm install --frozen-lockfile
sudo -u hub corepack pnpm --filter @app/web build      # Caddy serves the new dist at once
sudo systemctl restart team-workspace-hub              # forgets in-memory tasks
```
