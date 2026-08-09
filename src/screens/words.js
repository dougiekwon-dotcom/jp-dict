import { h, clear, toast, ago } from '../ui/dom.js'
import { allEntries, setStarred, deleteEntry, invalidateCounts } from '../core/store.js'

const SORTS = [
  { id: 'count', label: '많이 찾은 순' },
  { id: 'recent', label: '최근 순' },
  { id: 'kana', label: '가나 순' },
]

let sort = 'count'
let book = ''
let starredOnly = false

export async function words(view) {
  clear(view)
  view.append(h('h2', { class: 'screen-title' }, '단어장'))

  const all = await allEntries()
  if (!all.length) {
    view.append(h('div', { class: 'card' },
      h('p', { class: 'muted', style: 'margin:0' }, '아직 비어 있습니다.'),
      h('p', { class: 'muted small', style: 'margin:8px 0 0' },
        '찾기에서 낱말을 조회하면 자동으로 쌓입니다.'),
    ))
    return
  }

  const books = [...new Set(all.map((e) => e.book).filter(Boolean))].sort()
  const controls = h('div', { class: 'card' })
  const list = h('div')
  view.append(controls, list)

  const paint = () => {
    let rows = all
    if (book) rows = rows.filter((e) => e.book === book)
    if (starredOnly) rows = rows.filter((e) => e.starred)
    rows = [...rows].sort(comparator(sort))

    clear(list)
    list.append(h('p', { class: 'small muted', style: 'margin:0 0 8px' },
      `${rows.length}개${book ? ` · ${book}` : ''}`))

    if (!rows.length) {
      list.append(h('div', { class: 'card' }, h('p', { class: 'muted', style: 'margin:0' }, '해당하는 낱말이 없습니다.')))
      return
    }
    list.append(h('div', { class: 'card' }, h('ul', { class: 'hits' }, rows.map((e) => row(e, paint)))))
  }

  clear(controls)
  controls.append(
    h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' },
      ...SORTS.map((s) => h('button', {
        class: 'btn btn-sm' + (s.id === sort ? ' btn-primary' : ''),
        onClick: () => { sort = s.id; words(view) },
      }, s.label)),
      h('button', {
        class: 'btn btn-sm' + (starredOnly ? ' btn-primary' : ''),
        onClick: () => { starredOnly = !starredOnly; words(view) },
      }, '⭐ 별표만'),
    ),
    books.length ? h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' },
      h('button', {
        class: 'btn btn-sm' + (book === '' ? ' btn-primary' : ''),
        onClick: () => { book = ''; words(view) },
      }, '전체'),
      ...books.map((b) => h('button', {
        class: 'btn btn-sm' + (book === b ? ' btn-primary' : ''),
        onClick: () => { book = b; words(view) },
      }, b)),
    ) : null,
  )

  paint()
}

function comparator(kind) {
  if (kind === 'recent') return (a, b) => (b.lastLookupAt || 0) - (a.lastLookupAt || 0)
  if (kind === 'kana') return (a, b) => a.reading.localeCompare(b.reading, 'ja')
  return (a, b) => (b.lookupCount || 0) - (a.lookupCount || 0) || (b.lastLookupAt || 0) - (a.lastLookupAt || 0)
}

function row(e, repaint) {
  const meta = [
    e.lookupCount > 1 ? `${e.lookupCount}회` : null,
    ago(e.lastLookupAt),
  ].filter(Boolean).join(' · ')

  return h('li', {},
    h('div', { style: 'display:flex;align-items:center;gap:8px' },
      h('button', {
        style: 'flex:1;min-width:0',
        onClick: () => { location.hash = '#/q/' + encodeURIComponent(e.word) },
      },
        h('span', { class: 'w ja' }, e.word),
        h('span', { class: 'r ja' }, e.word === e.reading ? '' : e.reading),
        h('span', { class: 'g' }, e.meanings?.[0] || ''),
      ),
      // 세 번 넘게 찾은 낱말은 안 외워지고 있다는 뜻이다. 눈에 띄게 둔다.
      e.lookupCount >= 3 ? h('span', { class: 'chip', title: `${e.lookupCount}번 찾음` }, '🔥') : null,
      h('button', {
        class: 'btn btn-ghost btn-sm',
        title: '별표',
        onClick: async () => { await setStarred(e.id, !e.starred); e.starred = !e.starred; repaint() },
      }, e.starred ? '⭐' : '☆'),
      h('button', {
        class: 'btn btn-ghost btn-sm',
        title: '지우기',
        onClick: async () => {
          if (!confirm(`${e.word} 을(를) 단어장에서 지울까요?`)) return
          await deleteEntry(e.id)
          invalidateCounts()
          toast('지웠습니다')
          location.reload()
        },
      }, '✕'),
    ),
    meta ? h('div', { class: 'small muted', style: 'padding:0 2px 8px' }, meta) : null,
  )
}
