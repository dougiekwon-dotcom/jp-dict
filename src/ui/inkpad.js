// 손글씨 캔버스.
//
// 기존 사전의 손글씨 입력은 「한 글자 = 한 칸」이다. 획 좌표를 한 글자짜리
// 분류기에 넣는 구조라 여러 자를 쓰려면 한 자씩 끊어 후보를 골라야 한다.
//
// 여기서는 캔버스 전체를 그림 한 장으로 넘긴다. 글자 칸을 나누지 않으니
// 몇 자를 쓰든 상관없고, 획순이 틀려도 흘려 써도 상관없다. 대신 이 파일이
// 할 일은 「보기 좋은 그림 한 장을 만드는 것」뿐이다.

import { h } from './dom.js'

const ROW_HEIGHT = 130
const MIN_ROWS = 2
const EXPORT_MAX_WIDTH = 1100     // 판독에 충분하면서 요청이 커지지 않는 선
const EXPORT_PADDING = 24
const ERASE_RADIUS = 16
const HISTORY_MAX = 40

export const PEN_WIDTHS = [3, 5, 8]

export function inkpad({ onChange, penWidth = 5 } = {}) {
  const canvas = h('canvas', {
    style: 'width:100%;display:block;touch-action:none;border-radius:12px;background:#fff;border:1px solid var(--line)',
  })
  const ctx = canvas.getContext('2d')

  let strokes = []          // [{ w, pts: [{x,y},…] }] — CSS 픽셀 기준
  let history = []          // 되돌리기용 스냅샷. 지우개도 되돌릴 수 있어야 한다.
  let drawing = null
  let erasing = false
  let eraserAt = null       // 지우는 위치 표시용
  let rows = MIN_ROWS
  let mode = 'pen'          // 'pen' | 'eraser'
  let width = penWidth

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
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of strokes) drawStroke(ctx, s)

    // 지우는 동안 어디가 지워지는지 보여준다. 안 보이면 감으로 지워야 한다.
    if (eraserAt) {
      ctx.save()
      ctx.strokeStyle = '#c0392b'
      ctx.setLineDash([4, 4])
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(eraserAt.x, eraserAt.y, ERASE_RADIUS, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }
  }

  function drawStroke(target, stroke) {
    const pts = stroke.pts
    target.lineWidth = stroke.w
    if (pts.length < 2) {
      // 점 하나도 획이다 (「、」같은 것). 안 그리면 사라진다.
      const p = pts[0]
      target.beginPath()
      target.arc(p.x, p.y, stroke.w / 2, 0, Math.PI * 2)
      target.fillStyle = target.strokeStyle
      target.fill()
      return
    }
    target.beginPath()
    target.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) target.lineTo(pts[i].x, pts[i].y)
    target.stroke()
  }

  const point = (e) => {
    const r = canvas.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function snapshot() {
    history.push(strokes.map((s) => ({ w: s.w, pts: s.pts })))
    if (history.length > HISTORY_MAX) history.shift()
  }

  // 스타일러스는 지우개 쪽으로 뒤집어 쓰거나 옆 버튼을 누른 채 그으면
  // 지우개로 쓰는 것이 보통이다. 브라우저가 그걸 알려주므로 그대로 따른다.
  //   buttons & 32 : 지우개 촉,  buttons & 2 : 배럴(옆) 버튼
  function wantsErase(e) {
    if (mode === 'eraser') return true
    if (e.pointerType !== 'pen') return false
    return (e.buttons & 32) !== 0 || (e.buttons & 2) !== 0 || e.button === 5
  }

  // 지우개가 지나간 자리에 걸친 획을 통째로 지운다. 획의 일부만 깎아내는 것보다
  // 예측 가능하고, 글자를 다시 쓰는 것이 어차피 더 빠르다.
  function eraseAt(p) {
    const before = strokes.length
    strokes = strokes.filter((s) => !s.pts.some((q) => {
      const dx = q.x - p.x, dy = q.y - p.y
      return dx * dx + dy * dy <= (ERASE_RADIUS + s.w / 2) ** 2
    }))
    return strokes.length !== before
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture?.(e.pointerId)
    snapshot()
    erasing = wantsErase(e)
    const p = point(e)
    if (erasing) {
      eraserAt = p
      eraseAt(p)
      repaint()
      onChange?.(strokes.length)
      return
    }
    drawing = { w: width, pts: [p] }
    strokes.push(drawing)
    repaint()
  })

  canvas.addEventListener('pointermove', (e) => {
    if (erasing) {
      const p = point(e)
      eraserAt = p
      const changed = eraseAt(p)
      repaint()
      if (changed) onChange?.(strokes.length)
      return
    }
    if (!drawing) return
    const p = point(e)
    const last = drawing.pts[drawing.pts.length - 1]
    // 손가락 입력은 점이 촘촘히 들어온다. 1px 미만은 버려 데이터를 줄인다.
    if (Math.hypot(p.x - last.x, p.y - last.y) < 1) return
    drawing.pts.push(p)
    repaint()
  })

  const end = () => {
    if (erasing) {
      erasing = false
      eraserAt = null
      repaint()
      return
    }
    if (!drawing) return
    // 아래쪽에 닿으면 칸을 늘려 준다. 문장을 쓰다 막히지 않게.
    const lowest = Math.max(...drawing.pts.map((p) => p.y))
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
    get mode() { return mode },
    get penWidth() { return width },

    setMode(next) { mode = next === 'eraser' ? 'eraser' : 'pen' },
    setPenWidth(w) { width = w },

    undo() {
      if (!history.length) return
      strokes = history.pop()
      repaint()
      onChange?.(strokes.length)
    },

    clear() {
      snapshot()
      strokes = []
      rows = MIN_ROWS
      resize()
      onChange?.(0)
    },

    // 글씨가 있는 영역만 잘라 흰 바탕에 검은 획으로 다시 그린다.
    // 빈 여백을 통째로 넘기면 글자가 그림 안에서 작아져 판독이 나빠진다.
    toPng() {
      if (!strokes.length) return null

      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const s of strokes) for (const p of s.pts) {
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
      o.lineCap = 'round'
      o.lineJoin = 'round'
      for (const s of strokes) drawStroke(o, s)

      return out.toDataURL('image/png')
    },

    destroy() { ro.disconnect() },
  }
}
