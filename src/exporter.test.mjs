// 엑셀 출력 자체검사: node --loader ... src/exporter.test.mjs
// 서식(테두리·채움·병합)은 눈으로 못 보는 대신 여기서 좌표로 검사한다.
import assert from "node:assert";
import XLSX from "xlsx-js-style";
import { buildWorkbook, defaultTitle, defaultEffectiveDate } from "./exporter.js";
import { buildTimeSlots } from "./utils.js";

const cfg = { openHour: 8, openMin: 30, closeHour: 21, closeMin: 0, firstSlotMins: 30, slotMins: 60, maxWeeklyHours: 20, maxDailyHours: 8 };
const timeSlots = buildTimeSlots(cfg);
const members = [
  { name: "탁연주", dept: "사회복지상담과", studentId: "2524783", weeklyHours: 40 },
  { name: "강나경", dept: "언어치료과", studentId: "2541701" },
];
const li = timeSlots.findIndex(s => s.startH === 12);          // 점심1
const li2 = timeSlots.findIndex(s => s.startH === 13);         // 점심2
const schedule = { 월: [], 화: [], 수: [], 목: [], 금: [] };
for (const d of Object.keys(schedule)) schedule[d] = timeSlots.map(() => ({}));
schedule.월[0] = { f2: "탁연주", f3a: "강나경", f4: "탁연주" };
schedule.월[li] = { f3a: "강나경" };                            // 점심에 3층 한 명 → 병합 대상
schedule.화[li] = { f3a: "강나경", f3b: "탁연주" };             // 두 명 → 병합하면 가려짐
schedule.수[li] = { f3b: "강나경" };                            // 뒷칸에만 → 앞칸으로 옮겨 병합
schedule.금[timeSlots.length - 1] = { f4: "강나경" };

const wb = buildWorkbook(schedule, members, timeSlots, cfg);
const ws = wb.Sheets["근무시간표"];
const at = a => ws[a];
const merged = r => (ws["!merges"] || []).some(m => XLSX.utils.encode_range(m) === r);
const lastRow = 4 + timeSlots.length;                          // 1-based 마지막 행

// 제목·시행일
assert.equal(at("A1").v, defaultTitle());
assert.ok(at("A1").s.font.bold && at("A1").s.font.sz === 20, "제목은 굵은 20pt");
assert.equal(at("A2").v, defaultEffectiveDate());
assert.equal(at("A2").s.alignment.horizontal, "right", "시행일은 우측정렬");
assert.ok(merged("A1:U1") && merged("A2:U2"), "제목·시행일은 표 전체 폭 병합");
assert.equal(ws["!ref"], `A1:U${lastRow}`);
assert.deepEqual(ws["!cols"].map(c => c.width), [13.109375, ...Array(20).fill(8.77734375)], "열 너비 (양식과 동일)");
assert.deepEqual(ws["!rows"].map(r => r.hpt), [30, 30, 20, 20, ...timeSlots.map(() => 30)], "행 높이");

// 헤더: 시간(A3:A4) / 요일 4칸 / 층 라벨은 2층·3층(2칸)·4층
assert.equal(at("A3").v, "시간");
assert.ok(merged("A3:A4"), "시간 헤더는 두 줄 병합");
assert.deepEqual(["B3","F3","J3","N3","R3"].map(a => at(a).v), ["월","화","수","목","금"]);
assert.ok(merged("B3:E3") && merged("R3:U3"), "요일 헤더는 층 4칸 병합");
assert.deepEqual(["B4","C4","D4","E4"].map(a => at(a).v), ["2층","3층","","4층"]);
assert.ok(merged("C4:D4") && merged("S4:T4"), "3층 두 칸은 헤더에서 병합");
assert.equal(at("B3").s.fill.fgColor.rgb, "D9E2F3", "헤더 채움색");
assert.ok(at("B3").s.font.bold && at("B4").s.font.bold, "헤더는 굵게");
assert.ok(!at("B5").s.font.bold, "본문 이름은 굵지 않게");
assert.ok(at(`A${5 + li}`).s.font.bold, "시간열은 굵게");

