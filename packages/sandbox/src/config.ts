// How sandboxes are started on this machine. Read once from the environment
// by the hub; tests build their own.
export type SandboxConfig = {
  // `docker` on the VM, `podman` works on a laptop.
  dockerBin: string;
  image: string;
  // `runsc` for gVisor, or undefined for the default runtime (runc).
  runtime?: string | undefined;
  // The internal network whose only way out is the egress proxy.
  network: string;
  registryUrl: string;
  proxyUrl: string;
  // Bind-mount options for /work. `rw,Z` on SELinux hosts (Fedora + podman).
  volumeOptions: string;
  // Escape hatch, e.g. `--userns=keep-id` for rootless podman.
  extraArgs: string[];
  // The uid:gid the sandbox runs as. The hub's own, so files it
  // writes in the workspace stay readable and removable by the hub.
  user: string;
};

export const sandboxConfigFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): SandboxConfig => ({
  dockerBin: env.SANDBOX_DOCKER_BIN || 'docker',
  image: env.SANDBOX_IMAGE || 'team-workspace-sandbox:latest',
  runtime: env.SANDBOX_RUNTIME || undefined,
  network: env.SANDBOX_NETWORK || 'sandbox',
  registryUrl: env.SANDBOX_REGISTRY_URL || 'http://verdaccio:4873/',
  proxyUrl: env.SANDBOX_PROXY_URL || 'http://172.28.0.2:8080',
  volumeOptions: env.SANDBOX_VOLUME_OPTS || 'rw',
  extraArgs: (env.SANDBOX_EXTRA_ARGS || '').split(/\s+/).filter(Boolean),
  user: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
});
