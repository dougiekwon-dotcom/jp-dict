// 찾기 화면. 입력 방식 3가지가 같은 결과 카드로 수렴한다.
//
// 돈이 나가는 지점을 한 곳으로 몰아 둔다: **AI는 타이핑 중에 절대 부르지 않는다.**
// 글자를 칠 때는 내장 사전만 훑고, Enter를 치거나 후보를 고르는 등 사용자가
// 「이거다」라고 정한 순간에만 호출한다. 안 그러면 한 낱말 치는 동안 대여섯 번
// 결제된다.

import { h, clear, toast, ago } from '../ui/dom.js'
import { entryCard, kanjiRow, hitList, kanjiCard, kanjiChoices } from '../ui/entryCard.js'
import {
  ensureLoaded, isLoaded, search as dictSearch, searchAny, dictMeta, isHangul, isJapanese,
} from '../core/dict.js'
import { hangulToKana, hangulToKanjiWords, romajiToKana } from '../core/hangul2kana.js'
import { guessReading } from '../core/hanja.js'
import { inkpad, PEN_WIDTHS } from '../ui/inkpad.js'
import { glossWord, readSentence, readHandwriting, AiError } from '../core/ai.js'
import {
  recordLookup, getEntry, entryId, lookupCounts, bumpLocalCount,
} from '../core/store.js'
import { getSettings, saveSettings, hasApiKey } from '../core/settings.js'

// 손글씨가 이 앱의 주된 입력이다 — 읽는 법을 모르는 한자는 애초에 칠 수가 없고,
// 그게 사전을 펼치는 이유의 대부분이다. 그래서 첫 화면이 캔버스다.
//
// 글자 입력은 방식을 나누지 않는다. 「경제」인지 「経済」인지 「korewa」인지는
// 글자만 봐도 알 수 있는데, 그걸 사용자에게 고르게 하는 건 일을 떠넘기는 것이다.
const MODES = [
  { id: 'hw', label: '✏️ 손글씨' },
  { id: 'text', label: '글자로' },
]

let mode = 'hw'
let lastQuery = ''

export async function search(view, params) {
  clear(view)
  const modeBar = h('div', { class: 'modes' })
  const body = h('div')
  view.append(modeBar, body)

  // 단어장·통계에서 낱말을 누르거나 손글씨 「직접 고치기」로 들어오는 경로
  if (params?.q) { mode = 'text'; lastQuery = params.q }

  const renderModes = () => {
    clear(modeBar)
    for (const m of MODES) {
      modeBar.append(h('button', {
        class: m.id === mode ? 'active' : '',
        onClick: () => { mode = m.id; renderModes(); renderBody() },
      }, m.label))
    }
  }

  let pad = null
  const renderBody = () => {
    pad?.destroy()
    pad = null
    clear(body)
    if (mode === 'hw') {
      const built = handwriting()
      pad = built.pad
      body.append(built.el)
      return
    }
    body.append(textInput())
  }

  renderModes()
  renderBody()

  return () => pad?.destroy()
}

