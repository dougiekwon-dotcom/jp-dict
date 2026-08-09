// 내장 사전 로딩·색인·검색.
//
// words.json 은 용량 때문에 항목을 배열로 눕혀 두었다: [표기, 읽기, 뜻, 품사].
// 이 모듈 밖으로는 그 형태가 새어 나가지 않게 decode()로 감싼다.

// Vite가 빌드 때 값을 박아 넣는다. Node에서 테스트로 돌릴 때는 env가 없으므로
// 기본값으로 떨어진다 (그 경로에서는 fetch를 쓰지 않는다 — loadFromData 참조).
const BASE = typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : '/'

const K = 0, R = 1, G = 2, P = 3, D = 4   // D: 표제어로 쓸 수 있는 한자 표기 개수

let W = null            // words.json 의 w 배열
let KJ = null           // kanji.json 의 k 객체
let meta = null

let byExact = null      // 정규화된 표기/읽기 → 항목 인덱스 배열
let bySkeleton = null   // 장음 뺀 읽기 → 항목 인덱스 배열 (한글 발음 입력용)
let byKorean = null     // 한국 한자음 → 그 음을 가진 한자 배열
let sortedKeys = null   // 접두사 검색용 정렬 키 [key, idx][]
let loading = null

// ── 정규화 ────────────────────────────────────────────────────────────────
// 가타카나를 히라가나로 접어 색인한다. 책에서 본 그대로 「コーヒー」를 넣든
// 「こーひー」를 넣든 같은 항목에 닿아야 한다.
export function normalizeJa(s) {
  let out = ''
  for (const ch of String(s).trim()) {
    const c = ch.codePointAt(0)
    if (c >= 0x30a1 && c <= 0x30f6) out += String.fromCodePoint(c - 0x60)
    else out += ch
  }
  return out
}

// 장음을 걷어낸 「골격」. 한국 사람은 일본어를 적을 때 장음을 거의 쓰지 않는다 —
// とうきょう는 「도쿄」, おおさか는 「오사카」다. 그래서 입력을 늘려 장음을 끼워
// 맞추는 대신, 사전 쪽 읽기에서 장음을 걷어낸 색인을 하나 더 만들어 맞춘다.
// (경우의 수가 폭발하지 않고, 색인은 로딩 때 한 번만 만들면 된다.)
//
// 걷어내는 것: ー, お단 뒤의 う·お, う단 뒤의 う.
// 남기는 것:   え단 뒤의 い — 「케이자이(けいざい)」처럼 한국어 표기에도 살아있다.
const O_ROW = 'おこそとのほもよろごぞどぼぽょ'
const U_ROW = 'うくすつぬふむゆるぐずづぶぷゅ'

export function skeleton(kana) {
  const s = normalizeJa(kana)
  let out = ''
  for (const ch of s) {
    const prev = out[out.length - 1]
    if (ch === 'ー') continue
    if (ch === 'う' && prev && (O_ROW.includes(prev) || U_ROW.includes(prev))) continue
    if (ch === 'お' && prev && O_ROW.includes(prev)) continue
    out += ch
  }
  return out
}

export const isKana = (s) => /^[぀-ゟ゠-ヿー]+$/.test(s)
export const hasKanji = (s) => /[一-鿿㐀-䶿]/.test(s)
export const isHangul = (s) => /[가-힣]/.test(s)
export const isJapanese = (s) => hasKanji(s) || /[぀-ヿ]/.test(s)

// 문자열에서 한자만 뽑아낸다. 한자 분해와 통계의 한자 단위 집계에 쓴다.
export function kanjiChars(s) {
  return [...String(s)].filter((ch) => /[一-鿿㐀-䶿]/.test(ch))
}

// ── 로딩 ──────────────────────────────────────────────────────────────────
export function isLoaded() {
  return W != null
}

export function dictMeta() {
  return meta
}

