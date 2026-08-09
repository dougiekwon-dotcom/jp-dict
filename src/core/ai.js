// Claude API 호출. 브라우저에서 곧장 부른다 — 프록시 서버 없음.
//
// 이 계층이 하는 일은 셋뿐이다.
//   glossWord        표제어 → 한국어 뜻·뉘앙스·예문
//   readSentence     문장(일본어 또는 한글 발음) → 원문·후리가나·해석·단어 분해
//   readHandwriting  손글씨 이미지 → 인식 + 위의 해석까지 한 번에
//
// 응답은 전부 IndexedDB에 영구 캐시한다. 같은 낱말을 두 번 결제하지 않는다는
// 게 이 앱의 비용 구조 전체다 — 그래서 기본 모델도 가장 정확한 쪽으로 둔다.

import { getSettings, modelFor } from './settings.js'
import { cacheGet, cachePut } from './store.js'

const ENDPOINT = 'https://api.anthropic.com/v1/messages'

// effort는 Opus 5·Sonnet 5에서만 받는다. Haiku 4.5에 보내면 400이 난다.
const SUPPORTS_EFFORT = new Set(['claude-opus-5', 'claude-sonnet-5'])

const SYSTEM = `너는 일본어를 한국어로 옮기는 사전 편집자다. 한국인이 일본어 책을 읽다가 모르는 말을 찾을 때 보는 항목을 쓴다.

지켜야 할 것:
- 읽는 법은 주어진 사전 데이터를 그대로 쓴다. 지어내지 않는다.
- 한국어 뜻은 2~4개, 사전투로 짧게. 설명 문장이 아니라 대응하는 낱말을 적는다.
- 뉘앙스는 한 줄. 어떤 상황에서 쓰는 말인지, 비슷한 말과 무엇이 다른지를 적는다. 뻔한 소리는 적지 않는다.
- 예문은 실제로 쓰이는 형태로 쓴다. 어떤 조사와 붙는지, 어떻게 활용하는지가 드러나야 한다. 일본 국어사전이 그러하듯 뜻풀이보다 용례가 중요하다.
- 예문의 kana 항목은 그 문장 전체를 히라가나로만 옮긴 것이다. 한자나 가타카나를 남기지 않는다.
- 답에 내부 태그나 과정 설명을 넣지 않는다.`

const EXAMPLE_SCHEMA = {
  type: 'object',
  properties: {
    ja: { type: 'string', description: '일본어 예문' },
    kana: { type: 'string', description: '예문 전체를 히라가나로만' },
    ko: { type: 'string', description: '한국어 해석' },
  },
  required: ['ja', 'kana', 'ko'],
  additionalProperties: false,
}

const WORD_SCHEMA = {
  type: 'object',
  properties: {
    korean: { type: 'array', items: { type: 'string' }, description: '한국어 뜻 2~4개' },
    nuance: { type: 'string', description: '쓰임새 한 줄' },
    examples: { type: 'array', items: EXAMPLE_SCHEMA, description: '예문 2개' },
  },
  required: ['korean', 'nuance', 'examples'],
  additionalProperties: false,
}

const BREAKDOWN_SCHEMA = {
  type: 'object',
  properties: {
    word: { type: 'string' },
    reading: { type: 'string' },
    meaning: { type: 'string' },
    pos: { type: 'string' },
  },
  required: ['word', 'reading', 'meaning', 'pos'],
  additionalProperties: false,
}

// 입력을 어떻게 읽었는지도 같이 받는다. 한국어를 넣었을 때 「발음을 옮긴 것」으로
// 봤는지 「뜻을 옮긴 것」으로 봤는지에 따라 결과가 완전히 달라지므로, 사용자가
// 그 판단을 눈으로 확인할 수 있어야 한다.
const READ_AS = {
  type: 'string',
  enum: ['japanese', 'korean-sound', 'korean-meaning'],
  description:
    'japanese: 입력이 일본어였다. ' +
    'korean-sound: 한글이 일본어 발음을 적은 것이었다(코레와 → これは). ' +
    'korean-meaning: 한글이 한국어 뜻이어서 일본어로 옮겼다(고맙습니다 → ありがとうございます).',
}

