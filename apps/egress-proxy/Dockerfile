# No dependencies: Node runs the TypeScript source directly.
FROM docker.io/library/node:24-alpine
RUN apk upgrade --no-cache
WORKDIR /app
COPY package.json ./
COPY src ./src
USER node
EXPOSE 8080 8081
CMD ["node", "src/server.ts"]
