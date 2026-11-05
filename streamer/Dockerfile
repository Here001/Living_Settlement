# The 24/7 streamer: a browser on a virtual screen, filmed by ffmpeg and sent to every live destination.
# Build from the repo root:  docker build -t resurgence-streamer streamer
FROM mcr.microsoft.com/playwright:v1.63.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg xvfb fonts-noto-color-emoji fonts-noto-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY stream.mjs ./
ENV NODE_ENV=production
CMD ["node", "stream.mjs"]
