// 손글씨 캔버스.
//
// 기존 사전의 손글씨 입력은 「한 글자 = 한 칸」이다. 획 좌표를 한 글자짜리
// 분류기에 넣는 구조라 여러 자를 쓰려면 한 자씩 끊어 후보를 골라야 한다.
//
// 여기서는 캔버스 전체를 그림 한 장으로 넘긴다. 글자 칸을 나누지 않으니
// 몇 자를 쓰든 상관없고, 획순이 틀려도 흘려 써도 상관없다. 대신 이 파일이
// 할 일은 「보기 좋은 그림 한 장을 만드는 것」뿐이다.

import { h } from './dom.js'

const LINE_WIDTH = 5
const ROW_HEIGHT = 130
const MIN_ROWS = 2
const EXPORT_MAX_WIDTH = 1100     // 판독에 충분하면서 요청이 커지지 않는 선
const EXPORT_PADDING = 24

export function inkpad({ onChange } = {}) {
  const canvas = h('canvas', {
    style: 'width:100%;display:block;touch-action:none;border-radius:12px;background:#fff;border:1px solid var(--line)',
  })
  const ctx = canvas.getContext('2d')

  let strokes = []          // [[{x,y}, ...], ...] — CSS 픽셀 기준
  let drawing = null
  let rows = MIN_ROWS

  // DOM에 붙기 전에는 clientWidth가 0이다. 그 상태로 캔버스를 만들면 획이
  // 엉뚱한 좌표로 들어가므로 부모 폭이라도 빌려 쓴다.
  const cssWidth = () => canvas.clientWidth || canvas.parentElement?.clientWidth || 320
  const cssHeight = () => rows * ROW_HEIGHT

  function resize() {
    const dpr = window.devicePixelRatio || 1
    canvas.style.height = cssHeight() + 'px'
    canvas.width = Math.round(cssWidth() * dpr)
    canvas.height = Math.round(cssHeight() * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    repaint()
  }

  function repaint() {
    ctx.clearRect(0, 0, cssWidth(), cssHeight())

    // 글자 크기를 가늠할 수 있게 옅은 가로줄을 깐다. 내보낼 때는 그리지 않는다.
    ctx.strokeStyle = '#e8e4d8'
    ctx.lineWidth = 1
    for (let r = 1; r < rows; r++) {
      ctx.beginPath()
      ctx.moveTo(0, r * ROW_HEIGHT)
      ctx.lineTo(cssWidth(), r * ROW_HEIGHT)
      ctx.stroke()
    }

    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = LINE_WIDTH
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of strokes) drawStroke(ctx, stroke)
  }

  function drawStroke(target, stroke) {
    if (stroke.length < 2) {
      // 점 하나도 획이다 (「、」같은 것). 안 그리면 사라진다.
      const p = stroke[0]
      target.beginPath()
      target.arc(p.x, p.y, LINE_WIDTH / 2, 0, Math.PI * 2)
      target.fillStyle = target.strokeStyle
      target.fill()
      return
    }
    target.beginPath()
    target.moveTo(stroke[0].x, stroke[0].y)
    for (let i = 1; i < stroke.length; i++) target.lineTo(stroke[i].x, stroke[i].y)
    target.stroke()
  }

  const point = (e) => {
    const r = canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId)
    drawing = [point(e)]
    strokes.push(drawing)
    repaint()
  })

  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return
    const p = point(e)
    const last = drawing[drawing.length - 1]
    // 손가락 입력은 점이 촘촘히 들어온다. 1px 미만은 버려 데이터를 줄인다.
    if (Math.hypot(p.x - last.x, p.y - last.y) < 1) return
    drawing.push(p)
    repaint()
  })

  const end = () => {
    if (!drawing) return
    // 아래쪽에 닿으면 칸을 늘려 준다. 문장을 쓰다 막히지 않게.
    const lowest = Math.max(...drawing.map((p) => p.y))
    drawing = null
    if (lowest > cssHeight() - ROW_HEIGHT * 0.35) { rows++; resize() }
    onChange?.(strokes.length)
  }
  canvas.addEventListener('pointerup', end)
  canvas.addEventListener('pointercancel', end)
  canvas.addEventListener('pointerleave', end)

  // ResizeObserver와 rAF는 탭이 화면에 안 떠 있으면 안 돌 수 있다. 첫 크기를
  // 잡는 일만큼은 그 둘에만 맡기지 않는다 — 크기가 0인 캔버스는 아무것도 못 받는다.
  const ro = new ResizeObserver(() => resize())
  ro.observe(canvas)
  requestAnimationFrame(resize)
  setTimeout(resize, 0)

  return {
    el: canvas,
    refresh: resize,
    get strokeCount() { return strokes.length },
    undo() { strokes.pop(); repaint(); onChange?.(strokes.length) },
    clear() { strokes = []; rows = MIN_ROWS; resize(); onChange?.(0) },

    // 글씨가 있는 영역만 잘라 흰 바탕에 검은 획으로 다시 그린다.
    // 빈 여백을 통째로 넘기면 글자가 그림 안에서 작아져 판독이 나빠진다.
    toPng() {
      if (!strokes.length) return null

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const s of strokes) for (const p of s) {
        if (p.x < minX) minX = p.x
        if (p.y < minY) minY = p.y
        if (p.x > maxX) maxX = p.x
        if (p.y > maxY) maxY = p.y
      }
      const pad = EXPORT_PADDING
      const w = Math.max(1, maxX - minX) + pad * 2
      const hgt = Math.max(1, maxY - minY) + pad * 2
      const scale = Math.min(EXPORT_MAX_WIDTH / w, 3)

      const out = document.createElement('canvas')
      out.width = Math.round(w * scale)
      out.height = Math.round(hgt * scale)
      const o = out.getContext('2d')
      o.fillStyle = '#ffffff'
      o.fillRect(0, 0, out.width, out.height)
      o.setTransform(scale, 0, 0, scale, 0, 0)
      o.translate(pad - minX, pad - minY)
      o.strokeStyle = '#000000'
      o.lineWidth = LINE_WIDTH
      o.lineCap = 'round'
      o.lineJoin = 'round'
      for (const s of strokes) drawStroke(o, s)

      return out.toDataURL('image/png')
    },

    destroy() { ro.disconnect() },
  }
}
