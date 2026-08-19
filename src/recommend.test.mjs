// 추천 로직 자체검사 — 확장자 해석 로더가 필요하다 (src가 확장자 없이 import 하므로)
//   node --loader ./_dev/extresolve.mjs src/recommend.test.mjs
import assert from "node:assert";
import { recommend, audit } from "./recommend.js";

const cfg = { maxWeeklyHours: 20, maxDailyHours: 8 };
const ts = [
  { label: "09:00~10:00", startH: 9, hours: 1 },
  { label: "10:00~11:00", startH: 10, hours: 1 },
  { label: "17:00~18:00", startH: 17, hours: 1 },
];
const empty = () => ({ 월: ts.map(() => ({ f2: null, f3a: null, f3b: null, f4: null })), 화: ts.map(() => ({})), 수: ts.map(() => ({})), 목: ts.map(() => ({})), 금: ts.map(() => ({})) });
const M = (name, extra = {}) => ({ name, classes: [], ...extra });
const find = (rows, name) => rows.find(r => r.member.name === name);

// 1) 수업 중이면 불가 사유가 붙는다
{
  const m = M("수업생", { classes: [{ day: "월", startHour: 9, startMin: 0, endHour: 10, endMin: 0 }] });
  const rows = recommend([m], empty(), ts, cfg, "월", 0, "f2");
  assert.deepStrictEqual(find(rows, "수업생").blocked, ["수업 중"]);
  // 겹치지 않는 슬롯은 통과
  assert.deepStrictEqual(recommend([m], empty(), ts, cfg, "월", 1, "f2")[0].blocked, []);
}

// 2) 같은 시간 다른 층에 이미 있으면 불가
{
  const s = empty();
  s.월[0].f4 = "중복";
  const rows = recommend([M("중복")], s, ts, cfg, "월", 0, "f2");
  assert.ok(find(rows, "중복").blocked.includes("같은 시간 타 층"));
}

// 3) 4층 1순위는 2층에 못 간다 — 단 2순위가 2층이면 허용
{
  const s = empty();
  assert.ok(recommend([M("사층", { preferFloor1: "4층" })], s, ts, cfg, "월", 0, "f2")[0].blocked.includes("4층 담당"));
  assert.deepStrictEqual(recommend([M("사층2", { preferFloor1: "4층", preferFloor2: "2층" })], s, ts, cfg, "월", 0, "f2")[0].blocked, []);
  assert.deepStrictEqual(recommend([M("사층3", { preferFloor1: "4층" })], s, ts, cfg, "월", 0, "f3a")[0].blocked, []);
}

// 4) 주/일 한도 초과는 불가 — 편집 중인 칸에 본인이 이미 있으면 이중 계산하지 않는다
{
  const s = empty();
  const days = ["월", "화", "수", "목", "금"];
  days.forEach(d => { s[d] = ts.map(() => ({ f2: null, f3a: null, f3b: null, f4: null })); });
  // 화~금 각 3시간 = 12h, 월 0~1슬롯 2h → 14h. 남은 6h
  ["화", "수", "목", "금"].forEach(d => ts.forEach((_, i) => { s[d][i].f2 = "만근"; }));
  s.월[0].f2 = "만근"; s.월[1].f2 = "만근";
  const m = M("만근");
  assert.strictEqual(find(recommend([m], s, ts, cfg, "월", 2, "f2"), "만근").remain, 6);
  // 이미 본인이 있는 칸을 다시 평가하면 그 칸을 뺀 14h가 아니라 13h 기준(= 그 칸 1h 제외)
  assert.strictEqual(find(recommend([m], s, ts, cfg, "월", 1, "f2"), "만근").remain, 7);

  const cfgTight = { ...cfg, maxWeeklyHours: 14 };
  assert.ok(find(recommend([m], s, ts, cfgTight, "월", 2, "f2"), "만근").blocked.includes("주 14h 초과"));
  const cfgDay = { ...cfg, maxDailyHours: 2 };
  assert.ok(find(recommend([m], s, ts, cfgDay, "월", 2, "f2"), "만근").blocked.includes("일 2h 초과"));
}

