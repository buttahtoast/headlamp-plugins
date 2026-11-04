#!/bin/sh
# PID 1 for an OIDC shell. The one-shot exec writes /work/.kube/request.env;
# this process exchanges the code or installs the ID token, then deletes that file.
# kubectl in later exec sessions reads /work/.kube/config. The service-account
# token is not mounted.
set -eu
umask 077
HOME=${HOME:-/work}
TMPDIR=${TMPDIR:-/tmp}
export HOME TMPDIR
mkdir -p "$HOME/.kube" "$TMPDIR"

die() {
  rm -f \
    "$HOME/.kube/f-code" \
    "$HOME/.kube/f-verifier" \
    "$HOME/.kube/f-redirect" \
    "$HOME/.kube/f-client" \
    "$HOME/.kube/f-refresh" \
    "$HOME/.kube/f-scope" \
    "$HOME/.kube/request.env" \
    "$HOME/.kube/request.env.tmp" 2>/dev/null || true
  (printf '%s\n' "$1" >/dev/termination-log) 2>/dev/null || true
  printf '%s\n' "$1" >&2
  exit 1
}

json_get() {
  printf '%s' "$1" | sed -n "s/.*\"$2\":\"\\([^\"]*\\)\".*/\\1/p" | head -n 1
}

curl_idp() {
  if [ -n "${ca:-}" ]; then
    curl -fsS --cacert "$ca" "$@"
  else
    curl -fsS "$@"
  fi
}

