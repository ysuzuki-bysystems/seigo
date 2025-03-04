#!/bin/bash

while [[ "$#" -ne 0 ]]; do
  jq -nc '{"MESSAGE":$m}' --arg m "$(jq -nc '{"arg":$m}' --arg m "$1")"
  shift
done

jq -nc '{"MESSAGE":"{\"data\":\"loooooooong","CONTAINER_PARTIAL_MESSAGE":"true"}'
jq -nc '{"MESSAGE":"-message\"}"}'
