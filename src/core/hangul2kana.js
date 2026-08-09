// 한글 발음 → 일본어. 두 갈래가 있고 둘 다 시도한다.
//
//  (A) 표음  「코레와」 → これは       — 귀로 들은 소리를 그대로 적은 경우
//  (B) 한자음「경제」   → 経済         — 한국 한자음으로 읽은 경우
//
// 한글→가나는 1:多 대응이라 후보를 여러 개 만든 뒤 **사전과 교차**시킨다.
// 사전에 있는 후보만 살아남으므로, 표를 느슨하게 만들어도 결과는 정확해진다.
// 장음은 후보에 넣지 않는다 — 한국식 표기에 장음이 없기 때문이고(도쿄),
// 그쪽은 dict.js의 골격 색인이 받아준다.

import { kanjiByKorean, hasForm } from './dict.js'

// 가나 → 한국어로 흔히 적는 표기. 이 방향으로 적어야 빠뜨리는 게 적어서
// 이렇게 두고 아래에서 뒤집는다.
const KANA_KO = {
  あ: '아', い: '이', う: '우', え: '에', お: '오',
  か: '카,가', き: '키,기', く: '쿠,구', け: '케,게', こ: '코,고',
  が: '가', ぎ: '기', ぐ: '구', げ: '게', ご: '고',
  さ: '사', し: '시', す: '스,수', せ: '세', そ: '소',
  ざ: '자', じ: '지', ず: '즈,주', ぜ: '제', ぞ: '조',
  た: '타,다', ち: '치,찌', つ: '츠,쓰,쯔', て: '테,데', と: '토,도',
  だ: '다', ぢ: '지', づ: '즈', で: '데', ど: '도',
  な: '나', に: '니', ぬ: '누', ね: '네', の: '노',
  は: '하', ひ: '히', ふ: '후,흐', へ: '헤', ほ: '호',
  ば: '바', び: '비', ぶ: '부', べ: '베', ぼ: '보',
  ぱ: '파', ぴ: '피', ぷ: '푸', ぺ: '페', ぽ: '포',
  ま: '마', み: '미', む: '무', め: '메', も: '모',
  や: '야', ゆ: '유', よ: '요',
  ら: '라', り: '리', る: '루', れ: '레', ろ: '로',
  わ: '와', を: '오,워',
  きゃ: '캬,갸', きゅ: '큐,규', きょ: '쿄,교',
  ぎゃ: '갸', ぎゅ: '규', ぎょ: '교',
  しゃ: '샤', しゅ: '슈', しょ: '쇼',
  じゃ: '자,쟈', じゅ: '주,쥬', じょ: '조,죠',
  ちゃ: '차,챠', ちゅ: '추,츄', ちょ: '초,쵸',
  にゃ: '냐', にゅ: '뉴', にょ: '뇨',
  ひゃ: '햐', ひゅ: '휴', ひょ: '효',
  びゃ: '뱌', びゅ: '뷰', びょ: '뵤',
  ぴゃ: '퍄', ぴゅ: '퓨', ぴょ: '표',
  みゃ: '먀', みゅ: '뮤', みょ: '묘',
  りゃ: '랴', りゅ: '류', りょ: '료',
}

// 한국어 음절 → 가나 후보
const KO_KANA = new Map()
for (const [kana, spellings] of Object.entries(KANA_KO)) {
  for (const ko of spellings.split(',')) {
    const bucket = KO_KANA.get(ko)
    if (bucket) bucket.push(kana)
    else KO_KANA.set(ko, [kana])
  }
}
// 「응·은」은 ん 한 글자로 쓰인다.
KO_KANA.set('응', ['ん'])
KO_KANA.set('은', ['ん'])

// 조사는 표기와 소리가 다르다. は를 「와」, へ를 「에」로 듣고 적는 게 정상이므로
// 그 표기도 받아준다. 어차피 사전과 교차하니 헛후보는 알아서 걸러진다.
KO_KANA.get('와').push('は')
KO_KANA.get('에').push('へ')

// ── 한글 음절 분해 ────────────────────────────────────────────────────────
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ',
  'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']