jwt_exp() {
  payload=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+')
  mod=$((${#payload} % 4))
  if [ "$mod" -eq 2 ]; then payload="${payload}=="; fi
  if [ "$mod" -eq 3 ]; then payload="${payload}="; fi
  json=$(printf '%s' "$payload" | base64 -d 2>/dev/null || true)
  printf '%s' "$json" | sed -n 's/.*"exp":\([0-9]*\).*/\1/p' | head -n 1
}

seconds_until_refresh() {
  exp=$(jwt_exp "$1")
  if [ -z "$exp" ]; then
    printf '%s' 240
    return 0
  fi
  now=$(date +%s)
  wait=$((exp - now - 60))
  if [ "$wait" -lt 30 ]; then wait=30; fi
  if [ "$wait" -gt 3600 ]; then wait=3600; fi
  printf '%s' "$wait"
}

assert_jwt() {
  case "$1" in
    '' | *[!A-Za-z0-9._-]*) die "The ID token was not a JWT." ;;
  esac
}

check_claims() {
  payload=$(printf '%s' "$ID_TOKEN" | cut -d. -f2 | tr '_-' '/+')
  mod=$((${#payload} % 4))
  if [ "$mod" -eq 2 ]; then payload="${payload}=="; fi
  if [ "$mod" -eq 3 ]; then payload="${payload}="; fi
  if [ "$mod" -eq 1 ]; then die "The ID token was not a JWT."; fi
  json=$(printf '%s' "$payload" | base64 -d 2>/dev/null || die "The ID token was not a JWT.")
  iss=$(json_get "$json" iss)
  iss_now=${iss%/}
  issuer_now=${ISSUER%/}
  if [ "$iss_now" != "$issuer_now" ]; then
    die "The ID token issuer did not match the plugin setting."
  fi
  nonce=$(json_get "$json" nonce)
  if [ -n "${NONCE:-}" ] && [ "$nonce" != "$NONCE" ]; then
    die "The ID token nonce did not match this sign-in."
  fi
  case "$json" in
    *"\"aud\":\"${CLIENT_ID}\""*) ;;
    *"\"aud\":[\"${CLIENT_ID}\""*) ;;
    *) die "The ID token audience did not match the client ID." ;;
  esac
}

exchange_code() {
  if [ -z "${CODE:-}" ] || [ -z "${VERIFIER:-}" ]; then
    die "The shell did not receive an authorization code."
  fi
  if ! command -v curl >/dev/null 2>&1; then
    die "This shell image has no curl, so it cannot exchange the OIDC code. Set a shell image that includes curl, or an issuer the browser can reach for token exchange."
  fi
  if [ -z "${TOKEN_ENDPOINT:-}" ]; then
    disc=$(curl_idp "${ISSUER%/}/.well-known/openid-configuration") || die "The shell could not read the OIDC discovery document."
    TOKEN_ENDPOINT=$(json_get "$disc" token_endpoint)
    if [ -z "$TOKEN_ENDPOINT" ]; then
      die "The OIDC discovery document had no token endpoint."
    fi
  fi
  printf '%s' "$CODE" >"$HOME/.kube/f-code"
  printf '%s' "$VERIFIER" >"$HOME/.kube/f-verifier"
  printf '%s' "$REDIRECT_URI" >"$HOME/.kube/f-redirect"
  printf '%s' "$CLIENT_ID" >"$HOME/.kube/f-client"
  resp=$(curl_idp -X POST "$TOKEN_ENDPOINT" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=authorization_code' \
    --data-urlencode "code@${HOME}/.kube/f-code" \
    --data-urlencode "redirect_uri@${HOME}/.kube/f-redirect" \
    --data-urlencode "client_id@${HOME}/.kube/f-client" \
    --data-urlencode "code_verifier@${HOME}/.kube/f-verifier") || die "The identity provider rejected the authorization code."
  rm -f "$HOME/.kube/f-code" "$HOME/.kube/f-verifier" "$HOME/.kube/f-redirect" "$HOME/.kube/f-client"
  ID_TOKEN=$(json_get "$resp" id_token)
  REFRESH_TOKEN=$(json_get "$resp" refresh_token)
  unset resp
}

write_kubeconfig() {
  ca_path=${BUTTAH_CLUSTER_CA:-/work/ca/ca.crt}
  if [ ! -s "$ca_path" ]; then
    die "The cluster CA was not mounted from kube-root-ca.crt."
  fi
  ns=${KUBE_NAMESPACE:-default}
  cat >"$HOME/.kube/config" <<EOF
apiVersion: v1
kind: Config
clusters:
- name: estate
  cluster:
    server: https://kubernetes.default.svc
    certificate-authority: ${ca_path}
users:
- name: oidc
  user:
    token: "${ID_TOKEN}"
contexts:
- name: oidc
  context:
    cluster: estate
    user: oidc
    namespace: ${ns}
current-context: oidc
EOF
  chmod 600 "$HOME/.kube/config"
}

save_refresh() {
  rm -f "$HOME/.kube/refresh-token" "$HOME/.kube/token-endpoint" "$HOME/.kube/client-id" "$HOME/.kube/scopes" "$HOME/.kube/refresh-after"
  if [ -z "${REFRESH_TOKEN:-}" ] || [ -z "${TOKEN_ENDPOINT:-}" ]; then
    return 0
  fi
  printf '%s' "$REFRESH_TOKEN" >"$HOME/.kube/refresh-token"
  printf '%s' "$TOKEN_ENDPOINT" >"$HOME/.kube/token-endpoint"
  printf '%s' "$CLIENT_ID" >"$HOME/.kube/client-id"
  printf '%s' "${SCOPES:-openid}" >"$HOME/.kube/scopes"
  printf '%s' "$(seconds_until_refresh "$ID_TOKEN")" >"$HOME/.kube/refresh-after"
  chmod 600 "$HOME/.kube/refresh-token" "$HOME/.kube/token-endpoint" "$HOME/.kube/client-id" "$HOME/.kube/scopes" "$HOME/.kube/refresh-after"
}

refresh_once() {
  [ -s "$HOME/.kube/refresh-token" ] || return 0
  command -v curl >/dev/null 2>&1 || return 0
  [ -s "$HOME/.kube/token-endpoint" ] || return 0
  printf '%s' "$(cat "$HOME/.kube/refresh-token")" >"$HOME/.kube/f-refresh"
  printf '%s' "$(cat "$HOME/.kube/client-id")" >"$HOME/.kube/f-client"
  printf '%s' "$(cat "$HOME/.kube/scopes")" >"$HOME/.kube/f-scope"
  endpoint=$(cat "$HOME/.kube/token-endpoint")
  resp=$(curl_idp -X POST "$endpoint" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode 'grant_type=refresh_token' \
    --data-urlencode "refresh_token@${HOME}/.kube/f-refresh" \
    --data-urlencode "client_id@${HOME}/.kube/f-client" \
    --data-urlencode "scope@${HOME}/.kube/f-scope") || {
    rm -f "$HOME/.kube/f-refresh" "$HOME/.kube/f-client" "$HOME/.kube/f-scope"
    return 0
  }
  rm -f "$HOME/.kube/f-refresh" "$HOME/.kube/f-client" "$HOME/.kube/f-scope"
  next=$(json_get "$resp" id_token)
  case "$next" in
    '' | *[!A-Za-z0-9._-]*) return 0 ;;
  esac
  next_refresh=$(json_get "$resp" refresh_token)
  if [ -n "$next_refresh" ]; then
    printf '%s' "$next_refresh" >"$HOME/.kube/refresh-token"
    chmod 600 "$HOME/.kube/refresh-token"
  fi
  ID_TOKEN=$next
  write_kubeconfig
  printf '%s' "$(seconds_until_refresh "$ID_TOKEN")" >"$HOME/.kube/refresh-after"
  chmod 600 "$HOME/.kube/refresh-after"
  unset ID_TOKEN
}

wait_for_request() {
  i=0
  while [ ! -s "$HOME/.kube/request.env" ]; do
    i=$((i + 1))
    if [ "$i" -gt 400 ]; then
      die "Timed out waiting for the OIDC sign-in."
    fi
    sleep 0.3
  done
}

main() {
  wait_for_request
  # shellcheck disable=SC1091
  . "$HOME/.kube/request.env"
  rm -f "$HOME/.kube/request.env"
  ca=""
  if [ -n "${IDP_CA_PEM:-}" ]; then
    printf '%s\n' "$IDP_CA_PEM" >"$HOME/.kube/idp-ca.pem"
    chmod 600 "$HOME/.kube/idp-ca.pem"
    ca="$HOME/.kube/idp-ca.pem"
  fi
  if [ -z "${ID_TOKEN:-}" ]; then
    exchange_code
  fi
  if [ -z "${ID_TOKEN:-}" ]; then
    die "The identity provider did not return an ID token."
  fi
  assert_jwt "$ID_TOKEN"
  check_claims
  write_kubeconfig
  save_refresh
  unset CODE VERIFIER ID_TOKEN REFRESH_TOKEN IDP_CA_PEM NONCE resp json payload iss nonce disc next next_refresh endpoint token scopes ca_path ns
  (: >/dev/termination-log) 2>/dev/null || true
  # Non-empty: the deliver exec waits on test -s, and touch would leave a zero-byte file.
  printf 'ok\n' >"$HOME/.kube/ready"
  if [ "${BUTTAH_BOOTSTRAP_ONCE:-}" = "1" ]; then
    set >"$HOME/.kube/env-names"
    exit 0
  fi
  while true; do
    delay=240
    if [ -s "$HOME/.kube/refresh-after" ]; then
      delay=$(cat "$HOME/.kube/refresh-after")
    fi
    case "$delay" in
      '' | *[!0-9]*) delay=240 ;;
    esac
    sleep "$delay" || true
    refresh_once || true
  done
}

if [ "${BUTTAH_BOOTSTRAP_SOURCE_ONLY:-}" != "1" ]; then
  main
fi
