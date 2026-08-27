// 사서가 손으로 보관해두는 시간표 버전 3칸.
//
// 자동저장(scheduler/data)은 그대로 "지금 상태" 한 벌이고, 여기 담기는 건 그 시점의 복사본이다.
// 한 칸에 운영설정·인원·수업·시간표·📌고정을 통째로 담는다 — 일부만 되돌리면
// "왜 인원은 안 돌아왔지"가 생기기 때문에 되돌리기도 통째로만 한다.
export const SLOTS = [0, 1, 2];

// 불러오기 직전의 상태가 들어가는 숨은 칸. 사용자 몫 3칸을 잡아먹지 않으면서
// "잘못 불러왔다"를 한 번은 되돌릴 수 있게 한다
export const AUTO_SLOT = "auto";

export const makeSnapshot = (state, name, desc = "") => ({
  name: name.trim(),
  desc: desc.trim(),
  savedAt: Date.now(),
  data: {
    cfg: state.cfg,
    members: state.members,
    schedule: state.schedule,
    pins: state.pins,
  },
});

// Firebase는 0·1·2 키를 배열로도 객체로도 돌려준다. 어느 쪽이든 세 칸으로 편다
export const normalizeSnapshots = raw => SLOTS.map(i => raw?.[i] || null);

export const fmtSavedAt = ts => {
  if (!ts) return "";
  const d = new Date(ts);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 칸에 든 내용 요약 — 불러오기 전에 "이게 그 버전이 맞나"를 확인할 근거
export const summarize = snap => {
  const d = snap?.data;
  if (!d) return "";
  const cells = Object.values(d.schedule || {}).reduce(
    (a, day) => a + Object.values(day || {}).reduce(
      (b, slot) => b + Object.values(slot || {}).filter(Boolean).length, 0), 0);
  return `인원 ${(d.members || []).length}명 · 배치 ${cells}칸`;
};
