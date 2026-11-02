#!/bin/sh
# Build and push the candidate image from the B agent workspace.
set -eu

build=${1:?build number is required}
export DOCKER_CONFIG=${DOCKER_CONFIG:-/srv/ces-test/docker-config}

image="ces-candidate:build-$build"
registry="43.128.69.189/ces/ces-candidate:build-$build"

docker build --network=host -t "$image" -f docker/Dockerfile .
docker tag "$image" "$registry"
docker push "$registry"

id=$(docker image inspect --format '{{.Id}}' "$image")
repo=$(docker image inspect --format '{{index .RepoDigests 0}}' "$registry")
digest=${repo#*@}
commit=$(git rev-parse HEAD)

printf '{"build":"%s","commit":"%s","image":"%s","registry":"%s","id":"%s","digest":"%s"}\n' \
  "$build" "$commit" "$image" "$registry" "$id" "$digest" > image.json
cat image.json
