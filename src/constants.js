export const DAYS         = ["월", "화", "수", "목", "금"];
export const FLOOR_KEYS   = ["f2", "f3a", "f3b", "f4"];
export const FLOOR_LABEL  = { f2: "2층", f3a: "3층", f3b: "3층", f4: "4층" };
export const DAYS_KR      = ["월", "화", "수", "목", "금", "토", "일"];
export const FLOOR_OPTIONS = ["2층", "3층", "4층"];
export const KEY_TO_FLOOR  = { f2: "2층", f3a: "3층", f3b: "3층", f4: "4층" };
export const DEFAULT_COLORS = [
  "#4A90D9","#E06C75","#56B6C2","#98C379","#E5C07B",
  "#C678DD","#61AFEF","#D19A66","#BE5046","#2ECC71",
];
export const PRESETS = {
  semester: { label: "학기 중", openHour: 8, openMin: 30, closeHour: 21, closeMin: 0, firstSlotMins: 90, slotMins: 60, maxWeeklyHours: 20, maxDailyHours: 8 },
  vacation: { label: "방학",    openHour: 9, openMin: 0,  closeHour: 18, closeMin: 0, firstSlotMins: 60, slotMins: 60, maxWeeklyHours: 40, maxDailyHours: 8 },
};
export const EMPTY_INFO = { dept: "", studentId: "", phone: "", note: "" };
