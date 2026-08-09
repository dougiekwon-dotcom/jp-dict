// 설정. 양이 적고 동기 접근이 편해야 해서 localStorage에 둔다.
// (단어장·조회 로그처럼 늘어나는 것은 IndexedDB — store.js)

const KEY = 'jp-dict:settings'

// 작업마다 난이도가 다르므로 모델도 나눈다.
//
//   뜻풀이   읽는 법과 영어 뜻을 사전이 이미 넘겨준다. 모델이 하는 일은 한국어로
//            옮기고 예문을 쓰는 것뿐이라 작은 모델로 충분하다.
//   문장     번역 + 후리가나 + 낱말 분해. 중간.
//   손글씨   흘려 쓴 한자를 그림으로 판독한다. 틀리면 사용자가 다시 써야 하므로
//            뜻풀이보다는 위를 쓴다. Sonnet 5는 Sonnet 계열 최초로 고해상도
//            비전이 들어갔고 도입가 기간이라 값도 Haiku의 두 배 수준이다.
//
// 조회 한 번 대략: Haiku 4원 · Sonnet 7원 · Opus 18원.
// (손글씨는 이미지 토큰이 붙지만 잘라낸 그림이라 200토큰 남짓이다.)
// 결과는 영구 캐시되므로 같은 낱말에는 한 번만 든다.
export const PRESETS = {
  save: {
    label: '절약',
    note: '전부 Haiku · 조회당 약 4원',
    models: { gloss: 'claude-haiku-4-5', sentence: 'claude-haiku-4-5', handwriting: 'claude-haiku-4-5' },
  },
  balanced: {
    label: '균형 (추천)',
    note: '뜻·문장은 Haiku, 손글씨는 Sonnet 5',
    models: { gloss: 'claude-haiku-4-5', sentence: 'claude-haiku-4-5', handwriting: 'claude-sonnet-5' },
  },
  best: {
    label: '최고 품질',
    note: '전부 Opus 5 · 조회당 약 18원',
    models: { gloss: 'claude-opus-5', sentence: 'claude-opus-5', handwriting: 'claude-opus-5' },
  },
}

export const MODEL_LABEL = {
  'claude-opus-5': 'Opus 5',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5': 'Haiku 4.5',
}

const DEFAULTS = {
  apiKey: '',
  preset: 'balanced',
  models: null,        // 프리셋을 벗어나 직접 고른 경우에만 채워진다
  book: '',            // 지금 읽는 책 — 조회한 낱말에 자동으로 붙는다
}

export function getSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

// 작업 이름(gloss | sentence | handwriting)으로 쓸 모델을 고른다.
export function modelFor(task) {
  const s = getSettings()
  const preset = PRESETS[s.preset] || PRESETS.balanced
  return s.models?.[task] || preset.models[task]
}

// 키가 형태만이라도 맞는지. 오타나 붙여넣기 사고를 여기서 걸러 준다.
export function hasApiKey() {
  const k = getSettings().apiKey
  return typeof k === 'string' && k.startsWith('sk-ant-') && k.length > 30
}
