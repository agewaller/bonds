#!/usr/bin/env bash
# 08: Identity Platform の Authorized Domains に bonds-web のホスト名を追加する
# (cares 08 の移植。これで bonds-web から Google ログインが使えるようになる)。
# 使い方 (Cloud Shell):
#   bash infra/scripts/08-update-identity-platform-domains.sh
# 引数で URL を渡すことも可能:
#   bash infra/scripts/08-update-identity-platform-domains.sh https://bonds-web-xxx-an.a.run.app
source "$(dirname "$0")/_env.sh"

WEB_URL="${1:-}"
if [[ -z "${WEB_URL}" ]]; then
  WEB_URL=$(gcloud run services describe "${RUN_WEB}" --region="${REGION}" --project="${PROJECT}" --format='value(status.url)' 2>/dev/null)
fi
if [[ -z "${WEB_URL}" ]]; then
  echo "❌ web URL が取得できません (引数で渡すか、bonds-web をデプロイ後に実行)"
  exit 1
fi
HOST=$(echo "${WEB_URL}" | sed -E 's|^https?://||' | sed -E 's|/.*$||')
echo "=== Authorized Domains に ${HOST} を追加 (project: ${PROJECT}) ==="

TOKEN=$(gcloud auth print-access-token)
CONFIG=$(curl -sS -H "Authorization: Bearer ${TOKEN}" -H "X-Goog-User-Project: ${PROJECT}" \
  "https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/config")
CURRENT=$(echo "$CONFIG" | jq -r '.authorizedDomains[]?')
echo "→ 現在: $(echo "${CURRENT}" | tr '\n' ' ')"

if echo "${CURRENT}" | grep -qE "^${HOST}$"; then
  echo "→ 既に登録済、skip"
  exit 0
fi
NEW=$( { echo "${CURRENT}"; echo "${HOST}"; } | grep -vE '^$' | sort -u | jq -R . | jq -s .)
RESP=$(curl -sS -X PATCH \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "X-Goog-User-Project: ${PROJECT}" \
  -H "Content-Type: application/json" \
  "https://identitytoolkit.googleapis.com/v2/projects/${PROJECT}/config?updateMask=authorizedDomains" \
  -d "{\"authorizedDomains\": ${NEW}}")
if echo "$RESP" | jq -e '.authorizedDomains' >/dev/null 2>&1; then
  echo "✓ Authorized Domains 更新成功:"
  echo "$RESP" | jq -r '.authorizedDomains[]' | sed 's/^/  - /'
else
  echo "❌ 更新失敗: $RESP"
  exit 1
fi
