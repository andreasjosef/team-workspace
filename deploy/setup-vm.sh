#!/usr/bin/env bash
# One-time setup of a fresh Ubuntu 24.04 Vultr VM. Run as root on the VM.
# Idempotent: safe to run again. WITH_GVISOR=0 skips gVisor.
set -euo pipefail

apt-get update
apt-get install -y ca-certificates curl git gnupg ufw

# Docker Engine + compose plugin, from Docker's apt repo.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

# Node 24, from NodeSource's apt repo (key + list, no piped installer).
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin nodejs
corepack enable

# The orchestrator's own user. In the docker group, so it can start
# sandboxes: that is root-equivalent, which is why nothing else runs as it.
id hub >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin hub
usermod -aG docker hub
install -d -o hub -g hub /var/lib/team-workspace /var/lib/team-workspace/tasks /var/lib/team-workspace/deps /var/lib/team-workspace/repo

# Only SSH, HTTP and HTTPS from outside. Compose publishes everything else
# on 127.0.0.1, which Docker's iptables rules don't expose.
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

if [[ "${WITH_GVISOR:-1}" == 1 ]]; then
  curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor --yes -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
    > /etc/apt/sources.list.d/gvisor.list
  apt-get update
  apt-get install -y runsc
  runsc install
  systemctl restart docker
  if docker run --rm --runtime=runsc hello-world >/dev/null; then
    echo "gVisor works: set SANDBOX_RUNTIME=runsc in .env"
  else
    echo "gVisor did not start containers here: leave SANDBOX_RUNTIME empty"
  fi
fi

echo "Done. Next: docs/deploying.md, 'Deploy the app'."
