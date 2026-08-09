// 통계. 차트 라이브러리 없이 인라인 SVG와 CSS 그리드로 직접 그린다
// (오프라인 유지 + 번들 증가 0).

import { h, clear } from '../ui/dom.js'
import { computeStats } from '../core/stats.js'
import { kanjiInfo, isLoaded, ensureLoaded } from '../core/dict.js'

const MODE_LABEL = { ko: '한글 발음', ja: '일본어', hw: '손글씨' }

export async function stats(view) {
  clear(view)
  view.append(h('h2', { class: 'screen-title' }, '통계'))

  const s = await computeStats()
  if (!s.total) {
    view.append(h('div', { class: 'card' },
      h('p', { class: 'muted', style: 'margin:0' }, '아직 기록이 없습니다.'),
      h('p', { class: 'muted small', style: 'margin:8px 0 0' }, '낱말을 찾으면 여기에 쌓입니다.'),
    ))
    return
  }

  if (!isLoaded()) { try { await ensureLoaded() } catch { /* 한자 정보 없이도 표는 그린다 */ } }

  view.append(
    summaryCard(s),
    heatmapCard(s.heatmap),
    topWordsCard(s.topWords),
    topKanjiCard(s.topKanji),
    jlptCard(s.topKanji),
    s.books.length ? listCard('책별', s.books.map(([k, v]) => [k, v])) : null,
    s.modes.length ? listCard('입력 방식', s.modes.map(([k, v]) => [MODE_LABEL[k] || k, v])) : null,
    srsCard(s.srs),
  )
}

function summaryCard(s) {
  const item = (label, value) => h('div', { style: 'flex:1;min-width:70px;text-align:center' },
    h('div', { style: 'font-size:1.5rem;font-weight:700' }, String(value)),
    h('div', { class: 'small muted' }, label))

  return h('div', { class: 'card' },
    h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
      item('총 조회', s.total),
      item('낱말', s.unique),
      item('오늘', s.today),
      item('이번 주', s.week),
      item('연속', s.streak + '일'),
    ))
}

// 최근 12주 잔디. 열 하나가 한 주, 칸 하나가 하루.
function heatmapCard(days) {
  const max = Math.max(1, ...days.map((d) => d.count))
  const cell = (d) => {
    const level = d.count === 0 ? 0 : Math.ceil((d.count / max) * 4)
    const bg = ['#eae5d8', '#cfe3e0', '#9fc9c4', '#5da49d', '#1f6f6b'][level]
    return h('div', {
      title: `${d.date} · ${d.count}회`,
      style: `width:100%;aspect-ratio:1;border-radius:3px;background:${bg}`,
    })
  }
  return h('div', { class: 'card' },
    h('h3', {}, '조회 히트맵'),
    h('p', { class: 'small muted', style: 'margin:0 0 10px' }, '최근 12주'),
    h('div', {
      style: 'display:grid;grid-template-rows:repeat(7,1fr);grid-auto-flow:column;gap:3px',
    }, days.map(cell)),
  )
}

function topWordsCard(rows) {
  if (!rows.length) return null
  return h('div', { class: 'card' },
    h('h3', {}, '많이 찾은 낱말'),
    h('p', { class: 'small muted', style: 'margin:0 0 6px' }, '곧 내 약점 목록입니다.'),
    h('ul', { class: 'hits' }, rows.map((r) => h('li', {},
      h('button', { onClick: () => { location.hash = '#/q/' + encodeURIComponent(r.word) } },
        h('span', { class: 'w ja' }, r.word),
        h('span', { class: 'r ja' }, r.reading),
        h('span', { class: 'g' },
          `${r.count}회` + (r.avgGapDays != null ? ` · 평균 ${r.avgGapDays}일마다` : '')),
      ),
      r.meaning ? h('div', { class: 'small muted', style: 'padding:0 2px 8px' }, r.meaning) : null,
    ))),
  )
}

function topKanjiCard(rows) {
  if (!rows.length) return null
  const max = Math.max(...rows.map((r) => r.count))
  return h('div', { class: 'card' },
    h('h3', {}, '많이 걸린 한자'),
    h('p', { class: 'small muted', style: 'margin:0 0 10px' },
      '経済·経験·経営을 찾았으면 経은 3회입니다. 낱말 목록으로는 안 보이는 것.'),
    h('div', {}, rows.map((r) => {
      const info = kanjiInfo(r.ch)
      return h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px' },
        h('span', { class: 'ja', style: 'font-size:1.4rem;width:1.6em;text-align:center' }, r.ch),
        h('span', { style: 'width:2.4em;color:var(--kor);font-weight:700;font-size:.9rem' }, info?.korean || ''),
        h('span', { style: 'flex:1;height:10px;background:#eae5d8;border-radius:999px;overflow:hidden' },
          h('i', { style: `display:block;height:100%;width:${(r.count / max) * 100}%;background:var(--accent)` })),
        h('span', { class: 'small muted', style: 'width:2.5em;text-align:right' }, String(r.count)),
      )
    })),
  )
}

// 어느 수준에서 막히는지. KANJIDIC의 JLPT 등급을 쓴다.
function jlptCard(topKanji) {
  const buckets = new Map()
  for (const r of topKanji) {
    const lv = kanjiInfo(r.ch)?.jlpt || 0
    buckets.set(lv, (buckets.get(lv) || 0) + r.count)
  }
  if (!buckets.size) return null
  const order = [5, 4, 3, 2, 1, 0]
  const max = Math.max(...buckets.values())
  return h('div', { class: 'card' },
    h('h3', {}, 'JLPT 수준'),
    h('div', {}, order.filter((lv) => buckets.has(lv)).map((lv) => h('div', {
      style: 'display:flex;align-items:center;gap:8px;margin-bottom:6px',
    },
      h('span', { class: 'small', style: 'width:3em' }, lv ? `N${lv}` : '등급 밖'),
      h('span', { style: 'flex:1;height:10px;background:#eae5d8;border-radius:999px;overflow:hidden' },
        h('i', { style: `display:block;height:100%;width:${(buckets.get(lv) / max) * 100}%;background:var(--kor)` })),
      h('span', { class: 'small muted', style: 'width:2.5em;text-align:right' }, String(buckets.get(lv))),
    ))),
  )
}

function listCard(title, rows) {
  return h('div', { class: 'card' },
    h('h3', {}, title),
    h('ul', { class: 'hits' }, rows.map(([label, n]) => h('li', {},
      h('div', { style: 'display:flex;padding:9px 2px' },
        h('span', { style: 'flex:1' }, label),
        h('span', { class: 'small muted' }, `${n}회`),
      )))),
  )
}

function srsCard(s) {
  if (!s.tracked) return null
  return h('div', { class: 'card' },
    h('h3', {}, '복습'),
    h('p', { class: 'small', style: 'margin:0' },
      `추적 중 ${s.tracked}개 · 오늘 볼 카드 ${s.due}개` +
      (s.accuracy != null ? ` · 정답률 ${s.accuracy}%` : '')),
    s.hardest.length ? h('div', { style: 'margin-top:10px' },
      h('p', { class: 'small muted', style: 'margin:0 0 4px' }, '자주 틀리는 낱말'),
      h('ul', { class: 'hits' }, s.hardest.map((x) => h('li', {},
        h('div', { style: 'display:flex;padding:8px 2px' },
          h('span', { class: 'ja', style: 'flex:1' }, x.word),
          h('span', { class: 'small muted' }, `${x.lapses}번 틀림`),
        )))),
    ) : null,
  )
}