// 본문 배치가 요일×층 좌표에 맞게 들어갔는지
assert.equal(at("A5").v, timeSlots[0].label);
assert.equal(at("A5").s.font.color.rgb, "FFFF0000", "첫 슬롯 라벨은 빨강");
assert.equal(at("B5").v, "탁연주");   // 월 2층
assert.equal(at("C5").v, "강나경");   // 월 3층a
assert.equal(at("D5").v, "");         // 월 3층b
assert.equal(at("E5").v, "탁연주");   // 월 4층
assert.equal(at(`U${lastRow}`).v, "강나경");  // 금 4층 마지막 슬롯

// 점심시간: 채움 + 3층 병합은 뒷칸이 빈 경우에만
const lunchRow = 5 + li, lunchRow2 = 5 + li2;
assert.equal(at(`B${lunchRow}`).s.fill.fgColor.rgb, "D9E2F3", "점심행은 채움색");
assert.ok(at(`A${lunchRow}`).v.includes("점심시간1") && at(`A${lunchRow2}`).v.includes("점심시간2"));
assert.ok(merged(`C${lunchRow}:D${lunchRow}`), "3층 한 명이면 병합");
assert.ok(!merged(`G${lunchRow}:H${lunchRow}`), "3층 두 명이면 병합하지 않는다");
assert.ok(merged(`G${lunchRow2}:H${lunchRow2}`), "다른 점심행은 병합");
assert.ok(merged(`K${lunchRow}:L${lunchRow}`), "뒷칸에만 있어도 병합");
assert.equal(at(`K${lunchRow}`).v, "강나경", "병합 시 이름은 앞칸으로");
assert.equal(at(`L${lunchRow}`).v, "", "옮긴 뒷칸은 비운다");
assert.ok(!at("B5").s.fill, "점심 아닌 행은 채움 없음");

// 테두리: 요일 경계·표 바깥은 medium
assert.equal(at("A5").s.border.left.style, "medium", "표 왼쪽 끝");
assert.equal(at("A5").s.border.right.style, "medium", "시간열과 월요일 사이");
assert.equal(at("F5").s.border.left.style, "medium", "화요일 첫 칸");
assert.equal(at("C5").s.border.left.style, "thin", "요일 안쪽은 얇게");
assert.equal(at("B3").s.border.top.style, "medium", "표 위쪽 끝");
assert.equal(at(`B${lastRow}`).s.border.bottom.style, "medium", "표 아래쪽 끝");
assert.equal(at("U5").s.border.right.style, "medium", "표 오른쪽 끝");
// 병합된 칸 사이에는 선을 긋지 않는다
assert.equal(at("C4").s.border.right, undefined, "3층 헤더 병합 안쪽엔 선 없음");
assert.equal(at("D4").s.border.left, undefined, "3층 헤더 병합 안쪽엔 선 없음");
assert.equal(at("A3").s.border.bottom, undefined, "시간 헤더 병합 안쪽엔 선 없음");
assert.equal(at(`C${lunchRow}`).s.border.right, undefined, "병합한 점심 3층 안쪽엔 선 없음");
assert.equal(at(`G${lunchRow}`).s.border.right.style, "thin", "병합 안 한 점심 3층은 선 유지");

