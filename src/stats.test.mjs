// 근무시간 집계 자체검사
//   node --loader ./_dev/extresolve.mjs src/stats.test.mjs
import assert from "node:assert";
import { memberStats } from "./stats.js";

const DAYS = ["월", "화", "수", "목", "금"];
const cfg = { maxWeeklyHours: 20, maxDailyHours: 8 };
const ts = [
  { label: "09:00~10:00", startH: 9, hours: 1 },
  { label: "10:00~11:00", startH: 10, hours: 1 },
  { label: "17:00~18:00", startH: 17, hours: 1 },
];
const empty = () => Object.fromEntries(DAYS.map(d => [d, ts.map(() => ({ f2: null, f3a: null, f3b: null, f4: null }))]));
const M = (name, extra = {}) => ({ name, classes: [], ...extra });
const row = (st, name) => st.rows.find(r => r.member.name === name);

// 1) 빈 시간표는 전부 0
{
  const st = memberStats([M("가")], empty(), ts, cfg);
  assert.strictEqual(st.rows[0].week, 0);
  assert.strictEqual(st.rows[0].period, 0);
  assert.strictEqual(st.rows[0].days, 0);
  assert.strictEqual(st.total.week, 0);
  assert.deepStrictEqual(st.total.byDay, { 월: 0, 화: 0, 수: 0, 목: 0, 금: 0 });
}

// 2) 요일별 합 = 주간 합, 4주 = 1주 × 4
{
  const s = empty();
  s.월[0].f2 = "가"; s.월[1].f2 = "가";   // 월 2h
  s.수[0].f4 = "가";                      // 수 1h
  const st = memberStats([M("가")], s, ts, cfg);
  const r = st.rows[0];
  assert.deepStrictEqual(r.byDay, { 월: 2, 화: 0, 수: 1, 목: 0, 금: 0 });
  assert.strictEqual(r.week, 3);
  assert.strictEqual(DAYS.reduce((a, d) => a + r.byDay[d], 0), r.week, "요일별 합이 주간 합과 달라짐");
  assert.strictEqual(r.period, 12);      // 3h × 4주
  assert.strictEqual(r.days, 2);         // 월·수 이틀 출근
  assert.strictEqual(r.capPeriod, 80);   // 20h × 4주
}

// 3) 주 수를 바꾸면 기간 합계만 따라 바뀐다
{
  const s = empty();
  s.월[0].f2 = "가";
  assert.strictEqual(memberStats([M("가")], s, ts, cfg, 1).rows[0].period, 1);
  assert.strictEqual(memberStats([M("가")], s, ts, cfg, 4).rows[0].period, 4);
  assert.strictEqual(memberStats([M("가")], s, ts, cfg, 4).rows[0].week, 1, "주간 합계는 주 수와 무관해야 한다");
}

// 4) 저녁(17시~) 시간은 따로 센다
{
  const s = empty();
  s.월[0].f2 = "가";  // 09시 — 주간
  s.월[2].f2 = "가";  // 17시 — 저녁
  const r = memberStats([M("가")], s, ts, cfg).rows[0];
  assert.strictEqual(r.week, 2);
  assert.strictEqual(r.evening, 1);
}

// 5) 한도는 멤버별 주 근무시간, 미설정자는 운영 기본값
{
  const st = memberStats([M("장시간", { weeklyHours: 40 }), M("기본")], empty(), ts, cfg);
  assert.strictEqual(row(st, "장시간").cap, 40);
  assert.strictEqual(row(st, "기본").cap, 20);
  assert.strictEqual(st.total.cap, 60);
}

// 6) 합계는 전원의 합, 명단에 있는 사람만 센다
{
  const s = empty();
  s.월[0].f2 = "가"; s.월[0].f4 = "나"; s.화[0].f2 = "퇴사자";
  const st = memberStats([M("가"), M("나")], s, ts, cfg);
  assert.strictEqual(st.total.week, 2, "명단에 없는 이름은 합계에서 빠져야 한다");
  assert.strictEqual(st.total.byDay["화"], 0);
  assert.strictEqual(st.total.period, 8);
}

// 7) 같은 시각 두 층에 있으면 실제 표대로 두 번 센다 (그 상태는 audit이 잡는 오류)
{
  const s = empty();
  s.월[0].f2 = "가"; s.월[0].f4 = "가";
  assert.strictEqual(memberStats([M("가")], s, ts, cfg).rows[0].week, 2);
}

// 8) 행은 가나다순
{
  const st = memberStats([M("탁연주"), M("강나경"), M("유윤아"), M("윤규완")], empty(), ts, cfg);
  assert.deepStrictEqual(st.rows.map(r => r.member.name), ["강나경", "유윤아", "윤규완", "탁연주"]);
}

console.log("✅ stats 자체검사 통과");
