#!/usr/bin/env bash
set -euo pipefail

: "${PINCHTAB_TOKEN:?Set PINCHTAB_TOKEN to the local PinchTab bearer token.}"

server_url="${PINCHTAB_SERVER_URL:-http://127.0.0.1:9867}"
profile_name="${PINCHTAB_YMAX_PROFILE:-ymax-flow1}"
artifact_dir="${PINCHTAB_ARTIFACT_DIR:-artifacts}"

api() {
  curl --fail --silent --show-error \
    -H "Authorization: Bearer ${PINCHTAB_TOKEN}" \
    -H 'Content-Type: application/json' \
    "$@"
}

mkdir -p "$artifact_dir"

api "${server_url}/health" >/dev/null

profiles="$(api "${server_url}/profiles")"
profile_id="$(
  jq -r --arg name "$profile_name" '.[] | select(.name == $name) | .id' \
    <<<"$profiles" | head -n 1
)"

if [[ -z "$profile_id" ]]; then
  profile_id="$(
    api -X POST "${server_url}/profiles" \
      --data "$(jq -nc --arg name "$profile_name" '{name: $name, description: "Dedicated YMax Flow 1 recording profile", useWhen: "Use only for operator-supervised YMax recordings"}')" \
      | jq -r '.id'
  )"
fi

instance="$(
  api -X POST "${server_url}/profiles/${profile_id}/start" \
    --data '{"headless":false,"securityPolicy":{"allowedDomains":["main0.ymax.app"]}}'
)"
instance_port="$(jq -r '.port' <<<"$instance")"
instance_url="http://127.0.0.1:${instance_port}"

api -X POST "${instance_url}/navigate" \
  --data '{"url":"https://main0.ymax.app"}' \
  | tee "${artifact_dir}/pinchtab-smoke-navigation.json"

api -X POST "${instance_url}/record/start" \
  --data '{"format":"mp4","fps":12,"quality":70,"scale":1}' \
  >/dev/null

sleep 3

api "${instance_url}/snapshot?filter=interactive" \
  | tee "${artifact_dir}/pinchtab-smoke-snapshot.json"

recording="$(api -X POST "${instance_url}/record/stop" --data '{}')"
recording_path="$(jq -r '.path' <<<"$recording")"

printf 'PinchTab is encoding the smoke recording at %s. No wallet action was attempted.\n' "$recording_path"
