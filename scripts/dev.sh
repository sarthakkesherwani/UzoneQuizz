#!/bin/sh
# Starts a local MongoDB (if one isn't already listening) and the UzoneQuiz
# server. MongoDB data lives in .data/mongo inside the project.
set -e
cd "$(dirname "$0")/.."

PORT="${PORT:-5050}"
MONGO_PORT="${MONGO_PORT:-27017}"

if ! nc -z 127.0.0.1 "$MONGO_PORT" 2>/dev/null; then
  echo "No MongoDB on port $MONGO_PORT — starting a local one (.data/mongo)..."
  mkdir -p .data/mongo
  mongod --dbpath .data/mongo --port "$MONGO_PORT" --bind_ip 127.0.0.1 \
    --logpath .data/mongod.log >/dev/null 2>&1 &
  for i in $(seq 1 30); do
    nc -z 127.0.0.1 "$MONGO_PORT" 2>/dev/null && break
    sleep 0.5
  done
fi

exec node server/index.js
