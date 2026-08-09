// 사전 원본(raw/) → 앱 내장 데이터(public/data/) 정규화.
//
// 원본은 jmdict-simplified 릴리스의 미리 파싱된 JSON을 쓴다. raw/ 는 커밋하지
// 않고 가공 결과만 커밋하므로, CI는 아무것도 내려받지 않는다.
//
// 원본 다시 받기:
//   V="3.6.2%2B20260803141815"
//   B="https://github.com/scriptin/jmdict-simplified/releases/download/$V"
//   curl -sL -o raw/jmdict-eng-common.json.zip "$B/jmdict-eng-common-$V.json.zip"
//   curl -sL -o raw/kanjidic2-en.json.zip      "$B/kanjidic2-en-$V.json.zip"
//   (cd raw && unzip -o -q '*.zip')
//
// 데이터 출처: JMdict / KANJIDIC2 — Electronic Dictionary Research and
// Development Group, CC BY-SA 4.0. 앱 「정보」 화면에 출처를 표기할 것.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RAW = path.join(ROOT, 'raw')
const OUT = path.join(ROOT, 'public', 'data')

// 표제어 하나가 가질 수 있는 뜻 개수 상한. 로컬 표시용 + AI 프롬프트에 넣는
// 힌트용이라 많을수록 좋지 않다 — 용량만 늘고 정확도는 안 오른다.
const MAX_GLOSSES = 5
const MAX_READINGS = 4   // 한자별 음독/훈독 상한
const MAX_MEANINGS = 4   // 한자별 영어 뜻 상한

function findRaw(prefix) {
  if (!fs.existsSync(RAW)) die(`raw/ 디렉터리가 없습니다. 파일 상단 주석의 다운로드 명령을 참조하세요.`)
  const hit = fs.readdirSync(RAW).find((f) => f.startsWith(prefix) && f.endsWith('.json'))
  if (!hit) die(`raw/${prefix}*.json 을 찾지 못했습니다. 압축을 풀었는지 확인하세요.`)
  return path.join(RAW, hit)
}