// ── 손글씨 ────────────────────────────────────────────────────────────────
function handwriting() {
  const wrap = h('div')
  const results = h('div', { style: 'margin-top:12px' })

  const saved = getSettings()
  const pad = inkpad({
    penWidth: saved.penWidth || 5,
    onChange: (n) => { recognizeBtn.disabled = n === 0 },
  })

  const recognizeBtn = h('button', { class: 'btn btn-primary', disabled: true, onClick: () => run() }, '찾기')
  const undoBtn = h('button', { class: 'btn btn-sm', onClick: () => pad.undo() }, '되돌리기')
  const clearBtn = h('button', {
    class: 'btn btn-sm',
    onClick: () => { pad.clear(); clear(results) },
  }, '다시 쓰기')

  // 펜 / 지우개. 스타일러스는 뒤집거나 옆 버튼을 눌러도 지워지므로, 이 버튼은
  // 손가락으로 쓸 때와 명시적으로 지우개 모드를 유지하고 싶을 때를 위한 것이다.
  const penBtn = h('button', { class: 'btn btn-sm', onClick: () => setMode('pen') }, '✏️ 펜')
  const eraseBtn = h('button', { class: 'btn btn-sm', onClick: () => setMode('eraser') }, '🧽 지우개')
  const setMode = (m) => {
    pad.setMode(m)
    penBtn.className = 'btn btn-sm' + (m === 'pen' ? ' btn-primary' : '')
    eraseBtn.className = 'btn btn-sm' + (m === 'eraser' ? ' btn-primary' : '')
  }
  setMode('pen')

  // 펜 굵기
  const widthBtns = PEN_WIDTHS.map((w, i) => h('button', {
    class: 'btn btn-sm',
    title: `펜 굵기 ${w}`,
    onClick: () => setWidth(w),
  }, ['가늘게', '보통', '굵게'][i]))
  const setWidth = (w) => {
    pad.setPenWidth(w)
    saveSettings({ penWidth: w })
    widthBtns.forEach((b, i) => {
      b.className = 'btn btn-sm' + (PEN_WIDTHS[i] === w ? ' btn-primary' : '')
    })
  }
  setWidth(saved.penWidth || 5)

  wrap.append(
    !hasApiKey() ? h('div', { class: 'card', style: 'padding:12px' },
      h('p', { class: 'small', style: 'margin:0' }, '손글씨 판독에는 API 키가 필요합니다.'),
      h('a', { href: '#/settings', class: 'small' }, '설정에서 넣기 →'),
    ) : null,
    h('p', { class: 'hint', style: 'margin:0 0 8px' },
      '한 글자든 문장이든 이어서 쓰세요. 칸을 나누지 않아도 한 번에 읽습니다. ' +
      '한글로 써도 됩니다 — 발음(코레와)이든 뜻(고맙습니다)이든 일본어로 바꿔 줍니다.'),
    h('div', { style: 'display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;align-items:center' },
      penBtn, eraseBtn,
      h('span', { style: 'width:10px' }),
      ...widthBtns,
    ),
    pad.el,
    h('p', { class: 'hint', style: 'margin:6px 2px 0' },
      '스타일러스는 뒤집거나 옆 버튼을 누른 채 그으면 지우개로 씁니다.'),
    h('div', { style: 'display:flex;gap:8px;margin-top:10px;align-items:center' },
      recognizeBtn, undoBtn, clearBtn),
    results,
  )

  const run = async () => {
    if (!hasApiKey()) { toast('설정에서 API 키를 먼저 넣어 주세요', 'bad'); return }
    const png = pad.toPng()
    if (!png) return

    clear(results)
    results.append(h('div', { class: 'loading' }, '읽는 중…'))
    recognizeBtn.disabled = true

    try {
      const res = await readHandwriting(png)
      clear(results)
      results.append(recognizedCard(res, pad))
    } catch (err) {
      clear(results)
      results.append(h('div', { class: 'card' },
        h('p', { style: 'margin:0;color:var(--bad)' },
          err instanceof AiError ? err.message : String(err.message || err))))
    } finally {
      recognizeBtn.disabled = pad.strokeCount === 0
    }
  }

  return { el: wrap, pad }
}

// 인식 결과.
//
// 1순위는 바로 카드로 보여준다 — 맞으면 더 누를 게 없다. 후보는 그 아래 칩으로만
// 둔다. 네이버 사전처럼 고르기 전에 아무것도 안 보여주면 맞은 경우에도 한 번 더
// 눌러야 한다. 후보는 같은 호출에서 함께 받으므로 왕복이 늘지도 않는다.
function recognizedCard(res, pad) {
  const box = h('div')
  const best = res.japanese || res.recognized

  const escape = (shown) => h('div', { class: 'card' },
    h('div', { class: 'small muted', style: 'margin-bottom:8px' },
      `읽어낸 글자: ${res.recognized}` +
      (shown && shown !== res.recognized ? `  →  ${shown}` : '')),
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      h('button', { class: 'btn btn-sm', onClick: () => { pad.clear(); box.remove() } }, '다시 쓰기'),
      h('button', {
        class: 'btn btn-sm',
        // 잘못 읽었으면 고쳐 쓸 수 있게. 손으로 쓴 글자 쪽을 넣어 준다.
        onClick: () => { location.hash = '#/q/' + encodeURIComponent(res.recognized) },
      }, '직접 고치기'),
    ),
  )

  // 한자 한 글자 — 그 글자가 든 낱말까지 붙은 한자 카드로 보여주고,
  // 닮은 글자를 잘못 읽었을 경우를 대비해 후보를 아래에 깐다.
  if (isSingleKanji(best)) {
    const alts = (res.alternatives || []).filter(isSingleKanji)
    const paint = (ch) => {
      clear(box)
      const others = [best, ...alts].filter((c) => c !== ch)
      box.append(
        readAsChip(res.readAs),
        singleKanji(ch),
        others.length ? h('div', { class: 'card' }, kanjiChoices(others, paint)) : null,
        escape(ch),
      )
    }
    paint(best)
    return box
  }

  // 낱말이면 사전 항목으로 이어 붙인다 — 한자 분해와 한자음 다리를 얹기 위해서다.
  if (res.kind === 'word' && isLoaded()) {
    const hit = dictSearch(best, { limit: 1, rankFn })[0]
    if (hit) {
      box.append(readAsChip(res.readAs), wordCard(hit.entry, 'hw', false), escape(best))
      return box
    }
  }

  box.append(sentenceCard(res), escape(best))
  return box
}