const SENTENCE_SCHEMA = {
  type: 'object',
  properties: {
    readAs: READ_AS,
    japanese: { type: 'string', description: '정규화된 일본어 원문' },
    furigana: { type: 'string', description: '원문 전체를 히라가나로만' },
    korean: { type: 'string', description: '한국어 해석' },
    words: { type: 'array', items: BREAKDOWN_SCHEMA, description: '낱말 분해' },
  },
  required: ['readAs', 'japanese', 'furigana', 'korean', 'words'],
  additionalProperties: false,
}

// 손글씨는 인식과 해석을 한 번에 받는다. 왕복 두 번이면 체감이 확 느려진다.
const HANDWRITING_SCHEMA = {
  type: 'object',
  properties: {
    recognized: { type: 'string', description: '손글씨에 쓰인 글자를 그대로 읽어낸 것. 후보를 나열하지 말고 하나만.' },
    readAs: READ_AS,
    kind: { type: 'string', enum: ['word', 'sentence'], description: '낱말인지 문장인지' },
    japanese: { type: 'string', description: '최종 일본어' },
    furigana: { type: 'string' },
    korean: { type: 'string' },
    words: { type: 'array', items: BREAKDOWN_SCHEMA },
  },
  required: ['recognized', 'readAs', 'kind', 'japanese', 'furigana', 'korean', 'words'],
  additionalProperties: false,
}

// ── 공개 API ──────────────────────────────────────────────────────────────
export async function glossWord({ word, reading, glosses, pos }) {
  const user = [
    '아래 낱말의 사전 항목을 써라.',
    '',
    `표제어: ${word}`,
    `읽기: ${reading}`,
    glosses?.length ? `영어 뜻(참고): ${glosses.join(', ')}` : '',
    pos?.length ? `품사(참고): ${pos.join(', ')}` : '',
  ].filter(Boolean).join('\n')

  return call({
    kind: 'gloss',
    task: 'gloss',
    cacheOn: `${word}|${reading}`,
    content: [{ type: 'text', text: user }],
    schema: WORD_SCHEMA,
    maxTokens: 1500,
  })
}

export async function readSentence(text, { fromHangul = false } = {}) {
  const user = fromHangul
    ? [
        '아래는 한글로 적혀 있다. 둘 중 하나이니 어느 쪽인지 먼저 판단해라.',
        '',
        '(가) 일본어를 한국어 발음으로 적은 것 — 「코레와 난데스카」, 「아리가토」.',
        '     이 경우 원래 일본어로 되돌린다. 한국식 표기라 장음이 빠져 있거나',
        '     조사를 소리대로 적었을 수 있다(は를 「와」로, へ를 「에」로).',
        '',
        '(나) 한국어 뜻 — 「고맙습니다」, 「화장실 어디예요」.',
        '     이 경우 자연스러운 일본어로 옮긴다. 직역이 아니라 실제로 그 상황에서',
        '     쓰는 말로 옮겨라.',
        '',
        '어느 쪽으로 읽었는지 readAs에 표시하고, japanese에는 최종 일본어를 넣어라.',
        'korean에는 그 일본어의 뜻을 적는다.',
        '',
        text,
      ].join('\n')
    : ['아래 일본어를 해석해라. readAs는 japanese 로 둔다.', '', text].join('\n')

  return call({
    kind: fromHangul ? 'sentence-ko' : 'sentence',
    task: 'sentence',
    cacheOn: text,
    content: [{ type: 'text', text: user }],
    schema: SENTENCE_SCHEMA,
    maxTokens: 3000,
  })
}