// 5) 가점이 실제 점수에 반영되는지 — 다른 조건을 모두 같게 두고 점수 차를 직접 잰다
//    (순위만 보면 다른 가점에 얹혀 통과해버린다. 실제로 그래서 한 번 놓쳤음)
{
  // 5a) 이어서 근무 +3: 둘 다 그날 1h씩 근무해 remain·출근 조건을 동일하게 맞추고, 인접 여부만 다르게
  const s = empty();
  s.월[0].f2 = "붙음";   // 평가 대상 칸(si=1, f2)의 바로 앞 칸
  s.월[0].f4 = "떨어짐"; // 같은 날 같은 시간 근무지만 다른 층 → 인접 아님
  const rows = recommend([M("붙음"), M("떨어짐")], s, ts, cfg, "월", 1, "f2");
  assert.strictEqual(rows[0].member.name, "붙음");
  assert.ok(find(rows, "붙음").why.includes("이어서 근무"));
  assert.ok(Math.abs((find(rows, "붙음").score - find(rows, "떨어짐").score) - 3) < 1e-9,
    `이어서 근무 가점이 3이 아님: ${find(rows, "붙음").score - find(rows, "떨어짐").score}`);

  // 5b) 선호층 가점 1순위 +2 / 2순위 +1 (무선호 대비)
  const one = recommend([M("일순", { preferFloor1: "2층" })], empty(), ts, cfg, "월", 0, "f2")[0].score;
  const two = recommend([M("이순", { preferFloor1: "3층", preferFloor2: "2층" })], empty(), ts, cfg, "월", 0, "f2")[0].score;
  const none = recommend([M("무선호")], empty(), ts, cfg, "월", 0, "f2")[0].score;
  assert.ok(Math.abs((one - none) - 2) < 1e-9, `1순위 층 가점이 2가 아님: ${one - none}`);
  assert.ok(Math.abs((two - none) - 1) < 1e-9, `2순위 층 가점이 1이 아님: ${two - none}`);
  // 선호층 미설정자는 3층을 자기 층처럼 취급 (3층이 무선호 인원의 기본 자리)
  const none3 = recommend([M("무선호")], empty(), ts, cfg, "월", 0, "f3a")[0];
  assert.ok(none3.why.includes("1순위 층"));
  assert.ok(Math.abs((none3.score - none) - 2) < 1e-9, `무선호자의 3층 가점이 없음: ${none3.score - none}`);
  assert.ok(recommend([M("무선호")], empty(), ts, cfg, "월", 0, "f3b")[0].why.includes("1순위 층"), "3층 둘째 칸도 3층이다");

  // 5c) 인접은 앞 칸뿐 아니라 뒤 칸도 봐야 한다 (뒤에 이어붙는 근무도 한 덩어리)
  const back = empty();
  back.월[2].f2 = "뒤붙음";
  back.월[2].f4 = "뒤떨어짐";
  const rowsB = recommend([M("뒤붙음"), M("뒤떨어짐")], back, ts, cfg, "월", 1, "f2");
  assert.strictEqual(rowsB[0].member.name, "뒤붙음");
  assert.ok(Math.abs((find(rowsB, "뒤붙음").score - find(rowsB, "뒤떨어짐").score) - 3) < 1e-9,
    `뒤 칸 인접이 반영되지 않음: ${find(rowsB, "뒤붙음").score - find(rowsB, "뒤떨어짐").score}`);

  // 5d) 시간이 많이 남은 사람이 우선 (한도까지 채워야 하므로)
  const busy = empty();
  ts.forEach((_, i) => { busy.화[i] = { ...busy.화[i], f2: "많이쓴" }; }); // 3h 사용
  const rowsR = recommend([M("많이쓴"), M("적게쓴")], busy, ts, cfg, "월", 0, "f2");
  assert.strictEqual(rowsR[0].member.name, "적게쓴");
  assert.ok(Math.abs((find(rowsR, "적게쓴").score - find(rowsR, "많이쓴").score) - (3 / 20) * 1.5) < 1e-9,
    `잔여시간이 점수에 반영되지 않음: ${find(rowsR, "적게쓴").score - find(rowsR, "많이쓴").score}`);

  // 5e) 그날 이미 나온 사람 +0.5 (출근 일수를 늘리지 않는 쪽). 총 근무시간은 같게 맞춘다
  const came = empty();
  came.월[2].f4 = "이미출근"; // 같은 날 다른 시간대
  came.화[2].f2 = "안왔음";   // 다른 날 — 총 1h로 remain은 동일
  const rowsD = recommend([M("이미출근"), M("안왔음")], came, ts, cfg, "월", 0, "f2");
  assert.strictEqual(rowsD[0].member.name, "이미출근");
  assert.ok(Math.abs((find(rowsD, "이미출근").score - find(rowsD, "안왔음").score) - 0.5) < 1e-9,
    `그날 출근 가점이 0.5가 아님: ${find(rowsD, "이미출근").score - find(rowsD, "안왔음").score}`);

  // 5f) 수업과 2시간 이내로 붙는 근무 +0.5 (등교 한 번에 수업+근무를 몰아주는 실제 운영 패턴)
  //     평가 칸은 10:00~11:00 — 13시 수업이면 gap 2h로 붙음, 16시 수업이면 5h라 안 붙음
  const cls = (sh, eh) => [{ day: "월", startHour: sh, startMin: 0, endHour: eh, endMin: 0 }];
  const rowsC = recommend([M("수업붙음", { classes: cls(13, 14) }), M("수업멂", { classes: cls(16, 17) })],
    empty(), ts, cfg, "월", 1, "f2");
  assert.strictEqual(rowsC[0].member.name, "수업붙음");
  assert.ok(find(rowsC, "수업붙음").why.includes("수업과 붙음"));
  assert.ok(Math.abs((find(rowsC, "수업붙음").score - find(rowsC, "수업멂").score) - 0.5) < 1e-9,
    `수업 인접 가점이 0.5가 아님: ${find(rowsC, "수업붙음").score - find(rowsC, "수업멂").score}`);
  // 다른 요일 수업은 붙은 게 아니다
  const other = recommend([M("타요일", { classes: [{ day: "화", startHour: 13, startMin: 0, endHour: 14, endMin: 0 }] })],
    empty(), ts, cfg, "월", 1, "f2")[0];
  assert.ok(!other.why.includes("수업과 붙음"), "다른 요일 수업을 인접으로 잘못 셈");
}

