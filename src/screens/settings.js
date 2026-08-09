import { h, clear, toast } from '../ui/dom.js'
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
