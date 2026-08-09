// 결과 카드. 사전 항목 하나를 화면에 그린다.
//
// 카드는 위에서 아래로 「즉시 뜨는 것 → 기다려야 뜨는 것」 순서다.
//   표제어·읽기·한자 분해 : 내장 사전과 계산만으로 나오므로 즉시
//   한국어 뜻·예문        : AI 응답을 기다림 (5단계에서 채워짐)
// 그래서 AI가 느리거나 키가 없어도 카드 위쪽 절반은 항상 쓸모가 있다.

import { h } from './dom.js'
import { kanjiInfo, kanjiChars } from '../core/dict.js'
import { wordBridge } from '../core/hanja.js'

// JMdict 품사 코드는 종류가 많다. 자주 나오는 것만 한국어로 옮기고 나머지는
// 원래 코드를 그대로 둔다 — 틀린 번역보다 낫다.
const POS_KO = {
  n: '명사', 'n-adv': '명사(부사적)', 'n-t': '명사(시간)', pn: '대명사',
  'adj-i': 'い형용사', 'adj-na': 'な형용사', 'adj-no': 'の형용사', 'adj-f': '연체사적',
  adv: '부사', 'adv-to': '부사(と)', conj: '접속사', int: '감탄사', prt: '조사',
  exp: '관용구', pref: '접두사', suf: '접미사', ctr: '조수사',
  vs: 'する동사', 'vs-s': 'する동사', 'vs-i': 'する동사', vt: '타동사', vi: '자동사',
  v1: '1단동사', v5r: '5단동사(る)', v5u: '5단동사(う)', v5k: '5단동사(く)',
  v5g: '5단동사(ぐ)', v5s: '5단동사(す)', v5t: '5단동사(つ)', v5n: '5단동사(ぬ)',
  v5b: '5단동사(ぶ)', v5m: '5단동사(む)', 'v5k-s': '5단동사(いく)', vk: 'くる동사',
}

function posLabel(codes) {
  if (!codes?.length) return ''
  return codes.slice(0, 2).map((c) => POS_KO[c] || c).join(' · ')
}

export function entryCard(entry, opts = {}) {
  const { bridgeRow = null, korean = null, examples = null, nuance = null, footer = null } = opts

  const card = h('div', { class: 'card' })

  // ── 표제어 ──
  card.append(
    h('div', { class: 'entry-head' },
      h('span', { class: 'entry-word ja' }, entry.word),
      entry.word !== entry.reading && h('span', { class: 'entry-reading ja' }, entry.reading),
      h('span', { class: 'entry-pos' }, posLabel(entry.pos)),
    ),
  )

  // 이형 표기 — 책에서 본 표기가 표제어와 다를 수 있다.
  const alts = [...entry.kanji.slice(1), ...entry.kana.slice(1)]
  if (alts.length) {
    card.append(h('div', { class: 'small muted ja', style: 'margin-top:4px' }, '달리 쓰기: ' + alts.join(' · ')))
  }

  // ── 뜻 ──
  if (korean?.length) {
    card.append(h('ul', { class: 'meanings' }, korean.map((m) => h('li', {}, m))))
  } else {
    // AI 한국어 뜻이 오기 전에는 사전의 영어 뜻을 보여준다. 빈 화면보다 낫다.
    card.append(h('ul', { class: 'meanings muted' }, entry.glosses.slice(0, 4).map((m) => h('li', {}, m))))
  }

  // ── 한자 분해 (한자음 다리) ──
  if (bridgeRow) {
    card.append(h('hr', { class: 'sep' }), bridgeRow)
  }

  // ── 예문 ──
  if (examples?.length) {
    card.append(h('hr', { class: 'sep' }))
    card.append(h('ul', { class: 'examples' }, examples.map((ex) =>
      h('li', {},
        h('div', { class: 'ex-ja ja' }, ex.ja),
        ex.kana && h('div', { class: 'ex-kana ja' }, ex.kana),
        ex.ko && h('div', { class: 'ex-ko' }, ex.ko),
      ),
    )))
  }

  if (nuance) {
    card.append(h('div', { class: 'small', style: 'margin-top:8px' }, '💡 ' + nuance))
  }

  if (footer) card.append(h('hr', { class: 'sep' }), footer)

  return card
}

// 표제어를 한자 단위로 쪼갠 줄. 각 칸에 한자·한국 한자음·음독을 얹고, 음독으로
// 읽는 한자어면 아래에 「경제 → けいざい」 다리를 덧붙인다.
// 한자가 없는 표제어(순 가나)면 null.
export function kanjiRow(word, reading) {
  const chars = kanjiChars(word)
  if (!chars.length) return null

  const bridge = wordBridge(word, reading)
  const byChar = new Map((bridge?.parts || []).map((p) => [p.ch, p]))

  const chips = chars.map((ch) => {
    const part = byChar.get(ch)
    const info = kanjiInfo(ch)
    return h('div', { class: 'kanji-chip' },
      h('div', { class: 'ch ja' }, ch),
      h('div', { class: 'ko' }, part?.korean || info?.korean || '—'),
      h('div', { class: 'on ja' }, part?.matchedOn || info?.on?.[0] || ''),
    )
  })

  const box = h('div', {}, h('div', { class: 'kanji-row' }, chips))

  // 훈독으로 읽는 말(山 = やま)에 한자음 다리를 대면 오히려 헷갈린다.
  // 음독이 실제 읽기와 맞아떨어질 때만 보여준다.
  if (bridge?.onReading && bridge.korean) {
    const notes = [...bridge.rules]
    if (bridge.note) notes.push(bridge.note)
    box.append(
      h('div', { class: 'bridge' },
        h('span', {}, bridge.korean),
        h('span', { class: 'muted' }, ' → '),
        h('span', { class: 'ja' }, bridge.actual || bridge.naive),
        notes.length && h('div', { class: 'small', style: 'opacity:.8;margin-top:2px' }, notes.join(' · ')),
      ),
    )
  }

  return box
}

// 후보가 여럿일 때의 간단 목록. onPick(entry)으로 선택을 올려보낸다.
export function hitList(results, onPick) {
  return h('ul', { class: 'hits' }, results.map(({ entry }) =>
    h('li', {},
      h('button', { onClick: () => onPick(entry) },
        h('span', { class: 'w ja' }, entry.word),
        h('span', { class: 'r ja' }, entry.word === entry.reading ? '' : entry.reading),
        h('span', { class: 'g' }, entry.glosses[0] || ''),
      ),
    ),
  ))
}
