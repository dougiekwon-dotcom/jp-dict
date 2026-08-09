// 복습. 오늘 볼 카드만 꺼내 세 가지 방식 중 하나로 묻는다.

import { h, clear, toast } from '../ui/dom.js'
import { allEntries, getSrs, putSrs } from '../core/store.js'
import { newState, schedule, isDue, todayStr, GRADES, applyLookupPressure } from '../core/srs.js'
import { normalizeJa } from '../core/dict.js'

const MODES = [
  { id: 'jp2ko', label: '일본어 → 뜻' },
  { id: 'ko2jp', label: '뜻 → 일본어' },
  { id: 'reading', label: '읽는 법 쓰기' },
]

let mode = 'jp2ko'

export async function review(view) {
  clear(view)
  view.append(h('h2', { class: 'screen-title' }, '복습'))

  const entries = await allEntries()
  if (!entries.length) {
    view.append(empty('아직 복습할 낱말이 없습니다.', '찾기에서 낱말을 조회하면 쌓입니다.'))
    return
  }

  // 뜻이 있어야 문제를 낼 수 있다. AI 뜻풀이를 아직 안 받은 낱말은 건너뛴다.
  const usable = entries.filter((e) => e.meanings?.length)
  const today = todayStr()
  const queue = []
  for (const e of usable) {
    const state = (await getSrs(e.id)) || newState(e.id)
    if (isDue(state, today)) queue.push({ entry: e, state })
  }

  view.append(h('div', { class: 'card' },
    h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
      ...MODES.map((m) => h('button', {
        class: 'btn btn-sm' + (m.id === mode ? ' btn-primary' : ''),
        onClick: () => { mode = m.id; review(view) },
      }, m.label)),
    ),
    h('p', { class: 'small muted', style: 'margin:10px 0 0' },
      `오늘 볼 카드 ${queue.length}개 · 단어장 ${entries.length}개` +
      (usable.length < entries.length ? ` · 뜻이 없어 제외 ${entries.length - usable.length}개` : '')),
  ))

  if (!queue.length) {
    view.append(empty('오늘 볼 카드가 없습니다.', '내일 다시 오세요.'))
    return
  }

  const host = h('div')
  view.append(host)

  let i = 0
  let done = 0
  const next = () => {
    if (i >= queue.length) {
      clear(host)
      host.append(empty(`${done}개 마쳤습니다.`, '수고하셨습니다.'))
      return
    }
    clear(host)
    host.append(card(queue[i], () => { i++; done++; next() }))
  }
  next()
}

function empty(title, sub) {
  return h('div', { class: 'card' },
    h('p', { style: 'margin:0' }, title),
    h('p', { class: 'muted small', style: 'margin:8px 0 0' }, sub),
  )
}

function card({ entry, state }, onDone) {
  const box = h('div', { class: 'card' })

  const grade = async (quality) => {
    const pressed = applyLookupPressure(state, entry.lookupCount)
    await putSrs(schedule(pressed, quality))
    onDone()
  }

  const gradeRow = () => h('div', { style: 'display:flex;gap:8px;margin-top:14px' },
    ...GRADES.map((g) => h('button', {
      class: 'btn block' + (g.id === 'good' ? ' btn-primary' : ''),
      onClick: () => grade(g.quality),
    }, g.label)))

  // 읽는 법 쓰기 — 유일하게 정답이 자동 채점되는 방식이다.
  if (mode === 'reading') {
    const input = h('input', {
      class: 'block ja',
      placeholder: '히라가나로',
      autocomplete: 'off',
      spellcheck: false,
      style: 'font:inherit;font-size:1.1rem;padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:var(--panel)',
    })
    const verdict = h('div', { style: 'margin-top:10px' })

    box.append(
      h('div', { class: 'entry-word ja', style: 'text-align:center;padding:14px 0' }, entry.word),
      input,
      h('button', {
        class: 'btn btn-primary block',
        style: 'margin-top:10px',
        onClick: () => {
          const ok = normalizeJa(input.value.trim()) === normalizeJa(entry.reading)
          clear(verdict)
          verdict.append(
            h('div', { class: ok ? 'chip' : 'chip', style: ok ? '' : 'background:#fbeae8;color:var(--bad)' },
              ok ? '맞았습니다' : `정답 ${entry.reading}`),
            h('ul', { class: 'meanings' }, (entry.meanings || []).map((m) => h('li', {}, m))),
            gradeRow(),
          )
        },
      }, '확인'),
      verdict,
    )
    return box
  }

  const front = mode === 'jp2ko'
    ? h('div', { class: 'entry-word ja', style: 'text-align:center;padding:18px 0' }, entry.word)
    : h('div', { style: 'text-align:center;padding:18px 0;font-size:1.3rem' }, (entry.meanings || []).join(', '))

  const back = h('div')
  box.append(front, h('button', {
    class: 'btn btn-primary block',
    onClick: () => {
      clear(back)
      back.append(
        h('hr', { class: 'sep' }),
        mode === 'jp2ko'
          ? h('div', {},
              h('div', { class: 'entry-reading ja', style: 'text-align:center' }, entry.reading),
              h('ul', { class: 'meanings' }, (entry.meanings || []).map((m) => h('li', {}, m))))
          : h('div', { style: 'text-align:center' },
              h('div', { class: 'entry-word ja' }, entry.word),
              h('div', { class: 'entry-reading ja' }, entry.reading)),
        entry.examples?.length
          ? h('ul', { class: 'examples', style: 'margin-top:12px' },
              entry.examples.slice(0, 1).map((ex) => h('li', {},
                h('div', { class: 'ex-ja ja' }, ex.ja),
                h('div', { class: 'ex-ko' }, ex.ko))))
          : null,
        gradeRow(),
      )
    },
  }, '뒤집기'), back)

  return box
}