function die(msg) {
  console.error('오류: ' + msg)
  process.exit(1)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(name, obj) {
  fs.mkdirSync(OUT, { recursive: true })
  const text = JSON.stringify(obj)
  const file = path.join(OUT, name)
  fs.writeFileSync(file, text)
  const gz = zlib.gzipSync(text, { level: 9 }).length
  const mb = (n) => (n / 1024 / 1024).toFixed(2) + 'MB'
  console.log(`  ${name.padEnd(14)} ${mb(text.length).padStart(8)}  (gzip ${mb(gz)})`)
}

// ── JMdict ────────────────────────────────────────────────────────────────
// 항목 하나를 [표기, 읽기, 뜻, 품사] 배열로 눕힌다. 객체 대신 배열을 쓰는
// 이유는 순전히 용량 — 키 이름 반복이 사라지면 30% 넘게 줄어든다.
//
// 표기/읽기는 '|' 로 이어 붙이고 common 인 형태를 앞으로 보낸다. JMdict의
// appliesToKanji(어떤 읽기가 어떤 표기에만 붙는지)는 버린다. 사전을 "찾는" 데는
// 어떤 조합이든 같은 항목으로 도달하면 충분하고, 그 정밀도를 지키려고 구조를
// 복잡하게 만들 값어치가 없다.
function prepWords() {
  const src = findRaw('jmdict-eng-common')
  const j = readJson(src)
  console.log(`JMdict ${j.version} (${j.dictDate}) — 원본 ${j.words.length}항목`)

  const words = []
  for (const e of j.words) {
    const kanji = orderCommonFirst(e.kanji)
    const kana = orderCommonFirst(e.kana)
    if (!kana.forms.length) continue

    const glosses = []
    for (const s of e.sense) {
      for (const g of s.gloss) {
        if (g.lang && g.lang !== 'eng') continue
        const text = clean(g.text, ';')
        if (!glosses.includes(text)) glosses.push(text)
        if (glosses.length >= MAX_GLOSSES) break
      }
      if (glosses.length >= MAX_GLOSSES) break
    }
    if (!glosses.length) continue

    const pos = (e.sense[0]?.partOfSpeech || []).join(',')
    words.push([kanji.forms.join('|'), kana.forms.join('|'), glosses.join(';'), pos, kanji.display])
  }

  console.log(`  → ${words.length}항목 채택`)
  writeJson('words.json', { v: j.version, date: j.dictDate, w: words })
  return words
}

// 표기를 「내세울 만한 것 → 나머지」 순으로 정렬하고, 앞쪽 몇 개가 내세울 만한지
// 개수를 함께 돌려준다.
//
// JMdict는 희귀 표기(rK)와 검색 전용 표기(sK), 옛 가나(oK/ok)를 태그로 구분한다.
// これ의 한자 표기 此れ가 rK인데, 이걸 걸러내지 않으면 「코레」를 찾았을 때
// 표제어가 これ가 아니라 此れ로 뜬다 — 아무도 그렇게 안 쓴다.
// 검색 색인에는 남겨야 하므로(책에서 此れ를 봤을 수 있다) 목록에서 빼지는 않고
// 뒤로 미룬 다음, 표제어로 쓸 수 있는 범위만 개수로 표시한다.
const RARE = new Set(['rK', 'sK', 'oK', 'ok', 'sk'])

function orderCommonFirst(forms) {
  if (!forms || !forms.length) return { forms: [], display: 0 }
  const good = [], rest = []
  for (const f of forms) {
    const rare = (f.tags || []).some((t) => RARE.has(t))
    ;(f.common && !rare ? good : rest).push(clean(f.text, '|'))
  }
  return { forms: [...good, ...rest], display: good.length }
}

// 우리가 구분자로 쓰는 문자가 원문에 섞여 있으면 앱에서 뜻이 반쪽으로 쪼개진다.
// 실제로 JMdict gloss 95개에 세미콜론이 들어있다 — "out (of a ball; in tennis,
// etc.)" 같은 것들. 여기서 한 번 접어두면 앱 쪽은 split만 믿으면 된다.
function clean(text, delim) {
  return String(text).split(delim).join(delim === ';' ? ',' : '/')
}

// ── KANJIDIC2 ─────────────────────────────────────────────────────────────
// 한자별로 [한국음, 음독, 훈독, 영어뜻, 획수, 학년, JLPT, 빈도] 배열.
// korean_h(한글 한자음)가 이 앱의 「한자음 다리」 근거 데이터다 — 한국어 사용자가
// 이미 아는 소리에서 일본 음독으로 건너가는 규칙을 여기서 판정한다.
function prepKanji() {
  const src = findRaw('kanjidic2-en')
  const k = readJson(src)
  console.log(`KANJIDIC2 ${k.version} (${k.dictDate}) — 원본 ${k.characters.length}자`)

  const out = {}
  let withKorean = 0
  for (const c of k.characters) {
    const readings = c.readingMeaning?.groups?.[0]?.readings || []
    const meanings = c.readingMeaning?.groups?.[0]?.meanings || []
    const pick = (type) => readings.filter((r) => r.type === type).map((r) => r.value)

    const kor = pick('korean_h')[0] || ''
    if (kor) withKorean++

    const on = pick('ja_on').slice(0, MAX_READINGS).map((v) => clean(v, '|'))
    const kun = pick('ja_kun').slice(0, MAX_READINGS).map((v) => clean(v, '|'))
    const mean = meanings
      .filter((m) => !m.lang || m.lang === 'en')
      .map((m) => clean(m.value, ';'))
      .slice(0, MAX_MEANINGS)

    // 한국음도 음독도 없는 글자는 이 앱에서 할 수 있는 게 없다.
    if (!kor && !on.length && !kun.length) continue

    out[c.literal] = [
      kor,
      on.join('|'),
      kun.join('|'),
      mean.join(';'),
      c.misc?.strokeCounts?.[0] || 0,
      c.misc?.grade || 0,
      c.misc?.jlptLevel || 0,
      c.misc?.frequency || 0,
    ]
  }

  const n = Object.keys(out).length
  console.log(`  → ${n}자 채택 (한국 한자음 보유 ${withKorean}자, ${Math.round((withKorean / n) * 100)}%)`)
  writeJson('kanji.json', { v: k.version, date: k.dictDate, k: out })
  return out
}

// ── 실행 ──────────────────────────────────────────────────────────────────
console.log('사전 데이터 정규화\n')
const words = prepWords()
console.log('')
const kanji = prepKanji()

// 사후 점검 — 앱이 의존하는 성질이 실제로 성립하는지 여기서 깨뜨려 둔다.
// 데이터가 조용히 어긋난 채 배포되는 것보다 prep 단계에서 죽는 편이 낫다.
console.log('\n점검')
const findWord = (w) => words.find((x) => x[0].split('|').includes(w))
for (const probe of ['経済', '一生懸命', '苺']) {
  const hit = findWord(probe)
  console.log(`  ${probe.padEnd(6)} ${hit ? hit[1].split('|')[0] + ' — ' + hit[2].split(';')[0] : '✗ 없음'}`)
}
for (const [ch, expect] of [['経', '경'], ['学', '학'], ['発', '발'], ['合', '합'], ['心', '심'], ['東', '동']]) {
  const got = kanji[ch]?.[0]
  console.log(`  ${ch} 한국음 ${got || '✗'} ${got === expect ? '' : `(기대 ${expect})`}`)
}

// 구분자가 새어 들어가면 앱에서 뜻 하나가 두 개로 쪼개져 보인다. 조용히
// 지나가면 알아채기 어려운 종류의 손상이라 여기서 막는다.
let leaks = 0
for (const w of words) if (w[0].includes('||') || w[1].includes('||')) leaks++
for (const v of Object.values(kanji)) if (v[1].includes('||') || v[2].includes('||')) leaks++
console.log(`  구분자 충돌 ${leaks === 0 ? '없음' : `✗ ${leaks}건`}`)
if (leaks) process.exit(1)

// 희귀 표기가 표제어로 올라오면 안 된다 (これ의 此れ 같은 것)
const kore = words.find((w) => w[1].split('|')[0] === 'これ')
console.log(`  これ 표제어  ${kore ? (kore[4] > 0 ? kore[0].split('|')[0] : 'これ (가나)') : '✗ 없음'}`)