const isHangulSyllable = (ch) => {
  const c = ch.codePointAt(0)
  return c >= 0xac00 && c <= 0xd7a3
}

// 받침을 뗀 음절과 받침을 나눠서 돌려준다. 「갓」 → ['가', 'ㅅ']
function splitFinal(ch) {
  const c = ch.codePointAt(0) - 0xac00
  const jong = c % 28
  if (!jong) return [ch, '']
  return [String.fromCodePoint(0xac00 + (c - jong)), JONG[jong]]
}

// ── 두음법칙 ──────────────────────────────────────────────────────────────
// 한국어는 낱말 첫머리의 ㄹ·ㄴ을 바꿔 읽는다. 練習은 「련습」이지만 「연습」으로,
// 旅行은 「려행」이지만 「여행」으로 적는다. KANJIDIC은 바뀌기 전 음(련·려)을
// 담고 있으므로, 사용자가 친 첫 음절은 원래 음으로 되돌려서도 찾아봐야 한다.
// 이게 없으면 연습·여행·이해·요리·노동 같은 아주 흔한 말이 통째로 안 잡힌다.
const CHO_R = 5      // ㄹ
const CHO_N = 2      // ㄴ
const CHO_IEUNG = 11 // ㅇ
const Y_VOWELS = new Set([2, 3, 6, 7, 12, 17, 20])   // ㅑ ㅒ ㅕ ㅖ ㅛ ㅠ ㅣ

function withInitial(syllable, cho) {
  const c = syllable.codePointAt(0) - 0xac00
  return String.fromCodePoint(0xac00 + (cho * 21 + Math.floor(c / 28) % 21) * 28 + (c % 28))
}

// 사용자가 친 음절 → 사전에 있을 법한 음절들 (자기 자신 포함)
export function initialSoundVariants(syllable) {
  const c = syllable.codePointAt(0) - 0xac00
  const cho = Math.floor(c / 28 / 21)
  const jung = Math.floor(c / 28) % 21

  if (cho === CHO_IEUNG && Y_VOWELS.has(jung)) {
    // 여 → 려·녀,  요 → 료·뇨,  이 → 리·니
    return [syllable, withInitial(syllable, CHO_R), withInitial(syllable, CHO_N)]
  }
  if (cho === CHO_N) {
    // 노 → 로,  내 → 래,  능 → 릉
    return [syllable, withInitial(syllable, CHO_R)]
  }
  return [syllable]
}

// 받침이 가나에서 무엇이 되는지.
//   ㄴ·ㅁ·ㅇ → ん      (신주쿠 → しんじゅく)
//   막힌 소리 → っ     (갓코 → がっこ, 잣시 → ざっし)
//   ㄹ        → 없음   (일본어를 한글로 적을 때 ㄹ 받침은 안 나온다)
function finalKana(jong) {
  if (!jong) return ''
  if ('ㄴㅁㅇ'.includes(jong)) return 'ん'
  if ('ㄱㄲㅅㅆㅂㄷㅈㅊㅋㅌㅍ'.includes(jong)) return 'っ'
  return ''
}

// ── (A) 표음 변환 ─────────────────────────────────────────────────────────
const MAX_CANDIDATES = 300

export function hangulToKana(text) {
  const syllables = [...String(text)].filter(isHangulSyllable)
  if (!syllables.length) return []

  let acc = ['']
  for (const syl of syllables) {
    const [base, jong] = splitFinal(syl)
    const kanas = KO_KANA.get(base)
    if (!kanas) return []            // 표에 없는 음절이 하나라도 있으면 표음 경로 포기
    const suffix = finalKana(jong)

    const next = []
    for (const sofar of acc) {
      for (const kana of kanas) {
        next.push(sofar + kana + suffix)
        if (next.length >= MAX_CANDIDATES) break
      }
      if (next.length >= MAX_CANDIDATES) break
    }
    acc = next
  }
  return acc
}

