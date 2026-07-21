#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${PINCHTAB_TOKEN:-}" ]]; then
  xtrace_was_on=false
  if [[ $- == *x* ]]; then
    xtrace_was_on=true
    set +x
  fi

  config_candidates=()
  if [[ -n "${PINCHTAB_CONFIG:-}" ]]; then
    config_candidates+=("$PINCHTAB_CONFIG")
  fi
  config_candidates+=(
    "${XDG_CONFIG_HOME:-${HOME}/.config}/pinchtab/config.json"
    "${HOME}/.pinchtab/config.json"
  )

  for config_path in "${config_candidates[@]}"; do
    if [[ -r "$config_path" ]]; then
      PINCHTAB_TOKEN="$(jq -r '.server.token // empty' "$config_path")"
      if [[ -n "$PINCHTAB_TOKEN" ]]; then
        break
      fi
    fi
  done

  if [[ "$xtrace_was_on" == true ]]; then
    set -x
  fi
fi

: "${PINCHTAB_TOKEN:?Set PINCHTAB_TOKEN or configure server.token in the local PinchTab config.}"

server_url="${PINCHTAB_SERVER_URL:-http://127.0.0.1:9867}"
profile_name="${PINCHTAB_YMAX_PROFILE:-ymax-flow1}"
artifact_dir="${PINCHTAB_ARTIFACT_DIR:-artifacts}"
recording_format="${PINCHTAB_RECORDING_FORMAT:-mp4}"

case "$recording_format" in
  gif|mp4|webm)
    ;;
  webp)
    printf 'PinchTab does not support webp recordings. Use gif, mp4, or webm.\n' >&2
    exit 1
    ;;
  *)
    printf 'Unsupported PINCHTAB_RECORDING_FORMAT=%s. Use gif, mp4, or webm.\n' "$recording_format" >&2
    exit 1
    ;;
esac

api() {
  local xtrace_was_on=false
  if [[ $- == *x* ]]; then
    xtrace_was_on=true
    set +x
  fi
  set +e
  curl --fail --silent --show-error \
    -H "Authorization: Bearer ${PINCHTAB_TOKEN}" \
    -H 'Content-Type: application/json' \
    "$@"
  local status=$?
  set -e
  if [[ "$xtrace_was_on" == true ]]; then
    set -x
  fi
  return "$status"
}

api_status() {
  local output_file=$1
  shift
  local xtrace_was_on=false
  if [[ $- == *x* ]]; then
    xtrace_was_on=true
    set +x
  fi
  local status
  status="$(
    curl --silent --show-error \
      --output "$output_file" \
      --write-out '%{http_code}' \
      -H "Authorization: Bearer ${PINCHTAB_TOKEN}" \
      -H 'Content-Type: application/json' \
      "$@"
  )"
  if [[ "$xtrace_was_on" == true ]]; then
    set -x
  fi
  printf '%s\n' "$status"
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

start_response="$(mktemp "${TMPDIR:-/tmp}/pinchtab-smoke-start.XXXXXX")"
start_status="$(
  api_status "$start_response" -X POST "${server_url}/profiles/${profile_id}/start" \
    --data '{"headless":false,"securityPolicy":{"allowedDomains":["main0.ymax.app"]}}'
)"

case "$start_status" in
  200|201|202)
    instance="$(<"$start_response")"
    ;;
  409)
    instance="$(api "${server_url}/profiles/${profile_id}/instance")"
    ;;
  *)
    printf 'PinchTab profile start failed with HTTP %s:\n' "$start_status" >&2
    cat "$start_response" >&2
    exit 1
    ;;
esac

rm -f "$start_response"
instance_port="$(jq -r '.port' <<<"$instance")"
if [[ -z "$instance_port" || "$instance_port" == "null" ]]; then
  printf 'PinchTab did not return an instance port:\n%s\n' "$instance" >&2
  exit 1
fi
instance_url="http://127.0.0.1:${instance_port}"

api -X POST "${instance_url}/navigate" \
  --data '{"url":"https://main0.ymax.app"}' \
  | tee "${artifact_dir}/pinchtab-smoke-navigation.json"

api -X POST "${instance_url}/record/start" \
  --data '{"format":"gif","fps":5,"quality":70,"scale":1}' \
  >/dev/null

sleep 3

api "${instance_url}/snapshot?filter=interactive" \
  | tee "${artifact_dir}/pinchtab-smoke-snapshot.json"

recording="$(api -X POST "${instance_url}/record/stop" --data '{}')"
recording_path="$(jq -r '.path' <<<"$recording")"
recording_error="$(jq -r '.error // empty' <<<"$recording")"

if [[ -n "$recording_error" ]]; then
  printf 'PinchTab recording failed:\n%s\n' "$recording_error" >&2
  exit 1
fi

for _ in {1..30}; do
  recording_status="$(api "${instance_url}/record/status")"
  recording_error="$(jq -r '.error // empty' <<<"$recording_status")"
  recording_state="$(jq -r '.state // empty' <<<"$recording_status")"
  recording_path="$(jq -r '.outputPath // .path // empty' <<<"$recording_status")"

  if [[ -n "$recording_error" ]]; then
    printf 'PinchTab recording failed:\n%s\n' "$recording_error" >&2
    exit 1
  fi
  if [[ "$recording_state" == "finished" && -n "$recording_path" && -s "$recording_path" ]]; then
    if [[ "$recording_format" == "gif" ]]; then
      printf 'PinchTab saved the smoke recording at %s. No wallet action was attempted.\n' "$recording_path"
      exit 0
    fi

    if ! ffmpeg_bin="$(command -v ffmpeg)"; then
      printf 'ffmpeg is required to convert the PinchTab GIF recording to %s.\n' "$recording_format" >&2
      printf 'The intermediate GIF is at %s.\n' "$recording_path" >&2
      exit 1
    fi

    converted_path="${recording_path%.*}.${recording_format}"
    case "$recording_format" in
      mp4)
        "$ffmpeg_bin" -y -v error -i "$recording_path" \
          -movflags +faststart -pix_fmt yuv420p \
          -vf 'scale=trunc(iw/2)*2:trunc(ih/2)*2' \
          "$converted_path"
        ;;
      webm)
        "$ffmpeg_bin" -y -v error -i "$recording_path" \
          -c:v libvpx-vp9 -pix_fmt yuva420p \
          "$converted_path"
        ;;
    esac

    if [[ ! -s "$converted_path" ]]; then
      printf 'ffmpeg did not write the converted recording: %s\n' "$converted_path" >&2
      exit 1
    fi

    printf 'PinchTab saved the smoke recording at %s. No wallet action was attempted.\n' "$converted_path"
    printf 'Intermediate GIF retained at %s.\n' "$recording_path"
    exit 0
  fi
  sleep 1
done

printf 'PinchTab did not finish writing the smoke recording within 30 seconds. Last status:\n%s\n' "$recording_status" >&2
exit 1