// onProgress(받은바이트, 전체바이트|0) — 첫 로딩이 폰에서 몇 초 걸리므로
// 진행률을 밖으로 흘려보낸다.
export function ensureLoaded(onProgress) {
  if (W) return Promise.resolve()
  if (loading) return loading
  loading = load(onProgress).catch((err) => {
    loading = null   // 실패는 캐시하지 않는다. 다음 검색에서 재시도할 수 있어야 한다.
    throw err
  })
  return loading
}

async function load(onProgress) {
  const [words, kanji] = await Promise.all([
    fetchJson(BASE + 'data/words.json', onProgress),
    fetchJson(BASE + 'data/kanji.json'),
  ])
  loadFromData(words, kanji)
}

// 이미 읽어 둔 JSON으로 색인을 세운다. 브라우저 밖(테스트)에서 fetch 없이
// 같은 코드를 돌리기 위한 입구다.
export function loadFromData(words, kanji) {
  W = words.w
  KJ = kanji.k
  meta = { version: words.v, date: words.date, words: W.length, kanji: Object.keys(KJ).length }
  buildIndex()
}

async function fetchJson(url, onProgress) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`사전 파일을 불러오지 못했습니다 (${res.status} ${url.split('/').pop()})`)

  if (!onProgress || !res.body) return res.json()

  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const chunks = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    onProgress(got, total)
  }
  return JSON.parse(new TextDecoder().decode(concat(chunks, got)))
}