// pngDataUrl: 캔버스에서 뽑은 data:image/png;base64,... 문자열
export async function readHandwriting(pngDataUrl) {
  const base64 = pngDataUrl.split(',')[1] || ''
  const user = [
    '이미지는 손으로 쓴 글씨다. 한 글자일 수도 있고 여러 글자를 이어 쓴 낱말이나 문장일 수도 있다.',
    '후보를 여러 개 내놓지 말고 가장 그럴듯한 것 하나로 판단하고, 그대로 해석까지 해라.',
    '',
    '세 가지 중 하나다. 어느 쪽인지 판단해서 readAs에 표시해라.',
    '',
    '(가) 일본어 — 한자·히라가나·가타카나. 그대로 읽고 해석한다.',
    '',
    '(나) 일본어를 한국어 발음으로 적은 한글 — 「코레와 난데스카」, 「아리가토」.',
    '     원래 일본어로 되돌린다. 장음이 빠져 있거나 조사를 소리대로 적었을 수 있다',
    '     (は를 「와」로, へ를 「에」로).',
    '',
    '(다) 한국어 뜻 — 「고맙습니다」, 「화장실 어디예요」.',
    '     자연스러운 일본어로 옮긴다. 직역이 아니라 실제로 그 상황에서 쓰는 말로.',
    '',
    'recognized에는 손글씨에 쓰인 글자를 그대로 적고(한글이면 한글 그대로),',
    'japanese에는 최종 일본어를 넣어라.',
  ].join('\n')

  return call({
    kind: 'handwriting',
    task: 'handwriting',
    cacheOn: await sha256(base64),
    content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
      { type: 'text', text: user },
    ],
    schema: HANDWRITING_SCHEMA,
    maxTokens: 3000,
  })
}

// ── 호출 ──────────────────────────────────────────────────────────────────
async function call({ kind, task, cacheOn, content, schema, maxTokens }) {
  const { apiKey } = getSettings()
  const model = modelFor(task)
  if (!apiKey) throw new AiError('설정에서 API 키를 먼저 넣어 주세요.', 'no-key')

  const key = `${kind}:${model}:${cacheOn}`
  const hit = await cacheGet(key)
  if (hit) return { ...hit, cached: true }

  const body = {
    model,
    max_tokens: maxTokens,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema } },
  }
  if (SUPPORTS_EFFORT.has(model)) body.output_config.effort = 'low'

  let res
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
    })
  } catch {
    throw new AiError('네트워크에 연결할 수 없습니다.', 'network')
  }

  if (!res.ok) throw await httpError(res)

  const data = await res.json()
  if (data.stop_reason === 'refusal') {
    throw new AiError('이 요청은 처리할 수 없다는 응답을 받았습니다.', 'refusal')
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new AiError('응답을 읽지 못했습니다. 다시 시도해 주세요.', 'parse')
  }

  await cachePut(key, parsed, model)
  return { ...parsed, cached: false }
}

async function httpError(res) {
  let detail = ''
  try {
    const body = await res.json()
    detail = body?.error?.message || ''
  } catch { /* 본문이 JSON이 아니면 상태 코드만으로 안내한다 */ }

  const msg = {
    401: 'API 키가 올바르지 않습니다. 설정에서 다시 확인해 주세요.',
    403: '이 API 키로는 접근할 수 없습니다.',
    404: '모델 이름이 올바르지 않습니다. 설정에서 다른 모델을 골라 보세요.',
    413: '보낸 내용이 너무 큽니다.',
    429: '요청이 몰렸습니다. 잠시 후 다시 시도해 주세요.',
  }[res.status] || (res.status >= 500
    ? '서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.'
    : `요청이 거부되었습니다 (${res.status}).`)

  return new AiError(detail ? `${msg}\n${detail}` : msg, 'http', res.status)
}

export class AiError extends Error {
  constructor(message, code, status) {
    super(message)
    this.name = 'AiError'
    this.code = code
    this.status = status
  }
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
