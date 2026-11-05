#!/bin/sh
# Build and push the candidate image from the build agent workspace.
# CCR_REGISTRY is a repository prefix such as ccr.ccs.tencentyun.com/zstao/ces-platform.
# The agent must already have DOCKER_CONFIG logged in; credentials stay outside the repo.
set -eu

build=${1:?build number is required}
export DOCKER_CONFIG=${DOCKER_CONFIG:-/srv/ces-test/docker-config}

image="ces-candidate:build-$build"
registry="${CCR_REGISTRY:-ccr.ccs.tencentyun.com/zstao/ces-platform}:build-$build"

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