// 6) 근로 유형은 주당 근무시간 하나로만 정해진다 (예전 "야간 학생" 플래그를 대신한다)
{
  const rows = recommend([M("장시간", { weeklyHours: 40 }), M("기본")], empty(), ts, cfg, "월", 2, "f2");
  assert.strictEqual(find(rows, "장시간").remain, 40);
  assert.strictEqual(find(rows, "기본").remain, 20);   // 미설정자는 운영 설정의 기본값
  // 채울 시간이 두 배인 쪽이 먼저 추천된다 (잔여를 비율로 재면 둘 다 "100% 남음"이라 뒤집힌다)
  assert.strictEqual(rows[0].member.name, "장시간");
  assert.ok(Math.abs((find(rows, "장시간").score - find(rows, "기본").score) - (20 / 40) * 1.5) < 1e-9,
    `잔여시간이 절대량 기준이 아님: ${find(rows, "장시간").score - find(rows, "기본").score}`);
  // 저녁 칸이라고 해서 따로 밀어내지 않는다 — 저녁에 수업이 있으면 수업 자체가 막는다
  assert.deepStrictEqual(find(rows, "장시간").why.filter(w => /야간/.test(w)), []);
}

// 6b) 불가(수업·중복)와 재량(한도·층)은 구분된다 — 전자만 클릭을 막는 근거가 된다
{
  const s = empty();
  const cls = [{ day: "월", startHour: 9, startMin: 0, endHour: 10, endMin: 0 }];
  const hard = recommend([M("수업생", { classes: cls })], s, ts, cfg, "월", 0, "f2")[0];
  assert.deepStrictEqual(hard.conflicts, ["수업 중"]);
  assert.deepStrictEqual(hard.warnings, []);

  const soft = recommend([M("사층", { preferFloor1: "4층" })], s, ts, cfg, "월", 0, "f2")[0];
  assert.deepStrictEqual(soft.conflicts, []);
  assert.deepStrictEqual(soft.warnings, ["4층 담당"]);
  assert.deepStrictEqual(soft.blocked, ["4층 담당"]); // blocked는 둘의 합
}

