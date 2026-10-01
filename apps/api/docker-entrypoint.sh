#!/bin/sh
set -e

# Apply pending migrations (never modify schemas by hand – see docs).
npx prisma migrate deploy

# Optional idempotent seed (roles, permissions, master data; dev users only if SEED_DEV_USERS=true).
if [ "$RUN_SEED" = "true" ]; then
  node dist/prisma/seed.js
fi

exec node dist/src/server.js
