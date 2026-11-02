#!/bin/sh
docker ps -a --format '{{json .}}'
