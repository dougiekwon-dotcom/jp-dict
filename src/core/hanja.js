// 한자음 다리 — 한국 한자음에서 일본 음독으로 건너가는 규칙.
//
// 일본인은 모르는 한자를 만나면 성부(声符)로 소리를 추측한다. 한국인은 한국
// 한자음을 이미 알고 있으니 추측 대신 규칙으로 변환할 수 있다. 한·일 음독은
// 같은 중국 중고음에서 갈라져 나왔고, 한국어 받침이 일본어 어미에 규칙적으로
// 대응하기 때문이다.
//
//   받침 없음  →  모음으로 끝     사(思) シ    · 도(道) ドウ
//   ㄱ         →  ク · キ         국(國) コク  · 석(石) セキ
//   ㄹ         →  ツ · チ         일(日) ニチ  · 발(發) ハツ
//   ㅂ         →  ウ (옛 フ)      십(十) ジュウ · 합(合) ゴウ
//   ㅁ · ㄴ    →  ン              심(心) シン  · 산(山) サン
//   ㅇ         →  ウ · イ         동(東) トウ  · 경(京) キョウ
//
// 전부 계산이다. 네트워크도 AI도 쓰지 않는다.

import { kanjiInfo, kanjiChars, normalizeJa } from './dict.js'

// 한글 종성 인덱스 → 우리가 구분하는 받침 종류. 한자음에 실제로 나타나는
// 종성은 ㄱ ㄴ ㄹ ㅁ ㅂ ㅇ 여섯 뿐이라 나머지는 다루지 않는다.
const JONG = {
  0: 'none', 1: 'k', 4: 'n', 8: 't', 16: 'm', 17: 'p', 21: 'ng',
}

const RULES = {
  none: { label: '받침 없음 → 모음', test: (on) => !/[クキツチン]$/.test(on) },
  k:    { label: 'ㄱ 받침 → ク·キ',  test: (on) => /[クキ]$/.test(on) },
  t:    { label: 'ㄹ 받침 → ツ·チ',  test: (on) => /[ツチ]$/.test(on) },
  p:    { label: 'ㅂ 받침 → ウ',     test: (on) => /ウ$/.test(on) },
  m:    { label: 'ㅁ 받침 → ン',     test: (on) => /ン$/.test(on) },
  n:    { label: 'ㄴ 받침 → ン',     test: (on) => /ン$/.test(on) },
  ng:   { label: 'ㅇ 받침 → ウ·イ',  test: (on) => /[ウイ]$/.test(on) },
}

// 한글 음절 하나의 받침 종류. 한글이 아니면 null.
export function finalOf(syllable) {
  const c = String(syllable).codePointAt(0)
  if (!(c >= 0xac00 && c <= 0xd7a3)) return null
  return JONG[(c - 0xac00) % 28] ?? 'other'
}

// 한자 한 글자: 한국 한자음과 음독 목록을 대조해 어떤 규칙이 걸리는지 찾는다.
// 규칙에 맞는 음독을 우선해서 돌려준다 — 여러 음독 중 한국음과 짝이 맞는 것이
// 그 한자어에서 실제로 쓰일 확률이 높다.
export function bridgeChar(ch) {
  const info = kanjiInfo(ch)
  if (!info) return null

  const base = { ch, korean: info.korean, on: info.on, matchedOn: info.on[0] || '', rule: null }
  if (!info.korean || !info.on.length) return base

  const kind = finalOf(info.korean)
  const rule = kind && RULES[kind]
  if (!rule) return base

  const hit = info.on.find((on) => rule.test(on))
  if (!hit) return base                       // 규칙 밖 예외 — 조용히 규칙 표시를 뺀다

  return { ...base, matchedOn: hit, rule: rule.label }
}

// ── 음독 조합 생성 ────────────────────────────────────────────────────────
// 음독을 그냥 이어 붙인 소리와 실제 읽기는 자주 어긋난다. 経済는 ケイ+サイ라
// 「けいさい」가 나와야 할 것 같지만 실제로는 「けいざい」다. 어긋남 자체가
// 규칙(연탁·촉음)이므로 감추지 말고 이름을 붙여 보여준다.
//
// 그래서 "음독을 이어 붙인 한 가지"가 아니라 연탁·촉음까지 적용한 **후보 집합**을
// 만들어 실제 읽기가 그 안에 있는지 본다. 이 대조가 느슨하면 훈독으로 읽는 말
// (山 = やま)에까지 한자음 다리가 붙어 사람을 헷갈리게 만든다.

const RENDAKU = {
  か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご',
  さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ',
  た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど',
  は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ',
}
const HANDAKU = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' }

const MAX_ON_PER_CHAR = 3
const MAX_CANDIDATES = 600

