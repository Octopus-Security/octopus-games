FROM node:22-alpine

RUN apk upgrade --no-cache

WORKDIR /app

# Build client
COPY client/package*.json ./client/
RUN cd client && npm install

COPY client/ ./client/
RUN cd client && npm run build

# Install server deps
# NPM_TOKEN is needed for @octopus-security/auth-client, which lives in
# GitHub Packages. The .npmrc is written and removed in ONE layer —
# leaving it behind bakes a registry credential into the image.
#
# npm install rather than npm ci: the lockfile predates this dependency
# and ci refuses to install anything the lock does not already contain.
ARG NPM_TOKEN
COPY package*.json ./
RUN if [ -n "$NPM_TOKEN" ]; then \
      printf '@octopus-security:registry=https://npm.pkg.github.com/\n//npm.pkg.github.com/:_authToken=%s\n' "$NPM_TOKEN" > .npmrc; \
    fi && \
    npm install --omit=dev --no-audit --no-fund && \
    rm -f .npmrc

COPY server/ ./server/

# Strip npm from the runtime image. Nothing here runs it — the CMD is a bare
# `node` — but Trivy reports what is PRESENT, not what is reachable, and npm
# bundles its own vulnerable tree: tar 7.5.11 (CVE-2026-59873, CRITICAL),
# pacote, sigstore, brace-expansion, picomatch, ip-address. Measured against
# node:22-alpine on 2026-09-21: 1 CRITICAL / 12 HIGH with npm, 0 / 2 without —
# 11 of those 13 findings were npm's, not Alpine's.
#
# Must run as root, so it goes above any USER line. octopus-cortex is the one
# service that keeps npm: its CVE checker shells out to `npm audit`.
# Guarded by octopus-vault/scripts/check-no-npm.mjs.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

EXPOSE 3013
CMD ["node", "server/index.js"]
