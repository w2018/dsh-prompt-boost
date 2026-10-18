/**
 * 创建 GitHub Release（供 scripts/release.sh 调用）
 * 需要环境变量：TAG / REPO / GITHUB_API_KEY / NOTES_FILE
 */
import { readFileSync } from 'node:fs'

const { TAG, REPO, GITHUB_API_KEY, NOTES_FILE } = process.env

if (!TAG || !REPO || !GITHUB_API_KEY || !NOTES_FILE) {
  console.error('缺少 TAG / REPO / GITHUB_API_KEY / NOTES_FILE')
  process.exit(1)
}

const body = readFileSync(NOTES_FILE, 'utf8')

const res = await fetch(`https://api.github.com/repos/${REPO}/releases`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${GITHUB_API_KEY}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'dsh-prompt-boost-release',
  },
  body: JSON.stringify({
    tag_name: TAG,
    name: TAG,
    body,
    draft: false,
    prerelease: TAG.includes('-'),
  }),
})

if (res.status === 201) {
  const data = await res.json()
  console.log(`Release 已创建：${data.html_url}`)
  process.exit(0)
}

if (res.status === 422) {
  console.log(`Release ${TAG} 已存在，跳过创建`)
  process.exit(0)
}

const detail = await res.text().catch(() => '')
console.error(`创建 Release 失败：HTTP ${res.status}\n${detail.slice(0, 400)}`)
process.exit(1)