// 한 자리에 올 수 있는 소리들. [소리, 메모, 비용] — 비용이 낮을수록 그럴듯하다.
//
// 「つ·ち·く·き로 끝나는 앞말 + は행으로 시작하는 뒷말」은 거의 예외 없이
// 「っ + ぱ행」이 된다 (発表 はっぴょう, 出発 しゅっぱつ, 十分 じゅっぷん).
// 사실상 의무 규칙이라 변형된 쪽을 기본으로 두고 안 변한 쪽에 벌점을 준다.
// 나머지 연탁·촉음은 수의적이라 작은 벌점만 매긴다.
function variantsAt(onHira, nextHead, { first, last }) {
  const canGeminate = !last && /[つちくき]$/.test(onHira)
  const mustGeminate = canGeminate && nextHead && HANDAKU[nextHead]

  const out = [[onHira, null, mustGeminate ? 4 : 0]]

  if (!first) {
    const head = onHira[0]
    const rest = onHira.slice(1)
    if (RENDAKU[head]) out.push([RENDAKU[head] + rest, '연탁 (뒷말 첫소리가 탁음으로)', 2])
    if (HANDAKU[head]) out.push([HANDAKU[head] + rest, '반탁음화 (뒷말 첫소리가 ぱ행으로)', 0])
  }

  if (canGeminate) {
    out.push([onHira.slice(0, -1) + 'っ', '촉음화 (앞말 끝소리가 っ로)', mustGeminate ? 0 : 1])
  }

  return out
}

// 한자열의 음독 조합 후보. Map<읽기, {notes, cost}>. 비용 오름차순으로 들어간다.
export function onReadingCandidates(chars) {
  const perChar = chars.map((ch) => {
    const info = kanjiInfo(ch)
    return (info?.on || []).slice(0, MAX_ON_PER_CHAR).map((on) => normalizeJa(on))
  })
  if (perChar.some((list) => !list.length)) return new Map()

  let acc = [{ sound: '', notes: [], cost: 0 }]
  for (let i = 0; i < perChar.length; i++) {
    const pos = { first: i === 0, last: i === perChar.length - 1 }
    const nextHead = perChar[i + 1]?.[0]?.[0] || null
    const next = []
    for (const cur of acc) {
      for (let oi = 0; oi < perChar[i].length; oi++) {
        // KANJIDIC의 음독 순서는 대체로 흔한 것이 앞이다. 뒤로 갈수록 벌점.
        const onCost = oi * 2
        for (const [sound, note, vCost] of variantsAt(perChar[i][oi], nextHead, pos)) {
          // 「っ + は행」은 일본어에서 성립하지 않는다. 앞말이 촉음으로 줄면
          // 뒷말 첫소리는 반드시 ぱ행이 된다 (はっぴょう이지 はっひょう가 아니다).
          const illegal = cur.sound.endsWith('っ') && /^[はひふへほ]/.test(sound)
          next.push({
            sound: cur.sound + sound,
            notes: note ? [...cur.notes, note] : cur.notes,
            cost: cur.cost + onCost + vCost + (illegal ? 100 : 0),
          })
          if (next.length >= MAX_CANDIDATES) break
        }
        if (next.length >= MAX_CANDIDATES) break
      }
      if (next.length >= MAX_CANDIDATES) break
    }
    acc = next
  }

  acc.sort((a, b) => a.cost - b.cost || a.sound.length - b.sound.length)
  const map = new Map()
  for (const c of acc) if (!map.has(c.sound)) map.set(c.sound, { notes: c.notes, cost: c.cost })
  return map
}

// ── 단어 전체 ─────────────────────────────────────────────────────────────
// 표제어를 한자 단위로 분해하고, 한국음을 이어 만든 발음과 실제 읽기를 나란히
// 둔다. 「경제를 이미 알고 있으니 けいざい는 새로 외울 게 아니다」가 이 함수가
// 하려는 말 전부다.
export function wordBridge(word, reading) {
  const chars = kanjiChars(word)
  if (!chars.length) return null

  const parts = chars.map(bridgeChar).filter(Boolean)
  if (parts.length !== chars.length) return null

  const korean = parts.map((p) => p.korean).join('')
  const matched = parts.filter((p) => p.rule)
  const naive = normalizeJa(parts.map((p) => p.matchedOn).join(''))
  const actual = normalizeJa(reading || '')

  // 표제어에 한자 말고 다른 글자가 섞여 있으면(食べる) 읽기 전체가 음독 조합과
  // 같을 수 없다. 이런 말은 애초에 음독어가 아니므로 다리를 대지 않는다.
  const pureKanji = [...word].length === chars.length

  // 훈독으로 읽는 말(山 = やま)에 한자음 다리를 대면 도움이 아니라 방해다.
  // 실제 읽기가 음독 조합 후보 안에 있을 때만 인정한다.
  const cands = pureKanji && actual ? onReadingCandidates(chars) : new Map()
  const onReading = cands.has(actual)

  return {
    parts,
    korean,
    naive,
    actual,
    onReading,
    note: onReading ? (cands.get(actual).notes[0] ?? null) : null,
    rules: [...new Set(matched.map((p) => p.rule))],
    complete: korean.length === chars.length && matched.length === chars.length,
  }
}

// 내장 사전에 없는 한자어의 읽는 법 추정. AI 응답을 기다리는 동안 띄우는 힌트다.
//
// 한계를 분명히 해 둔다: 단어별 빈도 데이터가 없으므로 어느 음독이 이 조합에서
// 실제로 쓰이는지는 알 수 없다. 逼迫(ひっぱく)처럼 흔치 않은 음독을 쓰는 말은
// 1순위를 놓친다. 그래서 UI에서도 「후보」로만 보여주고 답으로 내세우지 않는다.
export function guessReading(word, limit = 3) {
  const chars = kanjiChars(word)
  if (!chars.length || [...word].length !== chars.length) return []
  return [...onReadingCandidates(chars).keys()].slice(0, limit)
}