// ── 입력창 ────────────────────────────────────────────────────────────────
function textInput() {
  const wrap = h('div')
  const input = h('input', {
    type: 'search',
    class: 'ja',
    placeholder: '경제 / 코레와 / 経済 / korewa',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: false,
    value: lastQuery,
  })
  const results = h('div', { style: 'margin-top:12px' })

  wrap.append(
    h('div', { class: 'searchbar' }, input),
    h('div', { class: 'hint' },
      '한글로 쳐도, 일본어로 쳐도, 로마자로 쳐도 알아서 찾습니다. 앞부분만 쳐도 됩니다.'),
    results,
  )

  let seq = 0
  // commit=true 는 사용자가 확정했다는 뜻 — 이때만 AI를 부른다.
  const run = async (commit) => {
    const q = input.value.trim()
    lastQuery = q
    const mine = ++seq
    clear(results)
    if (!q) return
    if (!(await load(results))) return
    if (mine !== seq) return

    // 한자 한 글자를 쳤다면 그 글자 자체를 알고 싶은 것이다. 낱말로 찾아
    // 던져주는 것보다 한자 카드가 맞다 (그 글자가 든 낱말도 거기 같이 나온다).
    if (isSingleKanji(q)) {
      results.append(singleKanji(q))
      return
    }

    // 글자를 보면 어느 경로인지 알 수 있다. 굳이 물어보지 않는다.
    const ja = isJapanese(q)
    render(results, ja ? lookupJapanese(q) : lookupKorean(q), q, ja ? 'ja' : 'ko', commit)
  }

  let timer = null
  input.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => run(false), 160)
  })
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    clearTimeout(timer)
    input.blur()          // 폰에서 키보드를 내려 결과를 넓게 본다
    run(true)
  })

  if (window.matchMedia('(min-width: 700px)').matches) setTimeout(() => input.focus(), 0)
  if (input.value) run(false)

  return wrap
}

async function load(host) {
  if (isLoaded()) return true
  const bar = h('div', { class: 'bar' }, h('i'))
  host.append(h('div', { class: 'loading' }, '사전 불러오는 중…', bar))
  try {
    await ensureLoaded((got, total) => {
      if (total) bar.firstChild.style.width = Math.round((got / total) * 100) + '%'
    })
  } catch (err) {
    clear(host)
    host.append(h('div', { class: 'card' }, String(err.message || err)))
    return false
  }
  clear(host)
  return true
}

// ── 조회 ──────────────────────────────────────────────────────────────────
// 내 조회 횟수를 순위에 먹인다. 처음 한 번만 IndexedDB에서 읽어 메모리에 둔다.
let counts = null
lookupCounts().then((m) => { counts = m }).catch(() => {})
const rankFn = (e) => (counts ? counts.get(entryId(e.word, e.reading)) || 0 : 0)

function lookupJapanese(q) {
  return { hits: dictSearch(q, { limit: 30, rankFn }), routes: [] }
}

