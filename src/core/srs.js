// 간격 반복 (SM-2).
//
// 화면에서는 버튼 세 개로만 묻는다 — 모름 / 애매 / 알아. SM-2의 0~5 척도를
// 그대로 노출하면 고르는 데 시간이 더 걸리고, 세 단계면 간격을 정하기에 충분하다.

export const GRADES = [
  { id: 'again', label: '모름', quality: 2 },
  { id: 'hard', label: '애매', quality: 3 },
  { id: 'good', label: '알아', quality: 5 },
]

const MIN_EF = 1.3
const DEFAULT_EF = 2.5

export function newState(id) {
  return { id, ef: DEFAULT_EF, interval: 0, reps: 0, lapses: 0, dueAt: todayStr(), lastAt: 0 }
}

export function todayStr(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function addDays(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return todayStr(d)
}

export function isDue(state, on = todayStr()) {
  return !state?.dueAt || state.dueAt <= on
}

// quality: 0~5. 3 미만이면 처음부터 다시.
export function schedule(state, quality) {
  const s = { ...state }
  s.ef = Math.max(MIN_EF, s.ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))

  if (quality < 3) {
    s.reps = 0
    s.interval = 1
    s.lapses = (s.lapses || 0) + 1
  } else {
    s.reps = (s.reps || 0) + 1
    s.interval = s.reps === 1 ? 1 : s.reps === 2 ? 6 : Math.round(s.interval * s.ef)
  }

  s.dueAt = addDays(s.interval)
  s.lastAt = Date.now()
  return s
}

// 여러 번 찾아본 낱말은 그만큼 안 붙은 것이다. 복습 주기를 당겨 준다.
// (조회 로그가 SRS에 직접 영향을 주는 유일한 지점)
export function applyLookupPressure(state, lookupCount) {
  if (!lookupCount || lookupCount < 3) return state
  const penalty = Math.min(0.4, (lookupCount - 2) * 0.1)
  return { ...state, ef: Math.max(MIN_EF, state.ef - penalty) }
}
