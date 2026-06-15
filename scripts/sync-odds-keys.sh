#!/usr/bin/env bash
#
# 把本地 .env.local 里的 ODDS_API_KEY / ODDS_API_KEYS 同步到 GitHub Secrets。
# .env.local 是「真相源」(完整、明文、已 gitignore);GitHub Secret 只写不可读,
# 所以追加 key 时只改 .env.local,再跑本脚本整体覆盖回去,无需手动记旧值。
#
# 用法:
#   1) 编辑 .env.local,在 ODDS_API_KEYS= 后面追加逗号分隔的新 key
#   2) ./scripts/sync-odds-keys.sh        # 同步到 GitHub Secrets
#   3) 按提示触发部署
#
set -euo pipefail

REPO="tripplemay/worldcup2026"
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"

[ -f "$ENV_FILE" ] || { echo "找不到 $ENV_FILE"; exit 1; }
get() { grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

KEY="$(get ODDS_API_KEY || true)"
KEYS="$(get ODDS_API_KEYS || true)"

count() { [ -z "$1" ] && echo 0 || echo "$1" | tr ',' '\n' | grep -c .; }
total=$(( $(count "$KEY") + $(count "$KEYS") ))

if [ -n "$KEY" ]; then
  gh secret set ODDS_API_KEY  -R "$REPO" --body "$KEY"
  echo "✓ ODDS_API_KEY  已同步($(count "$KEY") 个)"
fi
if [ -n "$KEYS" ]; then
  gh secret set ODDS_API_KEYS -R "$REPO" --body "$KEYS"
  echo "✓ ODDS_API_KEYS 已同步($(count "$KEYS") 个)"
fi

echo "── 合计 $total 个 key = $(( total * 500 )) 次/月 ──"
echo "下一步部署:gh workflow run deploy.yml -R $REPO --ref main"
