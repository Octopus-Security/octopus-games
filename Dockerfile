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

EXPOSE 3013
CMD ["node", "server/index.js"]