function lookupKorean(q) {
  const routes = []
  const merged = []
  const seen = new Set()

  const take = (hits, label) => {
    let n = 0
    for (const hit of hits) {
      if (seen.has(hit.entry.i)) continue
      seen.add(hit.entry.i)
      merged.push(hit)
      n++
    }
    if (n) routes.push(`${label} ${n}건`)
  }

  if (isHangul(q)) {
    const kanjiWords = hangulToKanjiWords(q)
    if (kanjiWords.length) take(searchAny(kanjiWords, { limit: 20, rankFn }), '한자음')
    const kana = hangulToKana(q)
    if (kana.length) take(searchAny(kana, { limit: 20, rankFn }), '발음')
  } else {
    const kana = romajiToKana(q)
    if (kana) take(searchAny([kana], { limit: 20, rankFn }), '로마자')
  }

  return { hits: merged.slice(0, 30), routes }
}

// ── 한자 한 글자 ──────────────────────────────────────────────────────────
const isSingleKanji = (s) => [...String(s)].length === 1 && /[一-鿿㐀-䶿]/.test(s)

// 한자 카드. 낱말을 누르면 그 낱말 조회로 넘어간다.
function singleKanji(ch) {
  const card = kanjiCard(ch, {
    onWord: (e) => { location.hash = '#/q/' + encodeURIComponent(e.word) },
  })
  return card || h('div', { class: 'card' },
    h('p', { style: 'margin:0' }, '이 한자는 내장 사전에 없습니다.'))
}

// ── 결과 ──────────────────────────────────────────────────────────────────
function render(host, { hits, routes }, q, kind, commit) {
  clear(host)

  if (!hits.length) {
    host.append(missCard(host, q, kind, commit))
    return
  }

  const show = (entry, fireAi) => {
    clear(host)
    if (routes.length) {
      host.append(h('div', { class: 'chips', style: 'margin-bottom:10px' },
        routes.map((r) => h('span', { class: 'chip' }, r))))
    }
    host.append(wordCard(entry, kind, fireAi))
    const rest = hits.filter((r) => r.entry.i !== entry.i)
    if (rest.length) {
      host.append(h('div', { class: 'card' },
        h('div', { class: 'small muted', style: 'margin-bottom:4px' }, `다른 후보 ${rest.length}개`),
        // 후보를 고르는 것도 확정이다 — 그때는 AI를 부른다.
        hitList(rest, (e) => show(e, true)),
      ))
    }
  }

  show(hits[0].entry, commit)
}

// 낱말 카드. 사전에서 온 부분을 먼저 그리고, 확정된 조회면 AI 뜻을 덧대어 다시
// 그린다. AI가 느리거나 키가 없어도 위쪽 절반(표제어·읽기·한자 분해)은 남는다.
function wordCard(entry, mode, fireAi) {
  const host = h('div')

  const paint = (ai, saved, busy) => {
    clear(host)
    const footer = h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap' })

    if (saved?.lookupCount > 1) {
      footer.append(h('span', { class: 'badge-again' },
        `${saved.lookupCount}번째 조회 · 지난번 ${ago(saved.firstLookupAt === saved.lastLookupAt ? saved.lastLookupAt : prevLookupAt(saved))}`))
    }
    if (busy) footer.append(h('span', { class: 'small muted' }, '한국어 뜻 불러오는 중…'))
    else if (!ai) {
      footer.append(h('button', {
        class: 'btn btn-sm btn-primary',
        onClick: () => go(),
      }, '한국어 뜻 보기'))
    }
    if (ai?.cached) footer.append(h('span', { class: 'small muted' }, '저장된 결과'))

    host.append(entryCard(entry, {
      bridgeRow: kanjiRow(entry.word, entry.reading),
      korean: ai?.korean ?? saved?.meanings,
      nuance: ai?.nuance ?? saved?.nuance,
      examples: ai?.examples ?? saved?.examples,
      footer: footer.childNodes.length ? footer : null,
    }))
  }

  let saved = null
  const go = async () => {
    if (!hasApiKey()) { toast('설정에서 API 키를 먼저 넣어 주세요', 'bad'); return }
    paint(null, saved, true)
    try {
      const ai = await glossWord(entry)
      saved = await save(entry, ai, mode)
      paint(ai, saved, false)
    } catch (err) {
      paint(null, saved, false)
      toast(err instanceof AiError ? err.message : String(err.message || err), 'bad')
    }
  }

  // 저장돼 있던 뜻이 있으면 먼저 보여준다 (네트워크 0).
  getEntry(entry.word, entry.reading).then((row) => {
    saved = row
    paint(null, saved, false)
    if (fireAi && !row?.meanings?.length && hasApiKey()) go()
  })

  paint(null, null, false)
  return host
}

