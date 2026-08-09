// 규칙 회귀 테스트.  실행: npm test
//
// 이 앱의 어려운 부분은 UI가 아니라 규칙이다 — 한자음 받침 대응, 음독 조합,
// 한글→가나 후보 생성, 결과 순위. 전부 순수 계산이라 브라우저 없이 돌릴 수 있고,
// 사전 데이터가 갱신될 때 조용히 어긋나는 것을 여기서 잡는다.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as dict from '../src/core/dict.js'
import { wordBridge, bridgeChar, guessReading } from '../src/core/hanja.js'
import { hangulToKana, hangulToKanjiWords, romajiToKana } from '../src/core/hangul2kana.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', f), 'utf8'))

dict.loadFromData(read('words.json'), read('kanji.json'))

let pass = 0, fail = 0
const failures = []

function check(group, label, ok, detail = '') {
  if (ok) pass++
  else { fail++; failures.push(`${group} — ${label}${detail ? '  ' + detail : ''}`) }
}

function section(name) {
  process.stdout.write(`\n${name}\n`)
}

// ── 사전 검색 ─────────────────────────────────────────────────────────────
section('사전 검색')
{
  const first = (q) => dict.search(q, { limit: 5 })[0]?.entry
  const cases = [
    ['経済', '経済', 'けいざい'],
    ['けいざい', '経済', 'けいざい'],
    ['苺', '苺', 'いちご'],
    // 珈琲는 희귀 표기(rK)라 표제어로 쓰지 않는다
    ['コーヒー', 'コーヒー', 'コーヒー'],
    ['こーひー', 'コーヒー', 'コーヒー'],   // 가타카나 접기
    ['食べ', '食べる', 'たべる'],       // 접두사
    ['一生懸命', '一生懸命', 'いっしょうけんめい'],
  ]
  for (const [q, word, reading] of cases) {
    const e = first(q)
    check('검색', q, e?.word === word && e?.reading === reading, `→ ${e ? e.word + ' ' + e.reading : '없음'}`)
  }
  check('검색', '없는 말은 빈 결과', dict.search('ざじゅげ').length === 0)
}

// ── 한자음 받침 대응 ──────────────────────────────────────────────────────
section('한자음 받침 대응')
{
  const cases = [
    ['学', '학', 'ㄱ'], ['石', '석', 'ㄱ'], ['発', '발', 'ㄹ'], ['日', '일', 'ㄹ'],
    ['合', '합', 'ㅂ'], ['十', '십', 'ㅂ'], ['答', '답', 'ㅂ'], ['心', '심', 'ㅁ'],
    ['山', '산', 'ㄴ'], ['天', '천', 'ㄴ'], ['東', '동', 'ㅇ'], ['京', '경', 'ㅇ'],
    ['明', '명', 'ㅇ'], ['思', '사', '없음'], ['道', '도', '없음'],
  ]
  for (const [ch, korean, tag] of cases) {
    const b = bridgeChar(ch)
    check('받침', `${ch} ${korean} ${tag}`, b?.korean === korean && !!b?.rule,
      `→ ${b?.korean} ${b?.matchedOn} ${b?.rule || '규칙 미적용'}`)
  }
}

// ── 한자음 다리 판정 ──────────────────────────────────────────────────────
section('한자음 다리 판정')
{
  // 음독어 — 다리가 떠야 한다
  const on = [
    ['経済', 'けいざい'], ['学生', 'がくせい'], ['発表', 'はっぴょう'], ['心配', 'しんぱい'],
    ['東京', 'とうきょう'], ['準備', 'じゅんび'], ['説明', 'せつめい'], ['一日', 'いちにち'],
    ['出発', 'しゅっぱつ'], ['雑誌', 'ざっし'], ['学校', 'がっこう'], ['天気', 'てんき'],
    ['十分', 'じゅうぶん'], ['文学', 'ぶんがく'], ['自然', 'しぜん'],
  ]
  for (const [w, r] of on) check('다리', `${w} 떠야 함`, wordBridge(w, r)?.onReading === true)

  // 훈독·혼합 — 다리를 대면 오히려 헷갈린다
  const kun = [
    ['山', 'やま'], ['国', 'くに'], ['食べる', 'たべる'], ['大人', 'おとな'],
    ['今日', 'きょう'], ['手紙', 'てがみ'], ['花見', 'はなみ'], ['日本', 'にほん'],
  ]
  for (const [w, r] of kun) check('다리', `${w} 뜨면 안 됨`, wordBridge(w, r)?.onReading === false)

  // 소리 변화에 이름이 붙는지
  check('다리', '経済 연탁', /연탁/.test(wordBridge('経済', 'けいざい')?.note || ''))
  check('다리', '発表 촉음화', /촉음/.test(wordBridge('発表', 'はっぴょう')?.note || ''))
  check('다리', '心配 반탁음화', /반탁/.test(wordBridge('心配', 'しんぱい')?.note || ''))
}

// ── 읽기 추정 ─────────────────────────────────────────────────────────────
section('읽기 추정')
{
  // 「つ·ち·く·き + は행 → っ + ぱ행」은 사실상 의무 규칙이라 1순위여야 한다
  check('추정', '発表 1순위 はっぴょう', guessReading('発表', 1)[0] === 'はっぴょう')
  check('추정', '出発 1순위 しゅっぱつ', guessReading('出発', 1)[0] === 'しゅっぱつ')
  check('추정', 'っ+は행 후보 없음', !guessReading('発表', 10).some((r) => /っ[はひふへほ]/.test(r)))
  // 단어 빈도 데이터가 없어 1순위까지는 못 맞히지만 후보 안에는 있어야 한다
  check('추정', '逼迫 후보에 ひっぱく 포함', guessReading('逼迫', 20).includes('ひっぱく'))
}

