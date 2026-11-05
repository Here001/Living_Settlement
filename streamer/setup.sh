#!/usr/bin/env bash
# One-time setup of the 24/7 streamer on a fresh Ubuntu cloud server (2 vCPU / 4 GB is enough for one 720p layout;
# use 4 vCPU / 8 GB for 1080p or for landscape and portrait at once).
#
#   curl -fsSL https://raw.githubusercontent.com/Here001/Living_Settlement/main/streamer/setup.sh | sudo bash -s -- <STREAM_TOKEN> [GAME_URL]
#
# Run it again any time to update to the latest version. Logs: sudo docker logs -f streamer
set -euo pipefail
TOKEN="${1:-}"; GAME="${2:-https://playresurgence.com}"
[ -n "$TOKEN" ] || { echo "Usage: setup.sh <STREAM_TOKEN> [GAME_URL]   (STREAM_TOKEN is the same value you set on the game server)"; exit 1; }
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
command -v git >/dev/null || (apt-get update && apt-get install -y git)
REPO="${REPO:-https://github.com/Here001/Living_Settlement.git}"   # a private repo: REPO=https://<github-token>@github.com/Here001/Living_Settlement.git
DIR=/opt/resurgence
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone --depth 1 "$REPO" "$DIR"; fi
docker build -t resurgence-streamer "$DIR/streamer"
docker rm -f streamer >/dev/null 2>&1 || true
docker run -d --name streamer --restart=always --shm-size=1g --init \
  -e GAME_URL="$GAME" -e STREAM_TOKEN="$TOKEN" \
  resurgence-streamer
echo "The streamer is running. It checks in with $GAME every 30 seconds: open the Stream tab in the game to see it."
