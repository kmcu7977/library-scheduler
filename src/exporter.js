import * as XLSX from "xlsx";
import { DAYS, FLOOR_KEYS } from "./constants";

export function exportToExcel(schedule, members, timeSlots, cfg) {
  const wb = XLSX.utils.book_new();

  const ws_data = [];
  const h1 = ["시간"]; DAYS.forEach(d => h1.push(d, "", "", "")); ws_data.push(h1);
  const h2 = [""]; DAYS.forEach(() => h2.push("2층","3층","3층","4층")); ws_data.push(h2);
  timeSlots.forEach((slot, si) => {
    const row = [slot.label.replace("\n", " ")];
    DAYS.forEach(day => FLOOR_KEYS.forEach(fk => row.push(schedule[day]?.[si]?.[fk] || "")));
    ws_data.push(row);
  });
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  ws["!cols"] = [{ wch: 20 }, ...Array(DAYS.length * 4).fill({ wch: 9 })];
  ws["!merges"] = DAYS.map((_, di) => ({ s: { r: 0, c: 1 + di * 4 }, e: { r: 0, c: 1 + di * 4 + 3 } }));
  XLSX.utils.book_append_sheet(wb, ws, "근무시간표");

  const ws_roster = [["연번","구분","학과","학번","이름","연락처","비고"]];
  members.forEach((m, i) => ws_roster.push([i + 1, "도서관", m.dept||"", m.studentId||"", m.name, m.phone||"", m.note||""]));
  const wsR = XLSX.utils.aoa_to_sheet(ws_roster);
  wsR["!cols"] = [{ wch: 6 },{ wch: 8 },{ wch: 22 },{ wch: 10 },{ wch: 8 },{ wch: 14 },{ wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsR, "장학생명단");

  const ws_sum = [["이름","학과","학번","주간 근로시간","주간 한도","잔여","일일 한도"]];
  members.forEach(m => {
    let total = 0;
    DAYS.forEach(day => timeSlots.forEach((slot, si) => FLOOR_KEYS.forEach(fk => { if (schedule[day]?.[si]?.[fk] === m.name) total += slot.hours; })));
    ws_sum.push([m.name, m.dept||"", m.studentId||"", total, cfg.maxWeeklyHours, cfg.maxWeeklyHours - total, cfg.maxDailyHours]);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(ws_sum);
  ws2["!cols"] = [{ wch: 8 },{ wch: 20 },{ wch: 10 },{ wch: 12 },{ wch: 8 },{ wch: 8 },{ wch: 8 }];
  XLSX.utils.book_append_sheet(wb, ws2, "주간요약");

  const ws_cfg = XLSX.utils.aoa_to_sheet([
    ["항목","값"],
    ["개관 시각", `${cfg.openHour}:${String(cfg.openMin).padStart(2,"0")}`],
    ["폐관 시각", `${cfg.closeHour}:${String(cfg.closeMin).padStart(2,"0")}`],
    ["첫 슬롯(분)", cfg.firstSlotMins],
    ["기본 슬롯(분)", cfg.slotMins],
    ["주간 최대 시간", cfg.maxWeeklyHours],
    ["일일 최대 시간", cfg.maxDailyHours],
  ]);
  ws_cfg["!cols"] = [{ wch: 14 },{ wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws_cfg, "운영설정");

  XLSX.writeFile(wb, "도서관_근로시간표.xlsx");
}