function concat(chunks, total) {
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

function buildIndex() {
  byExact = new Map()
  bySkeleton = new Map()
  byKorean = new Map()
  const keys = []

  const add = (key, i) => {
    const k = normalizeJa(key)
    if (!k) return
    const bucket = byExact.get(k)
    if (bucket) { if (!bucket.includes(i)) bucket.push(i) }
    else { byExact.set(k, [i]); keys.push([k, i]) }
  }

  const addSkel = (key, i) => {
    const s = skeleton(key)
    if (!s) return
    const bucket = bySkeleton.get(s)
    if (bucket) { if (!bucket.includes(i)) bucket.push(i) }
    else bySkeleton.set(s, [i])
  }

  for (let i = 0; i < W.length; i++) {
    const e = W[i]
    if (e[K]) for (const form of e[K].split('|')) add(form, i)
    for (const form of e[R].split('|')) { add(form, i); addSkel(form, i) }
  }

  // 한국 한자음 → 한자. 「경」을 치면 京·經·輕… 을 꺼내 조합해 볼 수 있게 한다.
  for (const [ch, v] of Object.entries(KJ)) {
    const kor = v[0]
    if (!kor) continue
    const bucket = byKorean.get(kor)
    if (bucket) bucket.push(ch)
    else byKorean.set(kor, [ch])
  }
  // 흔한 한자를 앞으로. KANJIDIC의 빈도 순위는 2501위까지만 매겨져 있어서
  // 순위 없는 글자는 뒤로 밀어 둔다.
  for (const list of byKorean.values()) {
    list.sort((a, b) => (KJ[a][7] || 9999) - (KJ[b][7] || 9999))
  }

  // 접두사 검색은 정렬 배열 위의 이분 탐색으로 처리한다. 트라이를 만들 만큼
  // 키가 많지 않고(약 4만), 메모리도 덜 먹는다.
  keys.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  sortedKeys = keys
}

// ── 항목 접근 ─────────────────────────────────────────────────────────────
export function decode(i) {
  const e = W[i]
  const kanji = e[K] ? e[K].split('|') : []
  const kana = e[R].split('|')
  // 희귀 표기(此れ)는 색인에는 있지만 표제어로는 쓰지 않는다. prep이 세어 둔
  // 「내세울 만한 한자 표기 개수」가 0이면 가나를 표제어로 쓴다.
  const display = e[D] | 0
  return {
    i,
    kanji,
    kana,
    glosses: e[G] ? e[G].split(';') : [],
    pos: e[P] ? e[P].split(',') : [],
    word: display > 0 ? kanji[0] : kana[0],
    reading: kana[0],
  }
}

export function kanjiInfo(ch) {
  const k = KJ?.[ch]
  if (!k) return null
  return {
    literal: ch,
    korean: k[0],                                  // 한국 한자음 (한글)
    on: k[1] ? k[1].split('|') : [],               // 음독
    kun: k[2] ? k[2].split('|') : [],              // 훈독
    meanings: k[3] ? k[3].split(';') : [],
    strokes: k[4],
    grade: k[5],
    jlpt: k[6],
    freq: k[7],
  }
}

// ── 검색 ──────────────────────────────────────────────────────────────────
// 완전일치를 먼저, 없거나 모자라면 접두사 일치로 채운다. 결과 순위는
// rankFn(외부에서 주입 — 내 조회 횟수)이 최우선이고, 그 다음이 사전 쪽 신호다.
//
// rankFn(entry) → 숫자(클수록 위). 조회 로그가 붙기 전(5단계 이전)에는 생략.
export function search(query, { limit = 40, rankFn = null } = {}) {
  if (!W) throw new Error('사전이 아직 로딩되지 않았습니다')
  const q = normalizeJa(query)
  if (!q) return []

  const seen = new Set()
  const results = []

  for (const i of byExact.get(q) || []) {
    seen.add(i)
    results.push({ entry: decode(i), exact: true })
  }

  if (results.length < limit) {
    for (const i of prefixMatches(q, limit * 4)) {
      if (seen.has(i)) continue
      seen.add(i)
      results.push({ entry: decode(i), exact: false })
    }
  }

  return sortResults(results, q, rankFn).slice(0, limit)
}

// 여러 후보 표기를 한 번에 조회한다. 한글 발음 입력이 만들어낸 가나 후보들을
// 사전과 교차시킬 때 쓴다 — 사전에 있는 후보만 살아남는 게 핵심이다.
// 완전일치로 먼저 훑고, 못 찾으면 장음 골격으로 한 번 더 훑는다.
export function searchAny(queries, { limit = 40, rankFn = null, useSkeleton = true } = {}) {
  if (!W) throw new Error('사전이 아직 로딩되지 않았습니다')
  const seen = new Set()
  const results = []

  // 후보가 들어온 순서에는 정보가 있다. 한글 표음 변환은 흔한 표기 관행을
  // 앞에 두고 후보를 만들기 때문에(「도」는 と 다음 ど), 그 순서를 동점 처리
  // 기준으로 살려 둔다. 이게 없으면 도쿄가 東京 대신 度胸이 된다.
  //
  // 순번은 **후보 문자열마다** 매긴다. 항목마다 매기면 같은 후보에 걸린 항목들
  // 사이에서도 순서가 갈려(きょと → 京都·挙党) 나머지 기준이 무시된다.
  const collect = (bucket, raw, exact, order) => {
    for (const i of bucket || []) {
      if (seen.has(i)) continue
      seen.add(i)
      results.push({ entry: decode(i), exact, via: raw, order })
    }
  }

  queries.forEach((raw, n) => collect(byExact.get(normalizeJa(raw)), raw, true, n))
  if (useSkeleton) {
    queries.forEach((raw, n) => collect(bySkeleton.get(skeleton(raw)), raw, false, n))
  }

  return sortResults(results, '', rankFn).slice(0, limit)
}

// 한국 한자음 한 글자를 가진 한자들. 흔한 것부터.
export function kanjiByKorean(syllable) {
  return byKorean?.get(syllable) || []
}

// 표기가 사전에 있는지만 빠르게 확인. 한자 조합을 대량으로 걸러낼 때 쓴다.
export function hasForm(form) {
  return byExact ? byExact.has(normalizeJa(form)) : false
}

// 이 한자가 들어간 낱말들. 한자 하나를 배울 때 실제로 필요한 건 그 글자가
// 어떤 말에 쓰이는지다 — 뜻풀이만으로는 손에 안 잡힌다.
// 색인을 따로 두지 않고 훑는다. 2만여 항목이라 몇 밀리초면 끝나고, 한자 카드를
// 열 때만 부르므로 색인을 유지하는 값이 아깝다.
export function wordsContaining(ch, limit = 8) {
  if (!W) return []
  const out = []
  for (let i = 0; i < W.length; i++) {
    const forms = W[i][K]
    if (!forms || !forms.includes(ch)) continue
    const e = decode(i)
    if (!e.word.includes(ch)) continue      // 희귀 표기에만 들어있는 경우는 뺀다
    out.push(e)
  }
  // 짧고 중심적인 낱말부터. 한자 하나를 배우는 데는 그쪽이 쓸모 있다.
  //
  // 한자 빈도 평균만으로 줄 세우면 엉뚱해진다 — 日経은 日이 워낙 흔한 글자라
  // 経済보다 앞서는데, 실제로 자주 쓰는 말은 반대다. JMdict는 중심적인 낱말에
  // 뜻을 더 여러 개 달아두므로 그걸 먼저 본다. 단어 빈도가 없는 상황에서
  // 쓸 수 있는 신호 중에는 이게 가장 낫다.
  out.sort((a, b) =>
    a.word.length - b.word.length ||
    b.glosses.length - a.glosses.length ||
    wordFreqScore(a.word) - wordFreqScore(b.word))
  return out.slice(0, limit)
}

function prefixMatches(prefix, cap) {
  const out = []
  let lo = 0, hi = sortedKeys.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sortedKeys[mid][0] < prefix) lo = mid + 1
    else hi = mid
  }
  for (let i = lo; i < sortedKeys.length && out.length < cap; i++) {
    if (!sortedKeys[i][0].startsWith(prefix)) break
    out.push(sortedKeys[i][1])
  }
  return out
}

