import { h, clear, toast, ago } from '../ui/dom.js'
import { syncState, createSyncGist, syncNow } from '../core/sync.js'
import { ensureLoaded, isLoaded, dictMeta } from '../core/dict.js'
import { getSettings, saveSettings, PRESETS, MODEL_LABEL, modelFor, hasApiKey } from '../core/settings.js'
import { cacheSize, cacheClear, exportAll, importMerge, invalidateCounts } from '../core/store.js'
import {
  versionLabel, isDirty, isUpdateWaiting, onUpdateState, checkForUpdate, applyWaitingUpdate,
} from '../core/version.js'

export async function settings(view) {
  clear(view)
  view.append(
    h('h2', { class: 'screen-title' }, '설정'),
    apiCard(),
    bookCard(),
    syncCard(),
    backupCard(),
    dictCard(),
    versionCard(),
    aboutCard(),
  )
}

// ── 버전 ──────────────────────────────────────────────────────────────────
// PWA는 폰에 캐시되므로 「지금 이 폰에 떠 있는 게 어느 버전인가」가 애매해진다.
// 빌드 때 새겨 넣은 커밋을 그대로 보여주고, 갱신도 여기서 직접 하게 한다.
function versionCard() {
  const card = h('div', { class: 'card' }, h('h3', {}, '버전'))

  const label = h('p', { class: 'small', style: 'margin:0' }, versionLabel())
  const note = h('p', { class: 'small muted', style: 'margin:6px 0 0' })
  const button = h('button', { class: 'btn btn-sm', style: 'margin-top:10px' })

  const paint = () => {
    if (isUpdateWaiting()) {
      note.textContent = '새 버전이 준비되었습니다.'
      button.textContent = '지금 적용하고 새로고침'
      button.className = 'btn btn-sm btn-primary'
      button.onclick = () => applyWaitingUpdate()
      return
    }
    note.textContent = isDirty
      ? '커밋하지 않은 변경이 섞인 빌드입니다.'
      : '설치된 앱은 새 버전을 자동으로 받아 두었다가 다음 실행에 적용합니다.'
    button.textContent = '업데이트 확인'
    button.className = 'btn btn-sm'
    button.onclick = async () => {
      button.disabled = true
      button.textContent = '확인 중…'
      try {
        const state = await checkForUpdate()
        if (state === 'waiting') { paint(); toast('새 버전이 있습니다') }
        else if (state === 'installing') { note.textContent = '새 버전을 내려받는 중입니다.'; toast('내려받는 중…') }
        else if (state === 'no-sw') { note.textContent = '개발 서버에서는 확인할 수 없습니다.'; }
        else { note.textContent = '최신 버전입니다.'; toast('최신입니다') }
      } catch (err) {
        note.textContent = '확인하지 못했습니다: ' + (err?.message || err)
      } finally {
        if (!isUpdateWaiting()) { button.disabled = false; button.textContent = '업데이트 확인' }
      }
    }
  }

  paint()
  const off = onUpdateState(paint)
  // 화면을 떠나면 구독을 끊는다 (라우터가 화면 정리 함수를 부르지 않으므로
  // 카드가 DOM에서 사라지는 것을 관찰해 스스로 정리한다).
  new MutationObserver((_m, obs) => {
    if (!card.isConnected) { off(); obs.disconnect() }
  }).observe(document.getElementById('view'), { childList: true })

  card.append(label, note, button)
  return card
}

