FROM node:22-alpine

# git and python3 let the refill job build ground-truth lists for the Git and
# Python categories. The game itself needs neither.
RUN apk add --no-cache git python3

WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts
COPY data/seed.json ./data/seed.json

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

# Mount a persistent volume at /data.
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "server.js"]