// 단어가 얼마나 흔한지의 대용치. JMdict 상용어 세트에는 단어 단위 빈도가 없어서
// 구성 한자의 빈도 순위(KANJIDIC)를 평균 낸다. 낮을수록 흔하다.
// 한글 발음으로 찾으면 같은 소리의 한자어가 우르르 나오는데(전화 → 戦火·電化·電話),
// 이 값이 없으면 그중 무엇이 위로 갈지가 사실상 임의로 정해진다.
//
// 한계: 한자 빈도는 단어 빈도가 아니다. 「전화」는 電話가 압도적으로 흔하지만
// 化가 話보다 흔한 글자라 電化가 앞선다. 단어 단위 빈도 데이터가 없으면 이런
// 동음 한자어 몇 쌍은 순서를 맞출 수 없다. 대신 조회 로그가 붙으면(rankFn)
// 사용자가 한 번 고른 쪽이 영구히 위로 올라간다 — 그쪽이 어떤 휴리스틱보다 낫다.
const FREQ_UNRANKED = 4000     // KANJIDIC 빈도 순위는 2501위까지만 매겨져 있다
const FREQ_KANA_ONLY = 2500

function wordFreqScore(word) {
  let sum = 0, n = 0
  for (const ch of word) {
    const k = KJ[ch]
    if (!k) continue
    sum += k[7] || FREQ_UNRANKED
    n++
  }
  return n ? sum / n : FREQ_KANA_ONLY
}

function sortResults(results, q, rankFn) {
  for (const r of results) {
    r._mine = rankFn ? rankFn(r.entry) : 0
    r._len = r.entry.word.length
    r._read = r.entry.reading.length
    r._freq = wordFreqScore(r.entry.word)
  }
  return results.sort((a, b) => {
    if (a.exact !== b.exact) return a.exact ? -1 : 1        // 완전일치 우선
    if (a._mine !== b._mine) return b._mine - a._mine        // 내가 많이 찾은 것
    if (a._len !== b._len) return a._len - b._len            // 짧을수록 기본형일 확률
    // 후보 생성 순서. 한글 표음 변환이 흔한 표기 관행을 앞에 두므로(「도」는
    // と 다음 ど) 읽기 길이나 한자 빈도보다 믿을 만하다 — 도쿄가 東京이 되는 근거.
    if (a.order != null && b.order != null && a.order !== b.order) return a.order - b.order
    if (a._read !== b._read) return a._read - b._read        // 읽기도 짧은 쪽 (食べる < 食べ物)
    if (a._freq !== b._freq) return a._freq - b._freq        // 흔한 한자로 된 말
    return a.entry.i - b.entry.i
  })
}
