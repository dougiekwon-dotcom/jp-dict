// 버전과 업데이트.
//
// PWA는 서비스워커가 앱을 폰에 캐시한다. 새로 배포해도 이미 설치된 폰은
// 다음 방문에 조용히 받아 두었다가 그다음 실행부터 적용하는 게 기본 동작이라,
// 「고쳤는데 폰에서는 왜 그대로지」가 자주 생긴다.
//
// 그래서 두 가지를 밖으로 드러낸다.
//   - 지금 돌고 있는 게 어느 커밋인지 (빌드 때 새겨 넣음)
//   - 새 버전이 있는지 지금 확인하고 바로 적용하기

/* global __APP_COMMIT__, __APP_DATE__, __BUILD_TIME__ */
export const COMMIT = typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : 'dev'
export const COMMIT_DATE = typeof __APP_DATE__ !== 'undefined' ? __APP_DATE__ : ''
export const BUILT_AT = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : ''

// 끝에 +가 붙으면 커밋하지 않은 변경이 섞인 빌드다.
export const isDirty = COMMIT.endsWith('+')

let registration = null
let applyUpdate = null
let waiting = false
const listeners = new Set()

export function bindServiceWorker({ reg, apply }) {
  if (reg) registration = reg
  if (apply) applyUpdate = apply
}

export function markWaiting() {
  waiting = true
  for (const fn of listeners) fn()
}

export const isUpdateWaiting = () => waiting

export function onUpdateState(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// 서버에 새 버전이 있는지 지금 물어본다.
//   'waiting'   내려받아 두었고 적용만 하면 됨
//   'current'   최신
//   'no-sw'     서비스워커가 없음 (개발 서버 등)
export async function checkForUpdate() {
  if (waiting) return 'waiting'
  if (!registration) {
    registration = (await navigator.serviceWorker?.getRegistration?.()) || null
  }
  if (!registration) return 'no-sw'

  await registration.update()
  if (registration.waiting || registration.installing) {
    // installing 중이면 설치가 끝나야 적용할 수 있다. 끝나면 markWaiting이 불린다.
    if (registration.waiting) markWaiting()
    return registration.waiting ? 'waiting' : 'installing'
  }
  return 'current'
}

// 대기 중인 새 버전을 적용하고 새로고침한다.
export async function applyWaitingUpdate() {
  if (applyUpdate) return applyUpdate(true)
  registration?.waiting?.postMessage({ type: 'SKIP_WAITING' })
  location.reload()
}

// 화면에 보여줄 짧은 문자열
export function versionLabel() {
  const when = COMMIT_DATE || BUILT_AT
  const date = when ? new Date(when).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : ''
  return date ? `${COMMIT} · ${date}` : COMMIT
}
