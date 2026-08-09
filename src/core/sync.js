// 기기 간 동기화 — 비공개 Gist를 저장소로 쓴다.
//
// 이 앱에는 서버가 없다. 기록(단어장·조회 로그·복습 상태)은 기기마다 IndexedDB에
// 따로 쌓이므로, 태블릿과 폰을 같이 쓰려면 중간에 둘 곳이 필요하다. 새 서비스를
// 띄우는 대신 이미 있는 GitHub 계정의 비공개 Gist를 파일 한 칸으로 쓴다.
//
// 흐름은 늘 같다:  받아서 → 로컬과 합치고 → 합친 것을 되돌려 올린다.
//   1. Gist에서 내려받기
//   2. store.importMerge 로 로컬에 병합 (조회 횟수는 큰 쪽, 별표는 하나라도 있으면
//      유지, 로그는 시각으로 중복 제거 — 이미 백업 가져오기에 쓰던 그 로직)
//   3. 병합된 로컬 전체를 다시 올리기
//
// 두 기기가 동시에 올리면 나중 것이 앞의 것을 덮을 수 있다. 그래도 데이터가
// 사라지지는 않는다 — 밀린 쪽 기기에 원본이 그대로 남아 있어서 다음 동기화 때
// 다시 올라가고 결국 양쪽이 같아진다.
//
// API 키는 동기화하지 않는다. 기록과 자격증명은 같이 두지 않는다.

import { exportAll, importMerge } from './store.js'
import { getSettings, saveSettings } from './settings.js'

const API = 'https://api.github.com'
const FILENAME = 'jp-dict-backup.json'
const DESCRIPTION = '요미(jp-dict) 단어장 동기화 — 지우지 마세요'

export function syncConfigured() {
  const s = getSettings()
  return !!(s.syncToken && s.gistId)
}

export function syncState() {
  const s = getSettings()
  return { hasToken: !!s.syncToken, gistId: s.gistId || '', lastSyncAt: s.lastSyncAt || 0, auto: s.autoSync !== false }
}

async function gh(path, { method = 'GET', body, token } = {}) {
  let res
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new SyncError('네트워크에 연결할 수 없습니다.', 'network')
  }

  if (res.status === 401) throw new SyncError('토큰이 올바르지 않습니다. 설정에서 다시 확인해 주세요.', 'auth')
  if (res.status === 403) throw new SyncError('토큰에 gist 권한이 없거나 요청이 너무 많습니다.', 'forbidden')
  if (res.status === 404) throw new SyncError('저장소(Gist)를 찾을 수 없습니다. 연동 코드를 다시 확인해 주세요.', 'not-found')
  if (!res.ok) throw new SyncError(`GitHub 요청이 거부되었습니다 (${res.status}).`, 'http', res.status)

  return res.json()
}

// ── 저장소 만들기 ─────────────────────────────────────────────────────────
// 첫 기기에서 한 번만. 돌려주는 Gist ID가 다른 기기에 입력할 「연동 코드」다.
export async function createSyncGist(token) {
  const payload = await exportAll()
  const gist = await gh('/gists', {
    method: 'POST',
    token,
    body: {
      description: DESCRIPTION,
      public: false,
      files: { [FILENAME]: { content: JSON.stringify(payload) } },
    },
  })
  saveSettings({ syncToken: token, gistId: gist.id, lastSyncAt: Date.now() })
  return gist.id
}

// ── 동기화 ────────────────────────────────────────────────────────────────
export async function syncNow() {
  const { syncToken: token, gistId } = getSettings()
  if (!token) throw new SyncError('설정에서 GitHub 토큰을 먼저 넣어 주세요.', 'no-token')
  if (!gistId) throw new SyncError('연동 코드가 없습니다. 첫 기기에서 만들거나 코드를 입력하세요.', 'no-gist')

  // 1. 내려받기
  const gist = await gh(`/gists/${gistId}`, { token })
  const file = gist.files?.[FILENAME] || Object.values(gist.files || {})[0]
  if (!file) throw new SyncError('저장소에 백업 파일이 없습니다.', 'empty')

  // Gist API는 큰 파일을 잘라서 준다. 그때는 raw_url로 통째로 받는다.
  let text = file.content
  if (file.truncated || text == null) {
    const raw = await fetch(file.raw_url)
    if (!raw.ok) throw new SyncError('백업 내용을 내려받지 못했습니다.', 'raw')
    text = await raw.text()
  }

  let remote
  try {
    remote = JSON.parse(text)
  } catch {
    throw new SyncError('저장소의 백업이 손상되었습니다.', 'parse')
  }

  // 2. 로컬에 병합
  const { added, merged } = await importMerge(remote)

  // 3. 병합된 전체를 되돌려 올리기
  const payload = await exportAll()
  await gh(`/gists/${gistId}`, {
    method: 'PATCH',
    token,
    body: { files: { [FILENAME]: { content: JSON.stringify(payload) } } },
  })

  const now = Date.now()
  saveSettings({ lastSyncAt: now })
  return { added, merged, entries: payload.data.entries.length, at: now }
}

// ── 자동 동기화 ───────────────────────────────────────────────────────────
// 앱을 켤 때와 덮을 때만 돈다. 조회할 때마다 올리면 요청이 너무 잦고,
// 어차피 다음에 켤 때 합쳐지므로 얻는 게 없다.
let armed = false

export function startAutoSync({ onDone } = {}) {
  if (armed) return
  armed = true

  const run = async (why) => {
    if (!syncConfigured() || !getSettings().autoSync) return
    try {
      const r = await syncNow()
      onDone?.(r, why)
    } catch {
      // 자동 동기화 실패는 조용히 넘긴다. 지하철에서 안 된다고 토스트가
      // 뜨면 성가시기만 하다. 설정 화면에서 수동으로 돌리면 이유가 보인다.
    }
  }

  run('start')
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') run('hide')
  })
}

export class SyncError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'SyncError'
    this.code = code
    this.status = status
  }
}
