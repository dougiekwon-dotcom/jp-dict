// 조회 로그 집계.
//
// 통계는 entries의 비정규화된 횟수가 아니라 lookups 로그에서 계산한다.
// 로그는 지우지 않으므로 나중에 새 지표를 넣어도 과거 기록으로 소급된다.

import { allLookups, allEntries, allSrs } from './store.js'
import { todayStr } from './srs.js'

export async function computeStats() {
  const [lookups, entries, srs] = await Promise.all([allLookups(), allEntries(), allSrs()])

  const byWord = new Map()
  const byKanji = new Map()
  const byDate = new Map()
  const byBook = new Map()
  const byMode = new Map()

  for (const l of lookups) {
    bump(byWord, l.id)
    // 한자 단위 집계 — 経済·経験·経営을 각각 찾았으면 経은 3회다.
    // 낱말 목록만 봐서는 안 보이는 「계속 발목 잡는 한자」가 여기서 드러난다.
    for (const ch of new Set(l.kanji || [])) bump(byKanji, ch)
    bump(byDate, l.date)
    if (l.book) bump(byBook, l.book)
    if (l.mode) bump(byMode, l.mode)
  }

  const entryById = new Map(entries.map((e) => [e.id, e]))

  const topWords = [...byWord.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id, count]) => {
      const e = entryById.get(id)
      return {
        id,
        word: e?.word || id.split(' ')[0],
        reading: e?.reading || '',
        meaning: e?.meanings?.[0] || '',
        count,
        avgGapDays: avgGap(lookups.filter((l) => l.id === id).map((l) => l.at)),
      }
    })

  const topKanji = [...byKanji.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([ch, count]) => ({ ch, count }))

  return {
    total: lookups.length,
    unique: byWord.size,
    today: byDate.get(todayStr()) || 0,
    week: lastNDays(byDate, 7).reduce((n, d) => n + d.count, 0),
    streak: streakDays(byDate),
    topWords,
    topKanji,
    heatmap: lastNDays(byDate, 84),
    books: [...byBook.entries()].sort((a, b) => b[1] - a[1]),
    modes: [...byMode.entries()].sort((a, b) => b[1] - a[1]),
    srs: srsSummary(srs, entries),
  }
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1)
}

// 같은 낱말을 다시 찾기까지 평균 며칠이 걸렸는지. 간격이 짧으면 아예 안 붙은
// 것이고, 길면 그냥 드물게 나오는 말이라 잊은 것이다 — 대응이 다르다.
function avgGap(times) {
  if (times.length < 2) return null
  const sorted = [...times].sort((a, b) => a - b)
  let sum = 0
  for (let i = 1; i < sorted.length; i++) sum += sorted[i] - sorted[i - 1]
  return Math.round(sum / (sorted.length - 1) / 86400000)
}

function lastNDays(byDate, n) {
  const out = []
  const d = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(d)
    day.setDate(d.getDate() - i)
    const key = todayStr(day)
    out.push({ date: key, count: byDate.get(key) || 0 })
  }
  return out
}

function streakDays(byDate) {
  let n = 0
  const d = new Date()
  for (;;) {
    const key = todayStr(d)
    // 오늘은 아직 안 찾았을 수 있으니 연속이 끊긴 것으로 치지 않는다.
    if (!byDate.get(key)) { if (n === 0 && key === todayStr()) { d.setDate(d.getDate() - 1); continue } break }
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
}

function srsSummary(srs, entries) {
  const today = todayStr()
  const due = srs.filter((s) => !s.dueAt || s.dueAt <= today).length
  const reviewed = srs.filter((s) => s.reps > 0)
  const lapses = srs.reduce((n, s) => n + (s.lapses || 0), 0)
  const attempts = reviewed.reduce((n, s) => n + s.reps, 0) + lapses
  const byId = new Map(entries.map((e) => [e.id, e]))
  const hardest = [...srs]
    .filter((s) => (s.lapses || 0) > 0)
    .sort((a, b) => (b.lapses || 0) - (a.lapses || 0))
    .slice(0, 10)
    .map((s) => ({ word: byId.get(s.id)?.word || s.id, lapses: s.lapses, ef: s.ef }))
  return {
    tracked: srs.length,
    due,
    accuracy: attempts ? Math.round(((attempts - lapses) / attempts) * 100) : null,
    hardest,
  }
}
