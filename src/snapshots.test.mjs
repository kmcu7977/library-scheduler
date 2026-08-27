// 버전 보관 자체검사
//   node --loader ./_dev/extresolve.mjs src/snapshots.test.mjs
import assert from "node:assert";
import { SLOTS, AUTO_SLOT, makeSnapshot, normalizeSnapshots, fmtSavedAt, summarize } from "./snapshots.js";
import { restoreIndexed } from "./utils.js";

// 1) 한 칸에 네 가지가 통째로 담긴다 (일부만 담으면 되돌릴 때 앞뒤가 안 맞는다)
{
  const state = { cfg: { openHour: 9 }, members: [{ name: "가" }], schedule: { 월: [] }, pins: { 월: { 0: { f2: "가" } } }, 딴것: 1 };
  const s = makeSnapshot(state, "  1학기 확정본  ", "  점심 조정 전  ");
  assert.deepStrictEqual(Object.keys(s.data).sort(), ["cfg", "members", "pins", "schedule"]);
  assert.strictEqual(s.name, "1학기 확정본");   // 앞뒤 공백은 저장 전에 턴다
  assert.strictEqual(s.desc, "점심 조정 전");
  assert.ok(s.savedAt > 0 && s.savedAt <= Date.now());
  assert.strictEqual(s.data.딴것, undefined);   // 담기로 한 것만 담는다
}

// 2) Firebase가 배열로 주든 객체로 주든, 빈 칸이 있든 항상 세 칸
{
  assert.deepStrictEqual(normalizeSnapshots(null), [null, null, null]);
  assert.deepStrictEqual(normalizeSnapshots({ 0: { name: "가" }, 2: { name: "다" } }), [{ name: "가" }, null, { name: "다" }]);
  assert.deepStrictEqual(normalizeSnapshots([{ name: "가" }, null, { name: "다" }]), [{ name: "가" }, null, { name: "다" }]);
  assert.strictEqual(SLOTS.length, 3);
  // 숨은 대피칸은 사용자 몫 세 칸에 섞이지 않는다
  assert.ok(!SLOTS.includes(AUTO_SLOT));
  assert.deepStrictEqual(normalizeSnapshots({ 0: { name: "가" }, [AUTO_SLOT]: { name: "직전" } }), [{ name: "가" }, null, null]);
}

// 3) 저장시각 표기
{
  assert.strictEqual(fmtSavedAt(new Date(2026, 7, 27, 9, 5).getTime()), "2026-08-27 09:05");
  assert.strictEqual(fmtSavedAt(0), "");
  assert.strictEqual(fmtSavedAt(undefined), "");
}

// 4) 요약은 실제로 배치된 칸만 센다 (빈 칸·null은 빼고)
{
  const snap = makeSnapshot({
    cfg: {}, members: [{ name: "가" }, { name: "나" }], pins: {},
    schedule: { 월: [{ f2: "가", f3a: null, f3b: "", f4: "나" }, null], 화: [{ f2: null }] },
  }, "x");
  assert.strictEqual(summarize(snap), "인원 2명 · 배치 2칸");
  assert.strictEqual(summarize(null), "");
}

// 5) 되돌릴 때 시간대 인덱스가 밀리지 않는다 — 전 층이 빈 시간대는 Firebase가 통째로 뺀다
{
  // 0·2번 시간대만 남은 채로 돌아온 경우: 2번은 반드시 제자리에 있어야 한다
  const got = restoreIndexed({ 0: { f2: "가" }, 2: { f2: "다" } }, 4);
  assert.strictEqual(got.length, 4);
  assert.deepStrictEqual(got[0], { f2: "가" });
  assert.strictEqual(got[1], null);           // 빠진 자리는 빈 칸으로 되살린다
  assert.deepStrictEqual(got[2], { f2: "다" });
  assert.strictEqual(got[3], null);
}
{
  // Firebase가 준 배열엔 빠진 자리가 null이 아니라 "구멍"으로 온다 (JSON을 거치면 null이 되지만
  // SDK가 바로 준 값은 구멍이다). 구멍을 건너뛰면 뒤 시간대가 밀리거나 터진다
  const holey = [{ f2: "가" }];
  holey[2] = { f2: "다" };            // 1번 자리는 구멍
  assert.strictEqual(1 in holey, false, "테스트 전제: 1번은 구멍이어야 한다");
  const got = restoreIndexed(holey, 3);
  assert.deepStrictEqual(got, [{ f2: "가" }, null, { f2: "다" }]);
}
{
  // 배열로 오면 그대로, 길이가 모자라면 시간대 수만큼 채운다
  assert.deepStrictEqual(restoreIndexed([{ f2: "가" }, null], 3), [{ f2: "가" }, null, null]);
  // 저장된 게 더 길면 잘라내지 않는다 (운영설정이 바뀌어 칸 수가 줄었을 때 데이터를 버리면 안 된다)
  assert.strictEqual(restoreIndexed([{}, {}, {}, {}], 2).length, 4);
  // 시간대 수를 안 넘겨도 뚫린 자리는 빈 칸(null)이어야 한다 — 구멍(undefined)으로 두면
  // 뒤에서 다루는 쪽이 "칸이 없는 것"과 "빈 칸"을 구분 못 한다
  const noLen = restoreIndexed({ 0: { f2: "가" }, 3: { f2: "라" } });
  assert.strictEqual(noLen.length, 4);
  assert.strictEqual(noLen[1], null);
  assert.strictEqual(noLen[2], null);
  assert.deepStrictEqual(restoreIndexed(null, 2), [null, null]);
  assert.deepStrictEqual(restoreIndexed(undefined, 0), []);
}

console.log("✅ snapshots 자체검사 통과");