// 7) 순서: 넣을 수 있는 사람 → 한도를 넘지만 넣을 수는 있는 사람 → 아예 못 넣는 사람
//    (한도 초과가 수업 중인 사람보다 위여야 한다. 전원이 한도를 다 쓴 주에는 이 순서가 곧 추천 순서가 된다)
{
  const s = empty();
  // 전원 소진 상태를 만들기 위해 주 한도를 3h로 좁히고, "한도초과"만 이미 3h를 쓰게 한다
  const tight = { ...cfg, maxWeeklyHours: 3 };
  ts.forEach((_, i) => { s.화[i] = { ...s.화[i], f2: "한도초과" }; });
  const rows = recommend([
    M("수업중", { classes: [{ day: "월", startHour: 9, startMin: 0, endHour: 10, endMin: 0 }] }),
    M("한도초과"),
    M("멀쩡"),
  ], s, ts, tight, "월", 0, "f2");
  assert.deepStrictEqual(rows.map(r => r.member.name), ["멀쩡", "한도초과", "수업중"]);
  assert.deepStrictEqual(rows[0].blocked, []);
  assert.deepStrictEqual(rows[1].warnings, ["주 3h 초과"]);
  assert.deepStrictEqual(rows[2].conflicts, ["수업 중"]);
}

// 8) 드래그로 여러 칸을 고르면 한 덩어리 근무로 평가한다
{
  // 8a) 시간은 합계로 — 3칸(3h)을 한 번에 고르면 남은 2h로는 못 채운다
  const cfg2 = { ...cfg, maxWeeklyHours: 2 };
  const one = recommend([M("한칸")], empty(), ts, cfg2, "월", 0, "f2")[0];
  assert.deepStrictEqual(one.warnings, []); // 1h는 2h 한도 안
  const three = recommend([M("세칸")], empty(), ts, cfg2, "월", [0, 1, 2], "f2")[0];
  assert.deepStrictEqual(three.warnings, ["주 2h 초과"]);

  // 8b) 범위 안에 수업이 하나라도 걸리면 불가
  const m = M("일부수업", { classes: [{ day: "월", startHour: 10, startMin: 0, endHour: 11, endMin: 0 }] });
  assert.deepStrictEqual(recommend([m], empty(), ts, cfg, "월", 0, "f2")[0].conflicts, []);
  assert.deepStrictEqual(recommend([m], empty(), ts, cfg, "월", [0, 1], "f2")[0].conflicts, ["수업 중"]);

  // 8c) 인접은 범위의 바깥 양끝으로 판단한다 (범위 내부는 어차피 덮어쓴다)
  const s = empty();
  s.월[2].f2 = "뒤에있음";
  const rows = recommend([M("뒤에있음"), M("남")], s, ts, cfg, "월", [0, 1], "f2");
  assert.ok(find(rows, "뒤에있음").why.includes("이어서 근무"));
  assert.ok(!find(rows, "남").why.includes("이어서 근무"));

  // 8d) 범위 전체가 그 사람일 때만 "현재"로 본다
  const cur = empty();
  cur.월[0].f2 = "절반"; // 0번만 배치되어 있고 1번은 빈칸
  const rc = recommend([M("절반")], cur, ts, cfg, "월", [0, 1], "f2")[0];
  assert.strictEqual(rc.isCurrent, false);
  cur.월[1].f2 = "절반";
  assert.strictEqual(recommend([M("절반")], cur, ts, cfg, "월", [0, 1], "f2")[0].isCurrent, true);

  // 8e) 덮어쓸 칸은 기존 근무시간에서 빼고 센다 (이미 그 자리에 있던 사람이 자기 시간에 이중으로 걸리지 않게)
  const own = empty();
  own.월[0].f2 = "본인"; own.월[1].f2 = "본인";
  assert.strictEqual(recommend([M("본인")], own, ts, cfg, "월", [0, 1], "f2")[0].remain, 20);

  // 8c-2) 타 층 중복은 범위 안 어느 칸에서 걸려도 잡아야 한다 (첫 칸만 보면 놓친다)
  const dup = empty();
  dup.월[1].f4 = "뒤중복";
  assert.deepStrictEqual(recommend([M("뒤중복")], dup, ts, cfg, "월", [0, 1], "f2")[0].conflicts, ["같은 시간 타 층"]);

  // 8f) 아래에서 위로 드래그해도 같은 결과 — 수업 인접은 범위의 시작·끝 시각으로 재므로 순서가 뒤집히면 틀어진다
  const revM = () => M("역순", { classes: [{ day: "월", startHour: 13, startMin: 0, endHour: 14, endMin: 0 }] });
  const up = recommend([revM()], empty(), ts, cfg, "월", [1, 0], "f2")[0];
  const down = recommend([revM()], empty(), ts, cfg, "월", [0, 1], "f2")[0];
  assert.ok(down.why.includes("수업과 붙음"));
  assert.strictEqual(up.score, down.score);
  assert.deepStrictEqual(up.why, down.why);
}