// ── 한글 발음 입력 ────────────────────────────────────────────────────────
section('한글 발음 입력')
{
  // 앱의 lookupKorean과 같은 순서로 합친다
  const lookup = (q) => {
    const seen = new Set(), out = []
    const take = (hits) => { for (const x of hits) if (!seen.has(x.entry.i)) { seen.add(x.entry.i); out.push(x.entry) } }
    const words = hangulToKanjiWords(q)
    if (words.length) take(dict.searchAny(words, { limit: 10 }))
    const kana = hangulToKana(q)
    if (kana.length) take(dict.searchAny(kana, { limit: 10 }))
    return out
  }

  const hanja = [
    ['경제', '経済'], ['학생', '学生'], ['시간', '時間'], ['학교', '学校'], ['선생', '先生'],
    ['신문', '新聞'], ['회사', '会社'], ['자동차', '自動車'], ['질문', '質問'],
    ['음악', '音楽'], ['운동', '運動'], ['교토', '京都'], ['도서관', '図書館'],
    // 두음법칙 — 사전에는 려행·리해·료리·로동으로 들어있다
    ['여행', '旅行'], ['이해', '理解'], ['요리', '料理'], ['노동', '労働'], ['유행', '流行'],
  ]
  for (const [q, want] of hanja) {
    const got = lookup(q)[0]
    check('한자음', q, got?.word === want, `→ ${got?.word ?? '없음'}`)
  }

  // 단어 단위 빈도 데이터가 없어 1순위까지는 못 맞히는 동음 한자어들.
  // 후보 안에는 반드시 있어야 하고(사용자가 눈으로 고를 수 있어야 하고),
  // 한 번 고르고 나면 조회 로그가 영구히 위로 올려준다.
  //  영화 → 英和 / 映画,  전화 → 電化 / 電話,  연습 → 演習 / 練習,
  //  역사 → 力士 / 歴史,  입장 → 入場 / 立場
  const nearMiss = [
    ['영화', '映画'], ['전화', '電話'], ['연습', '練習'], ['역사', '歴史'], ['입장', '立場'],
  ]
  for (const [q, want] of nearMiss) {
    const words = lookup(q).slice(0, 6).map((e) => e.word)
    check('한자음(차선)', `${q} 후보 6개 안에 ${want}`, words.includes(want), `→ ${words.join(' ')}`)
  }

  const phonetic = [
    ['도쿄', '東京'], ['오사카', '大阪'], ['이치고', '苺'], ['아리가토', 'ありがとう'],
    ['잣시', '雑誌'], ['코레', 'これ'], ['다베루', '食べる'], ['미즈', '水'], ['야마', '山'],
  ]
  for (const [q, want] of phonetic) {
    const got = lookup(q)[0]
    check('표음', q, got?.word === want, `→ ${got?.word ?? '없음'}`)
  }

  check('로마자', 'gakkou', romajiToKana('gakkou') === 'がっこう', `→ ${romajiToKana('gakkou')}`)
  check('로마자', 'korewa', romajiToKana('korewa') === 'これわ', `→ ${romajiToKana('korewa')}`)
  check('로마자', 'shinbun', romajiToKana('shinbun') === 'しんぶん', `→ ${romajiToKana('shinbun')}`)
  check('로마자', '읽을 수 없는 건 빈 값', romajiToKana('qqzz') === '')
}

// ── 장음 골격 ─────────────────────────────────────────────────────────────
section('장음 골격')
{
  const cases = [
    ['とうきょう', 'ときょ'], ['おおさか', 'おさか'], ['がっこう', 'がっこ'],
    ['けいざい', 'けいざい'],   // え단 뒤 い는 남긴다 — 한국어 표기에도 살아있다
    ['コーヒー', 'こひ'],
  ]
  for (const [input, want] of cases) {
    check('골격', input, dict.skeleton(input) === want, `→ ${dict.skeleton(input)}`)
  }
}

// ── 조회 순위 ─────────────────────────────────────────────────────────────
section('조회 순위')
{
  // rankFn(내 조회 횟수)이 사전 쪽 신호를 눌러야 한다.
  // 「전화」는 단어 빈도 데이터가 없어 기본값으로는 電化가 앞서지만,
  // 사용자가 電話를 고른 적이 있으면 그쪽이 올라와야 한다.
  const words = hangulToKanjiWords('전화')
  const before = dict.searchAny(words, { limit: 5 })[0]?.entry.word
  const after = dict.searchAny(words, {
    limit: 5,
    rankFn: (e) => (e.word === '電話' ? 3 : 0),
  })[0]?.entry.word
  check('순위', '기본 순서에 電話 포함', words.includes('電話'))
  check('순위', '내 조회 횟수가 순위를 뒤집는다', after === '電話', `기본 ${before} → 조회후 ${after}`)
}

// ── 결과 ──────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50))
if (fail) {
  console.log(`실패 ${fail}건\n`)
  for (const f of failures) console.log('  ✗ ' + f)
  console.log(`\n${pass}/${pass + fail} 통과`)
  process.exit(1)
}
console.log(`${pass}/${pass + fail} 통과`)