// ── API 키 ────────────────────────────────────────────────────────────────
function apiCard() {
  const s = getSettings()
  const card = h('div', { class: 'card' }, h('h3', {}, 'AI 조회'))

  const input = h('input', {
    type: 'password',
    class: 'block',
    placeholder: 'sk-ant-...',
    autocomplete: 'off',
    spellcheck: false,
    value: s.apiKey,
    style: 'font:inherit;padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink)',
  })

  const status = h('p', { class: 'small', style: 'margin:8px 0 0' })
  const paint = () => {
    status.textContent = hasApiKey() ? '키가 저장되어 있습니다.' : '키가 없으면 사전 검색만 됩니다.'
    status.className = 'small ' + (hasApiKey() ? '' : 'muted')
  }
  paint()

  // 작업마다 난이도가 달라 모델도 나눠 쓴다. 사용자에게는 손잡이 하나만 준다.
  const breakdown = h('p', { class: 'small muted', style: 'margin:8px 0 0' })
  const paintBreakdown = () => {
    breakdown.textContent =
      `뜻풀이 ${MODEL_LABEL[modelFor('gloss')]} · ` +
      `문장 ${MODEL_LABEL[modelFor('sentence')]} · ` +
      `손글씨 ${MODEL_LABEL[modelFor('handwriting')]}`
  }
  paintBreakdown()

  const presetSelect = h('select', {
    class: 'block',
    style: 'font:inherit;padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink)',
    onChange: (e) => {
      saveSettings({ preset: e.target.value, models: null })
      paintBreakdown()
      toast('바꿨습니다')
    },
  }, Object.entries(PRESETS).map(([id, p]) =>
    h('option', { value: id, selected: id === s.preset }, `${p.label} — ${p.note}`)))

  card.append(
    h('p', { class: 'small muted', style: 'margin:0 0 8px' },
      '한국어 뜻풀이·문장 해석·손글씨 인식에 씁니다. 사전 검색과 한자음 다리는 키 없이도 됩니다.'),
    input,
    h('div', { class: 'controls', style: 'display:flex;gap:8px;margin-top:8px' },
      h('button', {
        class: 'btn btn-primary btn-sm',
        onClick: () => { saveSettings({ apiKey: input.value.trim() }); paint(); toast('저장했습니다') },
      }, '저장'),
      h('button', {
        class: 'btn btn-ghost btn-sm',
        onClick: () => { input.type = input.type === 'password' ? 'text' : 'password' },
      }, '보기'),
    ),
    status,
    h('p', { class: 'small muted', style: 'margin:14px 0 6px' }, '품질'),
    presetSelect,
    breakdown,
    h('p', { class: 'small muted', style: 'margin:8px 0 0' },
      '뜻풀이는 읽는 법과 영어 뜻을 사전이 대주므로 작은 모델로 충분하고, ' +
      '손글씨 판독만 강한 모델이 값어치를 합니다. ' +
      '결과는 기기에 영구 저장되므로 같은 낱말은 한 번만 결제됩니다.'),
    h('p', { class: 'small muted', style: 'margin:10px 0 0' },
      '⚠️ 키는 이 기기 브라우저에만 저장되고 브라우저에서 직접 호출합니다. ' +
      '이 앱 전용 키를 새로 발급하고 콘솔에서 사용 한도를 걸어 두세요.'),
  )
  return card
}

// ── 읽는 책 ───────────────────────────────────────────────────────────────
function bookCard() {
  const s = getSettings()
  const input = h('input', {
    class: 'block',
    placeholder: '예: 코쿠고 문제집',
    value: s.book,
    style: 'font:inherit;padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink)',
    onChange: (e) => { saveSettings({ book: e.target.value.trim() }); toast('저장했습니다') },
  })
  return h('div', { class: 'card' },
    h('h3', {}, '지금 읽는 책'),
    h('p', { class: 'small muted', style: 'margin:0 0 8px' },
      '적어 두면 찾은 낱말에 자동으로 붙습니다. 나중에 책별로 모아 볼 수 있습니다.'),
    input,
  )
}

