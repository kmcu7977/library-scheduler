// 엑셀 출력. 근무시간표 서식은 사서가 손으로 꾸며 쓰던 양식
// ("2026학년도 2학기 도서관 근로장학생 명단 및 시간표")을 그대로 재현하고,
// 나머지 시트도 같은 서식(맑은 고딕 12 / 헤더 연파랑 / 얇은 테두리 + 바깥 굵은선)으로 맞춘다.
// SheetJS 커뮤니티판은 스타일을 못 쓰므로 같은 API의 포크(xlsx-js-style)를 쓴다.
import XLSX from "xlsx-js-style";
import { sortedByName, isLunchSlot } from "./utils";
import { DAYS, FLOOR_KEYS } from "./constants";
import { memberStats } from "./stats";

const FONT      = { name: "맑은 고딕", sz: 12 };
const HEAD_FILL = { fgColor: { rgb: "D9E2F3" } };   // 파랑 강조1 80% 밝게 (양식의 헤더·점심 칸 색)
const CENTER    = { horizontal: "center", vertical: "center", wrapText: true };
const M = { style: "medium" }, T = { style: "thin" };

const COLS     = 1 + DAYS.length * FLOOR_KEYS.length;
const HEAD_ROW = 2;   // 0:제목 1:시행일 2:요일 3:층 4~:시간대

// 학년도는 3월~다음해 2월. 8월~1월은 다음 학기 시간표를 미리 짜는 시기라 2학기로 본다
export function defaultTitle(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth() + 1;
  return `${m >= 2 ? y : y - 1}학년도 ${m >= 2 && m <= 7 ? 1 : 2}학기 도서관 근로장학생 층별 근무현황(도서관 : 월 900시간)`;
}

export function defaultEffectiveDate(now = new Date()) {
  const kr = ["일","월","화","수","목","금","토"][now.getDay()];
  return `※ 시행일 : ${String(now.getFullYear()).slice(2)}. ${now.getMonth() + 1}. ${now.getDate()}.(${kr})`;
}

// 표 바깥은 굵게, 안쪽은 얇게. 근무시간표는 요일 경계도 굵게 (dayEdge)
const frame = (r, c, lastRow, lastCol, dayEdge = false) => ({
  top:    r === 0 ? M : T,
  bottom: r === lastRow ? M : T,
  left:   c === 0 || (dayEdge && (c - 1) % FLOOR_KEYS.length === 0) ? M : T,
  right:  c === lastCol || (dayEdge && c % FLOOR_KEYS.length === 0) ? M : T,
});

const cell = (v, s) => ({ v: v ?? "", t: typeof v === "number" ? "n" : "s", s });

// 머리글 한 줄 + 본문인 단순 표를 같은 서식으로 만든다 (명단·요약·운영설정 공용)
function simpleSheet(aoa, widths) {
  const lastRow = aoa.length - 1, lastCol = aoa[0].length - 1;
  const rows = aoa.map((row, r) => row.map((v, c) => cell(v, {
    font: { ...FONT, ...(r === 0 ? { bold: true } : {}) },
    ...(r === 0 ? { fill: HEAD_FILL } : {}),
    alignment: CENTER,
    border: frame(r, c, lastRow, lastCol),
  })));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths.map(width => ({ width }));
  ws["!rows"] = aoa.map(() => ({ hpt: 20 }));
  return ws;
}

// 병합된 칸 사이에는 선을 긋지 않는다 (엑셀이 어차피 안 그리고, 양식도 비워둔 자리)
function clearInnerBorders(rows, merges) {
  const side = (r, c, key) => { const cell = rows[r]?.[c]; if (cell) cell.s = { ...cell.s, border: { ...cell.s.border, [key]: undefined } }; };
  for (const { s: a, e: b } of merges) {
    for (let r = a.r; r <= b.r; r++) for (let c = a.c; c < b.c; c++) { side(r, c, "right"); side(r, c + 1, "left"); }
    for (let c = a.c; c <= b.c; c++) for (let r = a.r; r < b.r; r++) { side(r, c, "bottom"); side(r + 1, c, "top"); }
  }
}