// 마지막 조회 직전 시각은 로그를 뒤져야 정확하지만, 배지에는 「지난번 언제」만
// 있으면 충분하므로 저장된 lastLookupAt을 쓴다.
const prevLookupAt = (saved) => saved.lastLookupAt

async function save(entry, ai, mode) {
  const { book } = getSettings()
  const row = await recordLookup({
    word: entry.word,
    reading: entry.reading,
    meanings: ai?.korean,
    nuance: ai?.nuance,
    examples: ai?.examples,
    kanji: [...entry.word].filter((c) => /[一-鿿]/.test(c)),
    pos: entry.pos,
    mode,
    book,
  })
  bumpLocalCount(row.id)
  return row
}

// ── 사전에 없을 때 ────────────────────────────────────────────────────────
function missCard(host, q, mode, commit) {
  const card = h('div', { class: 'card' })
  const sentence = looksLikeSentence(q)

  card.append(h('p', { style: 'margin:0' },
    sentence ? '문장은 AI가 해석합니다.' : '내장 사전에 없습니다.'))

  if (!sentence) {
    const guesses = guessReading(q, 3)
    if (guesses.length) {
      card.append(
        h('p', { class: 'small muted', style: 'margin:10px 0 0' }, '음독 조합 후보 (추정)'),
        h('p', { class: 'ja', style: 'margin:2px 0 0' }, guesses.join(' · ')),
      )
    }
  }

  const out = h('div', { style: 'margin-top:12px' })
  const ask = async () => {
    if (!hasApiKey()) { toast('설정에서 API 키를 먼저 넣어 주세요', 'bad'); return }
    clear(out)
    out.append(h('span', { class: 'small muted' }, '해석하는 중…'))
    try {
      const res = await readSentence(q, { fromHangul: isHangul(q) })
      clear(out)
      out.append(sentenceCard(res))
    } catch (err) {
      clear(out)
      out.append(h('span', { class: 'small', style: 'color:var(--bad)' },
        err instanceof AiError ? err.message : String(err.message || err)))
    }
  }

  card.append(h('button', { class: 'btn btn-sm btn-primary', style: 'margin-top:12px', onClick: ask },
    sentence ? 'AI로 해석하기' : 'AI로 찾기'), out)

  if (commit && hasApiKey()) ask()

  const wrap = h('div', {}, card)
  return wrap
}

// 3어절 이상이거나 문장부호가 있으면 문장으로 본다.
function looksLikeSentence(q) {
  if (/[。、？！?!]/.test(q)) return true
  if (/\s/.test(q.trim())) return true
  return [...q].length >= (isJapanese(q) ? 8 : 6)
}

// 한글을 넣었을 때 「발음을 옮긴 것」으로 봤는지 「뜻을 옮긴 것」으로 봤는지에
// 따라 결과가 완전히 달라진다. 그 판단을 감추면 왜 이런 답이 나왔는지 알 수 없다.
const READ_AS_LABEL = {
  'korean-sound': '한글 발음 → 일본어',
  'korean-meaning': '한국어 뜻 → 일본어',
}

function readAsChip(readAs) {
  const label = READ_AS_LABEL[readAs]
  return label ? h('div', { class: 'chips', style: 'margin-bottom:8px' }, h('span', { class: 'chip' }, label)) : null
}

function sentenceCard(res) {
  const card = h('div', { class: 'card' })
  card.append(
    readAsChip(res.readAs),
    h('div', { class: 'ja', style: 'font-size:1.25rem;font-weight:600' }, res.japanese),
    res.furigana && h('div', { class: 'ja small', style: 'color:var(--accent-ink);margin-top:2px' }, res.furigana),
    h('div', { style: 'margin-top:8px' }, res.korean),
  )
  if (res.words?.length) {
    card.append(h('hr', { class: 'sep' }), h('ul', { class: 'hits' }, res.words.map((w) =>
      h('li', {}, h('button', {
        onClick: () => { location.hash = '#/q/' + encodeURIComponent(w.word) },
      },
        h('span', { class: 'w ja' }, w.word),
        h('span', { class: 'r ja' }, w.reading),
        h('span', { class: 'g' }, w.meaning),
      )),
    )))
  }
  return card
}
