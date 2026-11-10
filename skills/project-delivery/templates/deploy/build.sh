#!/bin/sh
set -eu
: "${IMAGE_REPOSITORY:?set IMAGE_REPOSITORY to the project registry/repository}"
: "${DOCKER_CONFIG:?set DOCKER_CONFIG to the executor push credentials directory}"
build=${1:?build number required}
case "$build" in ''|*[!0-9]*) echo 'invalid build number' >&2; exit 2;; esac
case "$IMAGE_REPOSITORY" in *[!a-z0-9./:_-]*) echo 'invalid image repository' >&2; exit 2;; esac
commit=$(git rev-parse HEAD)
image="$IMAGE_REPOSITORY:harness-build-$build-$(git rev-parse --short=12 HEAD)"
# Buildx writes state even when Docker credentials are mounted read-only.
BUILDX_CONFIG=$(mktemp -d)
export BUILDX_CONFIG
trap 'rm -rf "$BUILDX_CONFIG"' EXIT HUP INT TERM
docker build -t "$image" .
docker push "$image"
id=$(docker image inspect --format '{{.Id}}' "$image")
repo=$(docker image inspect --format '{{index .RepoDigests 0}}' "$image")
digest=${repo##*@}
case "$digest" in sha256:*) ;; *) echo 'missing image digest' >&2; exit 1;; esac
printf '{"build":"%s","commit":"%s","image":"%s","registry":"%s","id":"%s","digest":"%s"}\n' \
  "$build" "$commit" "$image" "$image" "$id" "$digest" > image.json