// 9) audit — 이미 짜인 시간표의 문제를 찾아낸다
//    지정한 칸은 자동배치가 한도·수업을 무시하고 유지하므로, 이 검사가 마지막 그물이다
{
  assert.deepStrictEqual(audit([M("멀쩡")], empty(), ts, cfg), []);

  // 9a) 배치해둔 뒤 수업이 생기면 충돌로 잡힌다
  const s = empty();
  s.월[0].f2 = "나중수업";
  const withClass = [M("나중수업", { classes: [{ day: "월", startHour: 9, startMin: 0, endHour: 10, endMin: 0 }] })];
  assert.deepStrictEqual(audit(withClass, s, ts, cfg).map(i => i.level), ["error"]);
  assert.match(audit(withClass, s, ts, cfg)[0].text, /수업 시간/);
  assert.deepStrictEqual(audit([M("나중수업")], s, ts, cfg), []); // 수업이 없으면 문제 없음

  // 9b) 같은 시간에 두 자리
  const two = empty();
  two.월[0].f2 = "겹침"; two.월[0].f4 = "겹침";
  const dup = audit([M("겹침")], two, ts, cfg);
  assert.strictEqual(dup.length, 1);
  assert.match(dup[0].text, /두 자리/);

  // 9c) 주 한도 / 일 한도 초과는 경고 (막지 않고 알린다)
  const over = empty();
  ["월", "화"].forEach(d => ts.forEach((_, i) => { over[d][i] = { ...over[d][i], f2: "과다" }; })); // 6h
  const w = audit([M("과다")], over, ts, { ...cfg, maxWeeklyHours: 4, maxDailyHours: 8 });
  assert.deepStrictEqual(w.map(i => i.level), ["warn"]);
  assert.match(w[0].text, /주 6h \(한도 4h\)/);
  const dd = audit([M("과다")], over, ts, { ...cfg, maxWeeklyHours: 40, maxDailyHours: 2 });
  assert.strictEqual(dd.length, 2); // 월·화 각각
  assert.ok(dd.every(i => i.level === "warn" && /하루 한도/.test(i.text)));

  // 9d) 한도는 멤버별 주 근무시간으로 잰다 (운영 기본값보다 멤버 설정이 우선)
  const long = empty();
  ts.forEach((_, i) => { long.월[i] = { ...long.월[i], f2: "장시간" }; }); // 3h
  assert.deepStrictEqual(audit([M("장시간", { weeklyHours: 40 })], long, ts, { ...cfg, maxWeeklyHours: 2 }), []);
  assert.strictEqual(audit([M("장시간", { weeklyHours: 2 })], long, ts, { ...cfg, maxWeeklyHours: 40 }).length, 1);

  // 9e) 명단에서 빠진 사람이 시간표에 남아 있으면 잡는다 (인원 삭제 후 실제로 생기는 상황)
  const ghost = empty();
  ghost.월[0].f2 = "퇴사자";
  const g = audit([M("남은사람")], ghost, ts, cfg);
  assert.strictEqual(g.length, 1);
  assert.match(g[0].text, /명단에 없는/);
}

console.log("✅ recommend 자체검사 통과");
