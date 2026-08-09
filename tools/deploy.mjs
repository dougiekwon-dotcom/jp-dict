// 빌드 → gh-pages 브랜치로 배포.  실행: npm run deploy
//
// GitHub Pages는 Actions로 굽는 방식과 브랜치를 그대로 서빙하는 방식이 있다.
// 여기서는 후자를 쓴다 — 워크플로 파일을 올리려면 OAuth 토큰에 `workflow`
// 스코프가 있어야 하는데 지금 환경에서 그걸 붙이지 못했다. 결과물과 URL은
// 완전히 같고, 차이는 push가 아니라 이 스크립트가 배포를 일으킨다는 것뿐이다.
//
// 나중에 workflow 스코프가 생기면 .github/workflows/deploy.yml 의 주석을 풀고
// .gitignore 에서 .github/ 를 빼면 자동 배포로 넘어간다.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const BRANCH = 'gh-pages'

const git = (args, cwd = ROOT) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

const step = (msg) => console.log('\n▸ ' + msg)

// ── 사전 점검 ─────────────────────────────────────────────────────────────
let remote
try {
  remote = git(['remote', 'get-url', 'origin'])
} catch {
  console.error('오류: origin 리모트가 없습니다. git remote add origin <url> 먼저 하세요.')
  process.exit(1)
}

// 배포한 것이 어느 커밋인지 남겨 두면 나중에 「폰에 뜬 게 어느 버전이지」를 알 수 있다.
const sha = git(['rev-parse', '--short', 'HEAD'])
const dirty = git(['status', '--porcelain']).length > 0

step('규칙 회귀 테스트')
execFileSync('npm', ['test'], { cwd: ROOT, stdio: 'inherit', shell: true })

step('빌드')
execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true })

// Pages는 기본적으로 Jekyll을 태우는데, 그러면 _ 로 시작하는 파일이 무시된다.
// 정적 빌드 결과를 그대로 내보내야 하므로 꺼 둔다.
fs.writeFileSync(path.join(DIST, '.nojekyll'), '')

step(`${BRANCH} 브랜치로 푸시`)
// dist 안에 임시 저장소를 만들어 밀어 넣는다. 본체 워킹트리를 건드리지 않아
// 배포 중에도 작업하던 상태가 그대로 남는다.
fs.rmSync(path.join(DIST, '.git'), { recursive: true, force: true })
git(['init', '-q'], DIST)
git(['checkout', '-q', '-b', BRANCH], DIST)
git(['add', '-A'], DIST)
git([
  '-c', 'user.name=Claude',
  '-c', 'user.email=noreply@anthropic.com',
  'commit', '-q', '-m', `deploy ${sha}${dirty ? ' (커밋 안 된 변경 포함)' : ''}`,
], DIST)
git(['push', '-q', '-f', remote, `${BRANCH}:${BRANCH}`], DIST)
fs.rmSync(path.join(DIST, '.git'), { recursive: true, force: true })

const slug = remote.replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '')
const [owner, repo] = slug.split('/')
console.log(`\n배포 완료 — ${sha}${dirty ? ' (커밋 안 된 변경 포함)' : ''}`)
console.log(`https://${owner}.github.io/${repo}/`)
if (dirty) console.log('\n※ 커밋하지 않은 변경이 배포됐습니다. 코드도 커밋해 두세요.')
