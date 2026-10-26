#!/bin/sh
# Deploys an image tag: pull, stop the app, back up /data, start the new version.
# Usage: ./release.sh <image tag>   (a commit SHA, or "latest")
set -eu
cd "$(dirname "$0")"

tag=${1:?usage: release.sh <image tag>}
export KERYX_KIT_TAG="$tag"
keep_backups=7

docker compose pull
docker compose stop app

stamp=$(date -u +%Y%m%dT%H%M%SZ)
if ! docker compose run --rm --no-deps --user root --entrypoint sh \
  -v "$PWD/backups:/backups" app -c "
    tar -czf /backups/data-$stamp.tar.gz -C /data . &&
    ls -1t /backups/data-*.tar.gz | tail -n +$((keep_backups + 1)) | xargs -r rm --"; then
  echo "backup failed; restarting the previous version" >&2
  docker compose start app
  exit 1
fi

echo "KERYX_KIT_TAG=$tag" > .env
docker compose up -d --remove-orphans
docker image prune --all --force --filter until=168h