function scheduleSheet(schedule, timeSlots, cfg) {
  const lastRow = HEAD_ROW + 2 + timeSlots.length - 1;
  const border = (r, c) => frame(r - HEAD_ROW, c, lastRow - HEAD_ROW, COLS - 1, true);
  const rows = [];

  rows.push([cell(cfg.title || defaultTitle(), { font: { ...FONT, bold: true, sz: 20 }, alignment: CENTER })]);
  rows.push([cell(cfg.effectiveDate || defaultEffectiveDate(),
    { font: { ...FONT, bold: true }, alignment: { horizontal: "right", vertical: "center" }, border: { bottom: M } })]);

  const head = (r, c) => ({ font: { ...FONT, bold: true }, fill: HEAD_FILL, alignment: CENTER, border: border(r, c) });
  const rDay = [cell("시간", head(HEAD_ROW, 0))], rFloor = [cell("", head(HEAD_ROW + 1, 0))];
  DAYS.forEach((d, di) => FLOOR_KEYS.forEach((fk, fi) => {
    const c = 1 + di * FLOOR_KEYS.length + fi;
    rDay.push(cell(fi === 0 ? d : "", head(HEAD_ROW, c)));
    // f3a/f3b는 둘 다 3층이고 헤더에서 한 칸으로 병합되므로 f3b는 라벨 없음(맵에 키가 없다)
    rFloor.push(cell({ f2: "2층", f3a: "3층", f4: "4층" }[fk], head(HEAD_ROW + 1, c)));
  }));
  rows.push(rDay, rFloor);

  const lunchMerges = [];
  timeSlots.forEach((slot, si) => {
    const r = HEAD_ROW + 2 + si;
    const lunch = isLunchSlot(slot);
    const body = (c, extra) => ({
      font: { ...FONT, ...extra }, alignment: CENTER,
      border: border(r, c), ...(lunch ? { fill: HEAD_FILL } : {}),
    });
    // 첫 슬롯은 개관 시각 때문에 길이가 다른 칸이라 양식에서 빨갛게 눈에 띄게 해둔다
    const row = [cell(slot.label, body(0, { bold: true, ...(si === 0 ? { color: { rgb: "FFFF0000" } } : {}) }))];
    DAYS.forEach((day, di) => FLOOR_KEYS.forEach((fk, fi) =>
      row.push(cell(schedule?.[day]?.[si]?.[fk] || "", body(1 + di * FLOOR_KEYS.length + fi)))));
    // 점심시간 3층은 보통 한 명만 남으므로 두 칸을 합친다. 이름이 뒷칸에만 있으면 앞칸으로 옮겨
    // 합쳐야 가려지지 않는다. 둘 다 있으면 합칠 수 없으니 그대로 둔다
    if (lunch) DAYS.forEach((day, di) => {
      const { f3a, f3b } = schedule?.[day]?.[si] || {};
      if (f3a && f3b) return;
      const c = 1 + di * FLOOR_KEYS.length + FLOOR_KEYS.indexOf("f3a");
      row[c].v = f3a || f3b || "";
      row[c + 1].v = "";
      lunchMerges.push({ s: { r, c }, e: { r, c: c + 1 } });
    });
    rows.push(row);
  });

  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: COLS - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: COLS - 1 } },
    { s: { r: HEAD_ROW, c: 0 }, e: { r: HEAD_ROW + 1, c: 0 } },
    ...DAYS.flatMap((_, di) => {
      const c = 1 + di * FLOOR_KEYS.length;
      return [
        { s: { r: HEAD_ROW, c }, e: { r: HEAD_ROW, c: c + FLOOR_KEYS.length - 1 } },
        { s: { r: HEAD_ROW + 1, c: c + 1 }, e: { r: HEAD_ROW + 1, c: c + 2 } },
      ];
    }),
    ...lunchMerges,
  ];
  clearInnerBorders(rows, merges);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: COLS - 1 } });
  ws["!cols"] = [{ width: 13.109375 }, ...Array(COLS - 1).fill({ width: 8.77734375 })];  // 양식과 같은 폭
  ws["!rows"] = [{ hpt: 30 }, { hpt: 30 }, { hpt: 20 }, { hpt: 20 }, ...timeSlots.map(() => ({ hpt: 30 }))];
  ws["!merges"] = merges;
  return ws;
}

export function buildWorkbook(schedule, members, timeSlots, cfg) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, scheduleSheet(schedule, timeSlots, cfg), "근무시간표");

  const roster = [["연번","구분","학과","학번","이름","연락처","비고"]];
  sortedByName(members).forEach((m, i) => roster.push([i + 1, "도서관", m.dept||"", m.studentId||"", m.name, m.phone||"", m.note||""]));
  XLSX.utils.book_append_sheet(wb, simpleSheet(roster, [6.78, 8.78, 22.78, 10.78, 8.78, 14.78, 18.78]), "장학생명단");

  // 집계는 화면(통계·주간 바)과 같은 memberStats를 쓴다. 따로 세면 화면과 엑셀의 숫자가 갈라진다
  const summary = [["이름","학과","학번","주간 근로시간","주간 한도","잔여","일일 한도"]];
  memberStats(members, schedule, timeSlots, cfg).rows.forEach(({ member: m, week, cap }) =>
    summary.push([m.name, m.dept||"", m.studentId||"", week, cap, cap - week, cfg.maxDailyHours]));
  XLSX.utils.book_append_sheet(wb, simpleSheet(summary, [8.78, 20.78, 10.78, 12.78, 8.78, 8.78, 8.78]), "주간요약");

  XLSX.utils.book_append_sheet(wb, simpleSheet([
    ["항목","값"],
    ["개관 시각", `${cfg.openHour}:${String(cfg.openMin).padStart(2,"0")}`],
    ["폐관 시각", `${cfg.closeHour}:${String(cfg.closeMin).padStart(2,"0")}`],
    ["첫 슬롯(분)", cfg.firstSlotMins],
    ["기본 슬롯(분)", cfg.slotMins],
    ["주간 최대 시간", cfg.maxWeeklyHours],
    ["일일 최대 시간", cfg.maxDailyHours],
  ], [14.78, 12.78]), "운영설정");

  return wb;
}

export function exportToExcel(schedule, members, timeSlots, cfg) {
  XLSX.writeFile(buildWorkbook(schedule, members, timeSlots, cfg), "도서관_근로시간표.xlsx");
}
