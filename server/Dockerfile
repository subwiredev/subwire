# The self-hostable subwire server: hosts one or more subwires.
#
# Built from the REPO ROOT (the Bun workspace), not from server/:
#   docker build -f server/Dockerfile -t subwire-server .
#
# Subwires come from a JSON config file mounted at /app/server/subwire.config.json
# (override the path with SUBWIRE_CONFIG). With no file, defaults to a single
# "main" subwire.
#
# Required env: DATABASE_URL, PLATFORM_URL
# Recommended:  DATABASE_URL_DIRECT (if DATABASE_URL goes through a pooler),
#               PUBLIC_SUBWIRE_HOST (your public domain — your sw:// authority),
#               SERVER_ADMIN_TOKEN, SUBWIRE_PG_SCHEMA (defaults to "public")
#
# Migrations run automatically on boot (SUBWIRE_AUTO_MIGRATE=0 to disable).
FROM oven/bun:1-alpine AS build
WORKDIR /app
# Workspace manifests + lockfile first, for cached installs. The server
# depends on the local `protocol` workspace, so both manifests are needed.
COPY package.json bun.lock ./
COPY protocol/package.json protocol/package.json
COPY server/package.json server/package.json
RUN bun install --frozen-lockfile --production
# Source. protocol is consumed straight from src (its "bun" export), so no
# build step is required.
COPY protocol/ protocol/
COPY server/ server/

FROM oven/bun:1-alpine
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
WORKDIR /app
COPY --from=build /app /app
EXPOSE 4000
WORKDIR /app/server
CMD ["bun", "run", "src/index.ts"]