// ── (B) 한자음 변환 ───────────────────────────────────────────────────────
// 「경제」의 각 음절을 그 소리를 가진 한자로 펼친 뒤, 조합이 실제로 사전에 있는
// 표기인지 확인한다. 한자 조합은 금방 불어나므로 흔한 한자부터 잘라 쓰고
// 사전에 없는 조합은 그 자리에서 버린다.
// 음절이 늘면 조합은 거듭제곱으로 불어난다. 음절 수에 따라 음절당 한자 수를
// 줄여서 총량을 붙잡아 둔다 (한자 목록은 흔한 것부터라 뒤를 잘라도 손해가 적다).
// 「도서관」이 3음절인데 30^3 = 27,000이라 예전 상한에 걸려 통째로 버려졌다.
const PER_SYLLABLE = { 1: 60, 2: 40, 3: 25, 4: 15 }
const MAX_KANJI_COMBOS = 60000

// 여러 목록에서 번갈아 하나씩 뽑아 하나로 합친다 (중복 제거).
function interleave(lists) {
  const out = []
  const seen = new Set()
  const max = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      const ch = list[i]
      if (ch && !seen.has(ch)) { seen.add(ch); out.push(ch) }
    }
  }
  return out
}

export function hangulToKanjiWords(text) {
  const syllables = [...String(text)].filter(isHangulSyllable)
  const cap = PER_SYLLABLE[syllables.length]
  if (!syllables.length || !cap) return []

  // 첫 음절만 두음법칙을 되돌려 본다 (연습 → 련습). 뒷 음절은 원음 그대로다.
  //
  // 변형 목록을 그냥 뒤에 이어 붙이면 상한에 잘려 통째로 사라진다 — 「요」에
  // 딸린 한자가 40자를 넘으면 「료」의 料가 잘려나가 料理를 못 찾는다.
  // 각 목록은 이미 흔한 순이므로 번갈아 뽑아 양쪽 다 살린다.
  const lists = syllables.map((s, i) => {
    const forms = i === 0 ? initialSoundVariants(s) : [s]
    return interleave(forms.map(kanjiByKorean)).slice(0, cap)
  })
  if (lists.some((l) => !l.length)) return []

  const total = lists.reduce((n, l) => n * l.length, 1)
  if (total > MAX_KANJI_COMBOS) return []

  let acc = ['']
  for (const list of lists) {
    const next = []
    for (const sofar of acc) for (const ch of list) next.push(sofar + ch)
    acc = next
  }
  return acc.filter(hasForm)
}

// ── 로마자 ────────────────────────────────────────────────────────────────
// 표 하나 더 두는 값으로 얻는 덤. 「korewa」도 받아준다.
const ROMAJI = {
  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ', gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
  sha: 'しゃ', shu: 'しゅ', sho: 'しょ', sya: 'しゃ', syu: 'しゅ', syo: 'しょ',
  ja: 'じゃ', ju: 'じゅ', jo: 'じょ', jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ',
  cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ', tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ',
  nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ', hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
  bya: 'びゃ', byu: 'びゅ', byo: 'びょ', pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
  mya: 'みゃ', myu: 'みゅ', myo: 'みょ', rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
  shi: 'し', chi: 'ち', tsu: 'つ', fu: 'ふ', ji: 'じ',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  sa: 'さ', si: 'し', su: 'す', se: 'せ', so: 'そ',
  za: 'ざ', zi: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ta: 'た', ti: 'ち', tu: 'つ', te: 'て', to: 'と',
  da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', hu: 'ふ', he: 'へ', ho: 'ほ',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  wa: 'わ', wo: 'を', a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お', n: 'ん',
}

export function romajiToKana(text) {
  let s = String(text).toLowerCase().replace(/[^a-z]/g, '')
  let out = ''
  while (s) {
    // 같은 자음이 겹치면 촉음 (gakkou → がっこう)
    if (s.length > 1 && s[0] === s[1] && !'aiueon'.includes(s[0])) {
      out += 'っ'
      s = s.slice(1)
      continue
    }
    let hit = null
    for (const len of [3, 2, 1]) {
      const head = s.slice(0, len)
      if (ROMAJI[head]) { hit = [head, ROMAJI[head]]; break }
    }
    if (!hit) return ''            // 읽을 수 없는 조각이 나오면 로마자가 아니다
    out += hit[1]
    s = s.slice(hit[0].length)
  }
  return out
}
