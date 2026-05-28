FROM node:22-alpine

RUN apk upgrade --no-cache

WORKDIR /app

# Build client
COPY client/package*.json ./client/
RUN cd client && npm install

COPY client/ ./client/
RUN cd client && npm run build

# Install server deps
COPY package*.json ./
RUN npm install --omit=dev

COPY server/ ./server/

EXPOSE 3013
CMD ["node", "server/index.js"]
