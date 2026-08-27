import { useEffect, useState } from "react";
import { DAYS, FLOOR_KEYS, PRESETS } from "../constants";
import { buildTimeSlots, isLunchSlot, restoreIndexed } from "../utils";
import { AUTO_SLOT, makeSnapshot, fmtSavedAt, summarize } from "../snapshots";
import { loadSnapshot, saveSnapshot, loadFromFirebase, saveToFirebase } from "../firebase";
import "../App.css";

// 보관해둔 버전을 새 탭에서 미리 본다 (#snapshot/0).
// 읽기 전용이다 — 칸을 고칠 수 있게 하면 "보관본"이 아니게 되므로, 할 수 있는 일은
// 통째로 불러오는 것 하나뿐이다
export default function SchedulePreviewPage() {
  const slot = window.location.hash.split("/")[1] ?? "0";
  const [state, setState] = useState({ status: "loading" });
  const [restoring, setRestoring] = useState("");   // "" | "busy" | "done" | 실패 사유

  useEffect(() => {
    document.title = "보관한 시간표 미리보기";
    loadSnapshot(slot)
      .then(snap => setState(snap ? { status: "done", snap } : { status: "empty" }))
      .catch(() => setState({ status: "error" }));
  }, [slot]);

  const restore = async () => {
    setRestoring("busy");
    // 지금 쓰이고 있는 상태를 숨은 칸에 대피시키고 나서 덮는다 (되돌릴 수단을 먼저 만든다)
    const live = await loadFromFirebase().catch(() => null);
    if (live && !(await saveSnapshot(AUTO_SLOT, makeSnapshot(live, "불러오기 직전 상태")))) {
      setRestoring("직전 상태를 보관하지 못해 불러오기를 멈췄습니다.");
      return;
    }
    setRestoring(await saveToFirebase(state.snap.data) ? "done" : "불러오지 못했습니다. 다시 시도해주세요.");
  };

  if (state.status !== "done") return (
    <div className="class-page-msg" style={{ color: state.status === "loading" ? "var(--navy)" : "var(--stamp)" }}>
      {state.status === "loading" ? "불러오는 중..."
        : state.status === "empty" ? "이 칸에는 보관된 버전이 없습니다."
        : "Firebase에 연결하지 못했습니다."}
    </div>
  );

  const { snap } = state;
  const cfg = snap.data?.cfg || PRESETS.semester;
  const timeSlots = buildTimeSlots(cfg);
  const members = Array.isArray(snap.data?.members) ? snap.data.members : Object.values(snap.data?.members || {});
  const colorOf = name => members.find(m => m.name === name)?.color || "#aaa";
  // 저장할 때 전 층이 빈 시간대는 통째로 빠져 돌아온다 — 인덱스를 살려야 줄이 안 밀린다
  const schedule = Object.fromEntries(DAYS.map(d => [d, restoreIndexed(snap.data?.schedule?.[d], timeSlots.length)]));

  return (
    <div className="app class-page">
      <header className="app-header">
        <div className="header-accent" />
        <div className="header-top">
          <div>
            <p className="masthead-eyebrow">보관한 버전</p>
            <h1 className="app-title">{snap.name}</h1>
          </div>
          <span className="save-indicator">미리보기 · 이 화면에서는 고칠 수 없습니다</span>
        </div>
      </header>
      <main className="app-main">
        <div className="step-card wide">
          <div className="editor-header">
            <div>
              <div className="snap-time">{fmtSavedAt(snap.savedAt)} 보관 · {summarize(snap)}</div>
              {snap.desc && <div className="snap-desc" style={{ marginTop: 4 }}>{snap.desc}</div>}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {restoring === "done"
                ? <span className="snap-msg" style={{ margin: 0 }}>불러왔습니다. 시간표 탭을 새로고침하면 이 버전이 보입니다.</span>
                : <>
                    {restoring && restoring !== "busy" && <span className="snap-msg" style={{ margin: 0 }}>{restoring}</span>}
                    <button className="btn-back snap-primary" disabled={restoring === "busy"} onClick={restore}>
                      {restoring === "busy" ? "불러오는 중..." : "이 버전 불러오기"}
                    </button>
                  </>}
            </div>
          </div>
          <div className="table-wrap">
            <table className="sched-table">
              <thead>
                <tr>
                  <th className="th-time" rowSpan={2}>시간</th>
                  {DAYS.map((day, i) => <th key={day} colSpan={4} className={`th-day day-start ${i % 2 ? "alt" : ""}`}>{day}</th>)}
                </tr>
                <tr>
                  {DAYS.flatMap(day => [
                    <th key={`${day}-f2`} className="th-floor day-start">2층</th>,
                    <th key={`${day}-f3`} className="th-floor" colSpan={2}>3층</th>,
                    <th key={`${day}-f4`} className="th-floor">4층</th>,
                  ])}
                </tr>
              </thead>
              <tbody>
                {timeSlots.map((slotDef, si) => {
                  const lunch = isLunchSlot(slotDef);
                  return (
                    <tr key={si}>
                      <td className={`td-time ${lunch ? "lunch-row" : ""}`}>{slotDef.label}</td>
                      {DAYS.flatMap(day => FLOOR_KEYS.map((fk, fi) => {
                        const name = schedule[day]?.[si]?.[fk] || "";
                        const color = colorOf(name);
                        // 점심 칸은 개인 색을 덮는다 (근무표 화면과 같은 규칙)
                        const style = lunch
                          ? { background: "#FEF3C7", color: name ? "#92400E" : "#C9B896", fontWeight: name ? 700 : 400 }
                          : name ? { background: color + "26", color: `color-mix(in srgb, ${color} 62%, #0F172A)`, boxShadow: `inset 3px 0 0 ${color}`, fontWeight: 700 } : {};
                        return (
                          <td key={`${day}-${fk}`}
                            className={`td-cell td-view ${name ? "" : "empty-cell"} ${fi === 0 ? "day-start" : ""} ${lunch ? "lunch-cell" : ""}`}
                            style={style}>
                            {name || "·"}
                          </td>
                        );
                      }))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
