#!/usr/bin/env bash
# 从 package.json 读版本号 → 打标签 → 推送 → 创建 GitHub Release
#
#   scripts/release.sh              发布当前版本
#   scripts/release.sh --dry-run    只打印将要做什么
#
# 需要环境变量 GITHUB_API_KEY（repo 权限的 PAT）；缺了也能打标签推送，
# 只是不会创建 Release。
set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

# ── 版本号：只认 package.json ─────────────────────────────────
if command -v node >/dev/null 2>&1; then
  VERSION="$(node -p "require('./package.json').version")"
else
  VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
fi

if [ -z "${VERSION:-}" ]; then
  echo "读不到 package.json 的 version" >&2
  exit 1
fi

TAG="v$VERSION"
REMOTE_URL="$(git config --get remote.origin.url || true)"
case "$REMOTE_URL" in
  *github.com[:/]*) REPO="$(printf '%s' "$REMOTE_URL" | sed -E 's#.*github\.com[:/]([^/]+/[^/.]+)(\.git)?#\1#')" ;;
  *) echo "origin 不是 GitHub 地址：$REMOTE_URL" >&2; exit 1 ;;
esac

echo "版本   : $VERSION"
echo "标签   : $TAG"
echo "仓库   : $REPO"

# ── 前置检查 ────────────────────────────────────────────────
if [ -n "$(git status --porcelain)" ]; then
  echo "工作区有未提交的改动，先提交再发版：" >&2
  git status --short >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "标签 $TAG 已存在。要发新版本，请先改 package.json 的 version。" >&2
  exit 1
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "[dry-run] 会打标签 $TAG 并推送 main"
  exit 0
fi

# ── 标签 ────────────────────────────────────────────────────
git tag -a "$TAG" -m "$TAG"
echo "已创建标签 $TAG"

# ── 推送（网络抖动重试）────────────────────────────────────
PUSHED=0
for i in 1 2 3 4 5; do
  if OUT="$(git push origin HEAD "refs/tags/$TAG" 2>&1)"; then
    printf '%s\n' "$OUT" | tail -4
    PUSHED=1
    break
  fi
  printf '%s\n' "$OUT" | tail -4 >&2
  echo "推送失败，第 $i 次重试…" >&2
  sleep 8
done

if [ "$PUSHED" != "1" ]; then
  echo "推送连续失败，放弃（标签已创建在本地，可手动 git push origin $TAG）" >&2
  exit 1
fi

# ── Release ────────────────────────────────────────────────
if [ -z "${GITHUB_API_KEY:-}" ]; then
  echo "未设置 GITHUB_API_KEY，跳过 Release（标签已推送）" >&2
  exit 0
fi

NOTES="$(mktemp)"
PREV="$(git describe --tags --abbrev=0 "$TAG^" 2>/dev/null || true)"
{
  echo "## 变更"
  echo
  if [ -n "$PREV" ]; then
    git log --no-merges --pretty=format:'- %s' "$PREV..$TAG"
  else
    git log --no-merges --pretty=format:'- %s' "$TAG"
  fi
  echo
  echo
  echo "## 安装"
  echo
  echo '```bash'
  echo "dsh plugin --profile <profile> add github:$REPO"
  echo '```'
} > "$NOTES"

TAG="$TAG" REPO="$REPO" NOTES_FILE="$NOTES" node scripts/create-release.mjs
rm -f "$NOTES"
