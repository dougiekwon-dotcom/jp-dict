// 최소 해시 라우터. 화면은 #view 안에 그려지고 탭바는 그대로 있는다.

import { search } from './screens/search.js'
import { words } from './screens/words.js'
import { review } from './screens/review.js'
import { stats } from './screens/stats.js'
import { settings } from './screens/settings.js'

const routes = [
  { re: /^#\/?$/, screen: search, tab: 'search' },
  { re: /^#\/q\/([^?]+)/, screen: search, tab: 'search', param: 'q' },
  { re: /^#\/words/, screen: words, tab: 'words' },
  { re: /^#\/review/, screen: review, tab: 'review' },
  { re: /^#\/stats/, screen: stats, tab: 'stats' },
  { re: /^#\/settings/, screen: settings, tab: 'settings' },
]

function parseQuery(hash) {
  const qi = hash.indexOf('?')
  const q = {}
  if (qi >= 0) new URLSearchParams(hash.slice(qi + 1)).forEach((v, k) => (q[k] = v))
  return q
}

let currentCleanup = null

async function render() {
  const hash = location.hash || '#/'
  const match = routes.find((r) => r.re.test(hash)) || routes[0]
  const m = hash.match(match.re)
  const params = { query: parseQuery(hash) }
  if (match.param && m && m[1]) params[match.param] = decodeURIComponent(m[1].split('?')[0])

  if (typeof currentCleanup === 'function') { try { currentCleanup() } catch {} }
  currentCleanup = null

  const view = document.getElementById('view')
  view.scrollTop = 0
  setActiveTab(match.tab)

  try {
    currentCleanup = await match.screen(view, params)
  } catch (err) {
    console.error(err)
    view.replaceChildren()
    const p = document.createElement('div')
    p.className = 'card'
    p.textContent = '오류: ' + (err?.message || err)
    view.appendChild(p)
  }
}

function setActiveTab(tab) {
  document.querySelectorAll('.tabbar a').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === tab)
  })
}

export function startRouter() {
  window.addEventListener('hashchange', render)
  render()
}