// ── 기기 연동 ─────────────────────────────────────────────────────────────
// 첫 기기에서 저장소를 만들면 「연동 코드」가 나오고, 다른 기기에 그 코드를 넣으면
// 이후로는 앱을 켤 때와 덮을 때 알아서 합쳐진다.
function syncCard() {
  const card = h('div', { class: 'card' }, h('h3', {}, '기기 연동'))
  const body = h('div')
  card.append(
    h('p', { class: 'small muted', style: 'margin:0 0 10px' },
      '태블릿과 폰의 단어장·조회 기록·복습 상태를 합칩니다. ' +
      'GitHub 비공개 Gist를 저장소로 씁니다. API 키는 올라가지 않습니다.'),
    body,
  )

  const input = (props) => h('input', {
    class: 'block',
    autocomplete: 'off',
    spellcheck: false,
    style: 'font:inherit;padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--ink)',
    ...props,
  })

  const paint = () => {
    clear(body)
    const st = syncState()

    if (!st.hasToken) {
      const tokenBox = input({ type: 'password', placeholder: 'ghp_... (gist 권한)' })
      body.append(
        tokenBox,
        h('div', { style: 'display:flex;gap:8px;margin-top:8px' },
          h('button', {
            class: 'btn btn-sm btn-primary',
            onClick: () => {
              const t = tokenBox.value.trim()
              if (!t) return toast('토큰을 넣어 주세요', 'bad')
              saveSettings({ syncToken: t })
              paint()
            },
          }, '토큰 저장'),
        ),
        h('p', { class: 'small muted', style: 'margin:10px 0 0' },
          'GitHub → Settings → Developer settings → Personal access tokens → ' +
          'Tokens (classic) → Generate new token → 권한은 gist 하나만 체크.'),
      )
      return
    }

    if (!st.gistId) {
      const codeBox = input({ placeholder: '다른 기기에서 받은 연동 코드' })
      body.append(
        h('p', { class: 'small', style: 'margin:0 0 8px' }, '이 기기가 처음이라면 저장소를 만드세요.'),
        h('button', {
          class: 'btn btn-sm btn-primary block',
          onClick: async (e) => {
            e.target.disabled = true
            e.target.textContent = '만드는 중…'
            try {
              await createSyncGist(getSettings().syncToken)
              toast('저장소를 만들었습니다')
              paint()
            } catch (err) {
              e.target.disabled = false
              e.target.textContent = '저장소 만들기'
              toast(err.message, 'bad')
            }
          },
        }, '저장소 만들기'),
        h('p', { class: 'small muted', style: 'margin:14px 0 6px' }, '이미 다른 기기에서 만들었다면'),
        codeBox,
        h('button', {
          class: 'btn btn-sm block',
          style: 'margin-top:8px',
          onClick: () => {
            const id = codeBox.value.trim()
            if (!id) return toast('연동 코드를 넣어 주세요', 'bad')
            saveSettings({ gistId: id })
            paint()
            void runSync()
          },
        }, '코드로 연결'),
      )
      return
    }

    // 연결 완료 상태
    const status = h('p', { class: 'small muted', style: 'margin:10px 0 0' },
      st.lastSyncAt ? `마지막 동기화 ${ago(st.lastSyncAt)}` : '아직 동기화한 적 없습니다.')

    const codeRow = h('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' },
      h('span', { class: 'small muted' }, '연동 코드'),
      h('code', { class: 'small', style: 'background:#eae5d8;padding:3px 8px;border-radius:6px;word-break:break-all' }, st.gistId),
      h('button', {
        class: 'btn btn-ghost btn-sm',
        onClick: async () => {
          try { await navigator.clipboard.writeText(st.gistId); toast('복사했습니다') }
          catch { toast('복사하지 못했습니다', 'bad') }
        },
      }, '복사'),
    )

    const syncBtn = h('button', { class: 'btn btn-sm btn-primary', onClick: () => runSync(syncBtn) }, '지금 동기화')

    body.append(
      codeRow,
      h('p', { class: 'small muted', style: 'margin:8px 0 0' },
        '다른 기기의 같은 화면에 이 코드를 넣으면 연결됩니다.'),
      h('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' },
        syncBtn,
        h('button', {
          class: 'btn btn-sm',
          onClick: () => {
            if (!confirm('이 기기의 연동을 끊을까요? 기록은 그대로 남습니다.')) return
            saveSettings({ syncToken: '', gistId: '' })
            paint()
          },
        }, '연동 끊기'),
      ),
      h('label', { class: 'small muted', style: 'display:flex;gap:6px;align-items:center;margin-top:10px' },
        h('input', {
          type: 'checkbox',
          checked: st.auto,
          onChange: (e) => saveSettings({ autoSync: e.target.checked }),
        }),
        '앱을 켤 때와 덮을 때 자동으로',
      ),
      status,
    )

    async function runSync(btn) {
      if (btn) { btn.disabled = true; btn.textContent = '동기화 중…' }
      try {
        const r = await syncNow()
        toast(`합쳤습니다 — 새로 ${r.added}개, 갱신 ${r.merged}개`)
        paint()
      } catch (err) {
        toast(err.message, 'bad')
        if (btn) { btn.disabled = false; btn.textContent = '지금 동기화' }
      }
    }
  }

  async function runSync() {
    try {
      const r = await syncNow()
      toast(`합쳤습니다 — 새로 ${r.added}개, 갱신 ${r.merged}개`)
      paint()
    } catch (err) {
      toast(err.message, 'bad')
    }
  }

  paint()
  return card
}

