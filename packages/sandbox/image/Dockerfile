# The image every sandbox runs. Node, git and pnpm, nothing else: no
# credentials, no npmrc, no cache from earlier jobs.
FROM docker.io/library/node:24-alpine
RUN apk upgrade --no-cache && apk add --no-cache git \
  && npm install --global pnpm@12.16.1 \
  && npm cache clean --force
ENV npm_config_update_notifier=false
# Overridden at run time with --user (the orchestrator's uid), but never root.
USER node
WORKDIR /work
