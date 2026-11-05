# The 24/7 streamer: a browser on a virtual screen, filmed by ffmpeg and sent to every live destination.
# Build from the repo root:  docker build -t resurgence-streamer streamer
# Node 24 at the October 2026 security release or later (24.22.1+); the build stops if the image is older.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends ca-certificates ffmpeg xvfb fonts-noto-color-emoji fonts-noto-core \
 && update-ca-certificates && rm -rf /var/lib/apt/lists/* \
 && node -e "const [a,b,c]=process.versions.node.split('.').map(Number); if(a!==24||b<22||(b===22&&c<1)){ console.error('Node '+process.versions.node+' is too old: need 24.22.1 or later.'); process.exit(1); }"
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npx playwright install --with-deps chromium && rm -rf /var/lib/apt/lists/*
COPY stream.mjs ./
ENV NODE_ENV=production
CMD ["node", "stream.mjs"]
