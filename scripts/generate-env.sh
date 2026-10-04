#!/usr/bin/env sh
# Creates .env with freshly generated secrets.   Usage: ./scripts/generate-env.sh meet.example.com [public-ip]
set -eu

if [ -e .env ]; then
  echo ".env already exists. Not overwriting it: delete it first if you really want new secrets." >&2
  echo "(New secrets sign everyone out and invalidate every session.)" >&2
  exit 1
fi

domain="${1:?Usage: ./scripts/generate-env.sh meet.example.com [public-ip]}"
ip="${2:-REPLACE_WITH_PUBLIC_IP}"

# One line, with \n standing for each newline, so it fits in an .env file.
key="$(openssl genpkey -algorithm ed25519 | awk '{printf "%s\\n", $0}')"
secret="$(openssl rand -hex 32)"

umask 077 # only you can read the file
cat > .env <<ENV
SITE_ADDRESS=$domain
TURN_EXTERNAL_IP=$ip
JWT_PRIVATE_KEY="$key"
TURN_SECRET=$secret
ENV

echo "Wrote .env for $domain."
[ "$ip" = "REPLACE_WITH_PUBLIC_IP" ] && echo "Edit .env and set TURN_EXTERNAL_IP to this machine's public IP address."
echo "Keep .env private and back it up. Losing the key signs everyone out."
exit 0