// 주간요약: 한도는 개인별 weeklyHours (cfg 기본값이 아니라)
const sum = XLSX.utils.sheet_to_json(wb.Sheets["주간요약"], { header: 1 });
const byName = Object.fromEntries(sum.slice(1).map(r => [r[0], r]));
assert.deepEqual(sum[0], ["이름","학과","학번","주간 근로시간","주간 한도","잔여","일일 한도"]);
assert.equal(sum[1][0], "강나경", "명단은 가나다순");
assert.equal(byName["탁연주"][4], 40, "40시간 학생의 한도는 40");
assert.equal(byName["강나경"][4], 20, "미지정자는 cfg 기본값");
assert.equal(byName["탁연주"][3], 2, "월 첫 슬롯 0.5h×2칸 + 화 점심 3층b 1h");
assert.equal(byName["탁연주"][5], 38, "잔여 = 한도 - 근무");
assert.equal(byName["강나경"][3], 4.5, "월 0.5 + 월·화·수 점심 각 1 + 금 마지막 1");

// 명단 시트
const roster = XLSX.utils.sheet_to_json(wb.Sheets["장학생명단"], { header: 1 });
assert.deepEqual(roster[1], [1, "도서관", "언어치료과", "2541701", "강나경", "", ""]);

// 나머지 세 시트도 같은 서식 (헤더 굵게+연파랑, 표 바깥 굵은선, 열 너비)
for (const [name, headCell, bodyCell, lastCell, widths] of [
  ["장학생명단", "A1", "C2", "G3", [6.78, 8.78, 22.78, 10.78, 8.78, 14.78, 18.78]],
  ["주간요약",   "A1", "B2", "G3", [8.78, 20.78, 10.78, 12.78, 8.78, 8.78, 8.78]],
  ["운영설정",   "A1", "B2", "B7",  [14.78, 12.78]],
]) {
  const s = wb.Sheets[name];
  assert.ok(s[headCell].s.font.bold, `${name} 헤더는 굵게`);
  assert.equal(s[headCell].s.fill.fgColor.rgb, "D9E2F3", `${name} 헤더 채움색`);
  assert.equal(s[headCell].s.font.name, "맑은 고딕", `${name} 글꼴`);
  assert.equal(s[headCell].s.border.top.style, "medium", `${name} 표 위쪽 끝`);
  assert.equal(s[bodyCell].s.border.top.style, "thin", `${name} 안쪽 가로선`);
  assert.ok(!s[bodyCell].s.fill, `${name} 본문은 채움 없음`);
  assert.equal(s[lastCell].s.border.bottom.style, "medium", `${name} 표 아래쪽 끝`);
  assert.equal(s[lastCell].s.border.right.style, "medium", `${name} 표 오른쪽 끝`);
  assert.deepEqual(s["!cols"].map(c => c.width), widths, `${name} 열 너비`);
}
// 숫자는 숫자로 저장 (엑셀에서 합계가 되도록)
assert.equal(wb.Sheets["장학생명단"]["A2"].t, "n", "연번은 숫자");
assert.equal(wb.Sheets["주간요약"]["D2"].t, "n", "근로시간은 숫자");
assert.equal(wb.Sheets["운영설정"]["B2"].v, "8:30");

// 제목 기본값: 학년도는 3월~다음해 2월, 8~1월은 다음 학기
assert.ok(defaultTitle(new Date(2026, 7, 26)).startsWith("2026학년도 2학기"), "8월 → 2학기");
assert.ok(defaultTitle(new Date(2026, 3, 1)).startsWith("2026학년도 1학기"), "4월 → 1학기");
assert.ok(defaultTitle(new Date(2027, 0, 5)).startsWith("2026학년도 2학기"), "1월 → 전 학년도 2학기");
assert.equal(defaultEffectiveDate(new Date(2026, 8, 1)), "※ 시행일 : 26. 9. 1.(화)");

// cfg에 적어둔 제목이 있으면 그걸 쓴다
const wb2 = buildWorkbook(schedule, members, timeSlots, { ...cfg, title: "직접 쓴 제목", effectiveDate: "※ 시행일 : 미정" });
assert.equal(wb2.Sheets["근무시간표"]["A1"].v, "직접 쓴 제목");
assert.equal(wb2.Sheets["근무시간표"]["A2"].v, "※ 시행일 : 미정");

console.log("✅ exporter 자체검사 통과");
