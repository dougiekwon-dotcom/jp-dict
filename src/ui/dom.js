// 프레임워크 없이 구조를 잡기 위한 최소 DOM 헬퍼.

export function h(tag, props = {}, ...children) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue
    if (k === 'class') e.className = v
    else if (k === 'html') e.innerHTML = v
    else if (k === 'dataset') Object.assign(e.dataset, v)
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k in e && k !== 'list') { try { e[k] = v } catch { e.setAttribute(k, v) } }
    else e.setAttribute(k, v)
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue
    e.append(c.nodeType ? c : document.createTextNode(String(c)))
  }
  return e
}

export function clear(node) {
  node.replaceChildren()
  return node
}

export function go(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'))
  else location.hash = hash
}

let toastTimer = null
export function toast(msg, kind = '') {
  let t = document.getElementById('toast')
  if (!t) {
    t = h('div', { id: 'toast', class: 'toast' })
    document.body.appendChild(t)
  }
  t.className = 'toast show ' + kind
  t.textContent = msg
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.className = 'toast' }, 2400)
}

// 「2주 전」처럼 사람이 읽는 상대 시간. 재조회 배지와 단어장 목록에서 쓴다.
export function ago(ts) {
  if (!ts) return ''
  const sec = Math.max(0, (Date.now() - ts) / 1000)
  if (sec < 60) return '방금'
  const min = sec / 60
  if (min < 60) return `${Math.floor(min)}분 전`
  const hr = min / 60
  if (hr < 24) return `${Math.floor(hr)}시간 전`
  const day = hr / 24
  if (day < 7) return `${Math.floor(day)}일 전`
  if (day < 31) return `${Math.floor(day / 7)}주 전`
  if (day < 365) return `${Math.floor(day / 30)}개월 전`
  return `${Math.floor(day / 365)}년 전`
}
