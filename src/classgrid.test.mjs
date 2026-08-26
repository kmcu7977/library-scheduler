// 수업 격자 자체검사
//   node --loader ./_dev/extresolve.mjs src/classgrid.test.mjs
import assert from "node:assert";
import { buildClassGrid } from "./classgrid.js";

const cfg = { openHour: 9, openMin: 0, closeHour: 18, closeMin: 0 };
const cls = (day, sh, sm, eh, em) => ({ day, startHour: sh, startMin: sm, endHour: eh, endMin: em });
const M = (name, classes = []) => ({ name, color: "#000", classes });
const names = arr => arr.map(x => x.name);

// 1) 시간 축은 개관~폐관, 요일은 평일 5개
{
  const g = buildClassGrid([M("가")], cfg);
  assert.deepStrictEqual(g.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepStrictEqual(g.days, ["월", "화", "수", "목", "금"]);
}

// 2) 수업이 걸치는 시간에만 잡힌다 (10:30~12:00 → 10시·11시 칸, 12시 칸은 아님)
{
  const g = buildClassGrid([M("가", [cls("월", 10, 30, 12, 0)])], cfg);
  assert.deepStrictEqual(names(g.grid.월[9]), []);
  assert.deepStrictEqual(names(g.grid.월[10]), ["가"]);
  assert.deepStrictEqual(names(g.grid.월[11]), ["가"]);
  assert.deepStrictEqual(names(g.grid.월[12]), []);   // 12:00 끝 = 12시 칸에 안 걸침
  assert.deepStrictEqual(names(g.grid.화[10]), []);   // 다른 요일로 새지 않는다
}

// 2-b) 정각에 시작하는 수업은 앞 칸으로 새지 않는다 (11:00~12:00은 10시 칸과 무관)
{
  const g = buildClassGrid([M("가", [cls("월", 11, 0, 12, 0)])], cfg);
  assert.deepStrictEqual(names(g.grid.월[10]), []);
  assert.deepStrictEqual(names(g.grid.월[11]), ["가"]);
  assert.deepStrictEqual(names(g.freeGrid.월[10]), ["가"]);
}

// 3) freeGrid는 grid의 정확한 뒤집기 — 두 칸을 합치면 항상 전원
{
  const ms = [M("가", [cls("월", 10, 0, 11, 0)]), M("나", []), M("다", [cls("월", 10, 0, 11, 0)])];
  const g = buildClassGrid(ms, cfg);
  for (const d of g.days) for (const h of g.hours) {
    const busy = new Set(names(g.grid[d][h]));
    const free = new Set(names(g.freeGrid[d][h]));
    assert.strictEqual(busy.size + free.size, ms.length, `${d} ${h}시 합이 인원수와 다름`);
    for (const n of busy) assert.ok(!free.has(n), `${n}이 ${d} ${h}시에 양쪽 모두에 있음`);
  }
  assert.deepStrictEqual(names(g.freeGrid.월[10]), ["나"]);
  assert.deepStrictEqual(names(g.freeGrid.월[11]), ["가", "나", "다"]);
}

// 4) 개관 전·폐관 후 수업이 있으면 시간 축이 그만큼 늘어난다
{
  const g = buildClassGrid([M("가", [cls("화", 7, 30, 9, 0), cls("화", 18, 0, 20, 30)])], cfg);
  assert.strictEqual(g.hours[0], 7);
  assert.strictEqual(g.hours[g.hours.length - 1], 20);
  assert.deepStrictEqual(names(g.grid.화[7]), ["가"]);
  assert.deepStrictEqual(names(g.grid.화[20]), ["가"]);
}

// 5) 주말 수업이 있을 때만 토·일 열이 생긴다
{
  assert.deepStrictEqual(buildClassGrid([M("가", [cls("토", 10, 0, 12, 0)])], cfg).days,
    ["월", "화", "수", "목", "금", "토"]);
  assert.deepStrictEqual(buildClassGrid([M("가", [cls("일", 10, 0, 12, 0)])], cfg).days,
    ["월", "화", "수", "목", "금", "일"]);
}

// 6) 수업 미입력자는 따로 집계된다 (모든 시간에 비어 있는 것으로 보이므로 경고용)
{
  const g = buildClassGrid([M("가", [cls("월", 10, 0, 11, 0)]), M("나"), M("다", [])], cfg);
  assert.deepStrictEqual(names(g.noClass), ["나", "다"]);
}

// 7) 인원이 아무도 없어도 축은 개관~폐관으로 서고, 칸은 빈다
{
  const g = buildClassGrid([], cfg);
  assert.deepStrictEqual(g.hours, [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepStrictEqual(g.grid.월[9], []);
  assert.deepStrictEqual(g.freeGrid.월[9], []);
}

console.log("✅ classgrid 자체검사 통과");
