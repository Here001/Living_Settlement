# Node 22 at the October 2026 security release or later (22.23.4+: TLS hostname-check and Brotli fixes, and the
# compromised eMudhra certificates no longer trusted). The build stops if the image is older, so an out-of-date
# cached image can never be deployed by mistake.
FROM node:22-alpine
# ffmpeg gets uploaded radio songs ready (evened-out loudness, a 128 kbps copy and a small data-saver copy)
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates ffmpeg && update-ca-certificates \
 && node -e "const [a,b,c]=process.versions.node.split('.').map(Number); if(a!==22||b<23||(b===23&&c<4)){ console.error('Node '+process.versions.node+' is too old: need 22.23.4 or later. Clear the build cache and deploy again.'); process.exit(1); }"
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