// ── 백업 ──────────────────────────────────────────────────────────────────
function backupCard() {
  const file = h('input', { type: 'file', accept: 'application/json', style: 'display:none' })
  file.addEventListener('change', async () => {
    const f = file.files?.[0]
    if (!f) return
    try {
      const { added, merged } = await importMerge(JSON.parse(await f.text()))
      invalidateCounts()
      toast(`새로 ${added}개, 합친 것 ${merged}개`)
    } catch (err) {
      toast(String(err.message || err), 'bad')
    }
    file.value = ''
  })

  return h('div', { class: 'card' },
    h('h3', {}, '백업'),
    h('p', { class: 'small muted', style: 'margin:0 0 10px' },
      '단어장·조회 기록·복습 상태를 파일로 내보내고 다시 합칠 수 있습니다.'),
    h('div', { style: 'display:flex;gap:8px' },
      h('button', {
        class: 'btn btn-sm',
        onClick: async () => {
          const blob = new Blob([JSON.stringify(await exportAll())], { type: 'application/json' })
          const a = h('a', {
            href: URL.createObjectURL(blob),
            download: `jp-dict-${new Date().toISOString().slice(0, 10)}.json`,
          })
          a.click()
          URL.revokeObjectURL(a.href)
        },
      }, '내보내기'),
      h('button', { class: 'btn btn-sm', onClick: () => file.click() }, '가져오기'),
      file,
    ),
  )
}

// ── 사전 데이터 ───────────────────────────────────────────────────────────
function dictCard() {
  const card = h('div', { class: 'card' }, h('h3', {}, '사전 데이터'))
  const line = h('p', { class: 'small muted', style: 'margin:0' }, '불러오는 중…')
  card.append(line)

  ;(async () => {
    try {
      if (!isLoaded()) await ensureLoaded()
      const m = dictMeta()
      line.textContent = `단어 ${m.words.toLocaleString()}항목 · 한자 ${m.kanji.toLocaleString()}자`
      card.append(h('p', { class: 'small muted', style: 'margin:4px 0 0' },
        `JMdict / KANJIDIC2 ${m.version} (${m.date})`))

      const n = await cacheSize()
      card.append(
        h('p', { class: 'small muted', style: 'margin:10px 0 6px' }, `AI 응답 캐시 ${n.toLocaleString()}건`),
        h('button', {
          class: 'btn btn-sm',
          onClick: async () => { await cacheClear(); toast('캐시를 비웠습니다') },
        }, '캐시 비우기'),
      )
    } catch (err) {
      line.textContent = String(err.message || err)
    }
  })()

  return card
}

function aboutCard() {
  return h('div', { class: 'card' },
    h('h3', {}, '정보'),
    h('p', { class: 'small muted', style: 'margin:0' },
      '사전 데이터는 JMdict · KANJIDIC2를 사용합니다. ' +
      'Electronic Dictionary Research and Development Group 저작, CC BY-SA 4.0.'),
    h('p', { class: 'small muted', style: 'margin:8px 0 0' },
      h('a', { href: 'https://www.edrdg.org/', target: '_blank', rel: 'noopener' }, 'edrdg.org')),
  )
}
