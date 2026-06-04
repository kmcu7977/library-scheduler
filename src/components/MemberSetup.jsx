import { useState } from "react";
import { FLOOR_OPTIONS, DEFAULT_COLORS, EMPTY_INFO } from "../constants";

export default function MemberSetup({ members, setMembers, onNext, onBack }) {
  const [form, setForm] = useState({ name: "", ...EMPTY_INFO, isNight: false, timeSlot: null });
  const [editTarget, setEditTarget] = useState(null);
  const [editInfo, setEditInfo] = useState({ ...EMPTY_INFO, preferFloor1: null, preferFloor2: null, isNight: false, timeSlot: null });
  const upForm = (f, v) => setForm(prev => ({ ...prev, [f]: v }));

  const addMember = () => {
    const n = form.name.trim();
    if (!n || members.find(m => m.name === n)) return;
    setMembers(prev => [...prev, {
      name: n, dept: form.dept.trim(), studentId: form.studentId.trim(),
      phone: form.phone.trim(), note: form.note.trim(),
      color: DEFAULT_COLORS[prev.length % DEFAULT_COLORS.length], classes: [], preferFloor1: null, preferFloor2: null, isNight: form.isNight, timeSlot: form.timeSlot,
    }]);
    setForm({ name: "", ...EMPTY_INFO, isNight: false, timeSlot: null });
  };

  const openEdit = m => {
    setEditTarget(m.name);
    setEditInfo({ dept: m.dept||"", studentId: m.studentId||"", phone: m.phone||"", note: m.note||"", preferFloor1: m.preferFloor1||null, preferFloor2: m.preferFloor2||null, isNight: m.isNight||false, timeSlot: m.timeSlot||null });
  };
  const saveEdit = () => {
    setMembers(prev => prev.map(m => m.name !== editTarget ? m : { ...m, ...editInfo }));
    setEditTarget(null);
  };

  return (
    <div className="step-card" style={{ maxWidth: 820 }}>
      <h2 className="step-title">① 근로자 등록</h2>
      <div className="member-form-grid">
        {[
          { f: "name",      label: "이름*",   ph: "이름",          cls: "mf-name", required: true },
          { f: "dept",      label: "학과",    ph: "학과명",         cls: "mf-wide" },
          { f: "studentId", label: "학번",    ph: "학번",           cls: "mf-mid" },
          { f: "phone",     label: "연락처",   ph: "010-0000-0000", cls: "mf-phone" },
          { f: "note",      label: "비고",    ph: "특이사항",        cls: "mf-wide" },
        ].map(({ f, label, ph, cls }) => (
          <div key={f} className="mf-row">
            <label className="mf-label">{label}</label>
            <input className={`text-input ${cls}`} placeholder={ph} value={form[f]}
              onChange={e => upForm(f, e.target.value)}
              onKeyDown={e => f === "name" && e.key === "Enter" && addMember()} />
          </div>
        ))}
        <div className="mf-row" style={{ alignItems: "center" }}>
          <label className="mf-label">야간</label>
          <button
            style={{ fontSize: 12, fontWeight: 700, border: "1px solid", borderRadius: 6, padding: "5px 14px", cursor: "pointer",
              background: form.isNight ? "#1a237e" : "transparent",
              color: form.isNight ? "#fff" : "#90a4ae",
              borderColor: form.isNight ? "#1a237e" : "#cfd8dc" }}
            onClick={() => { upForm("isNight", !form.isNight); if (!form.isNight) upForm("timeSlot", "주간"); }}>
            {form.isNight ? "야간 학생 ✓" : "일반 학생"}
          </button>
        </div>
        <button className="btn-primary mf-add" onClick={addMember}>추가</button>
      </div>

      {members.length > 0 && (
        <div className="member-pref-table">
          <div className="pref-table-header">
            <span style={{ minWidth: 24, fontSize: 11, color: "#78909c" }}>No</span>
            <span className="pref-col-name">이름</span>
            <span style={{ flex: 1, fontSize: 11, color: "#78909c" }}>학과 / 학번</span>
            <span style={{ minWidth: 110, fontSize: 11, color: "#78909c" }}>연락처</span>
            <span style={{ minWidth: 180, fontSize: 11, color: "#78909c" }}>선호 층 (1순위 / 2순위)</span>
            <span style={{ minWidth: 70, fontSize: 11, color: "#78909c" }}>비고</span>
            <span style={{ minWidth: 44, fontSize: 11, color: "#78909c", textAlign: "center" }}>야간</span>
            <span style={{ minWidth: 88, fontSize: 11, color: "#78909c", textAlign: "center" }}>주간/야간</span>
            <span style={{ minWidth: 28 }} />
          </div>
          {members.map((m, idx) => (
            <div key={m.name} className="pref-table-row" style={{ borderLeft: `3px solid ${m.color}` }}>
              <span style={{ minWidth: 24, fontSize: 12, color: "#546e7a" }}>{idx + 1}</span>
              <span className="pref-col-name" style={{ color: m.color, fontWeight: 700, cursor: "pointer" }}
                title="클릭하여 수정" onClick={() => openEdit(m)}>{m.name}</span>
              <span style={{ flex: 1, fontSize: 11, color: "#607d8b" }}>
                {m.dept || <span style={{ color: "#b0bec5" }}>—</span>}
                {m.studentId && <span style={{ color: "#546e7a", marginLeft: 6 }}>({m.studentId})</span>}
              </span>
              <span style={{ minWidth: 110, fontSize: 11, color: "#607d8b" }}>{m.phone || <span style={{ color: "#b0bec5" }}>—</span>}</span>
              <div style={{ minWidth: 180, display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "#90a4ae", minWidth: 28 }}>1순위</span>
                  {FLOOR_OPTIONS.map(floor => (
                    <button key={floor}
                      className={"pref-floor-btn" + (m.preferFloor1 === floor ? " selected" : "")}
                      style={m.preferFloor1 === floor ? { borderColor: m.color, color: m.color, background: m.color + "22" } : {}}
                      onClick={() => setMembers(prev => prev.map(x => x.name !== m.name ? x : { ...x, preferFloor1: x.preferFloor1 === floor ? null : floor }))}>
                      {m.preferFloor1 === floor && "✓ "}{floor}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "#b0bec5", minWidth: 28 }}>2순위</span>
                  {FLOOR_OPTIONS.map(floor => (
                    <button key={floor}
                      className={"pref-floor-btn" + (m.preferFloor2 === floor ? " selected" : "")}
                      style={m.preferFloor2 === floor ? { borderColor: m.color + "99", color: m.color + "99", background: m.color + "11" } : { opacity: 0.65 }}
                      onClick={() => setMembers(prev => prev.map(x => x.name !== m.name ? x : { ...x, preferFloor2: x.preferFloor2 === floor ? null : floor }))}>
                      {m.preferFloor2 === floor && "✓ "}{floor}
                    </button>
                  ))}
                </div>
              </div>
              <span style={{ minWidth: 70, fontSize: 11, color: "#607d8b", overflow: "hidden", textOverflow: "ellipsis" }}>{m.note || ""}</span>
              <button
                style={{ minWidth: 44, fontSize: 11, fontWeight: 700, border: "1px solid", borderRadius: 6, padding: "2px 6px", cursor: "pointer",
                  background: m.isNight ? "#1a237e" : "transparent",
                  color: m.isNight ? "#fff" : "#b0bec5",
                  borderColor: m.isNight ? "#1a237e" : "#cfd8dc" }}
                onClick={() => setMembers(prev => prev.map(x => x.name !== m.name ? x : {
                  ...x, isNight: !x.isNight, timeSlot: !x.isNight ? "주간" : x.timeSlot
                }))}>
                야간
              </button>
              <div style={{ minWidth: 88, display: "flex", gap: 3 }}>
                {["주간", "야간"].map(ts => (
                  <button key={ts}
                    style={{ flex: 1, fontSize: 11, fontWeight: 700, border: "1px solid", borderRadius: 6, padding: "2px 0", cursor: "pointer",
                      background: m.timeSlot === ts ? "#37474f" : "transparent",
                      color: m.timeSlot === ts ? "#fff" : "#b0bec5",
                      borderColor: m.timeSlot === ts ? "#37474f" : "#cfd8dc" }}
                    onClick={() => setMembers(prev => prev.map(x => x.name !== m.name ? x : { ...x, timeSlot: x.timeSlot === ts ? null : ts }))}>
                    {ts}
                  </button>
                ))}
              </div>
              <button className="remove-btn" onClick={() => setMembers(prev => prev.filter(x => x.name !== m.name))}>✕</button>
            </div>
          ))}
        </div>
      )}

      {editTarget && (
        <div className="cell-popup-overlay" onClick={() => setEditTarget(null)}>
          <div className="cell-popup" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <p className="popup-title">
              <span style={{ color: members.find(m => m.name === editTarget)?.color }}>{editTarget}</span> 정보 수정
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { key: "dept",      label: "학과",   ph: "학과명" },
                { key: "studentId", label: "학번",   ph: "학번" },
                { key: "phone",     label: "연락처", ph: "010-0000-0000" },
                { key: "note",      label: "비고",   ph: "특이사항" },
              ].map(({ key, label, ph }) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ minWidth: 44, fontSize: 12, color: "#546e7a" }}>{label}</label>
                  <input className="text-input" style={{ flex: 1, padding: "7px 10px", fontSize: 13 }}
                    placeholder={ph} value={editInfo[key]}
                    onChange={e => setEditInfo(prev => ({ ...prev, [key]: e.target.value }))} />
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <label style={{ minWidth: 44, fontSize: 12, color: "#546e7a", paddingTop: 4 }}>선호 층</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#90a4ae", minWidth: 36 }}>1순위</span>
                    {FLOOR_OPTIONS.map(floor => {
                      const color = members.find(m => m.name === editTarget)?.color || "#1976d2";
                      const sel = editInfo.preferFloor1 === floor;
                      return (
                        <button key={floor} className={"pref-floor-btn" + (sel ? " selected" : "")}
                          style={sel ? { borderColor: color, color, background: color + "22" } : {}}
                          onClick={() => setEditInfo(prev => ({ ...prev, preferFloor1: prev.preferFloor1 === floor ? null : floor }))}>
                          {sel && "✓ "}{floor}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: "#b0bec5", minWidth: 36 }}>2순위</span>
                    {FLOOR_OPTIONS.map(floor => {
                      const color = members.find(m => m.name === editTarget)?.color || "#1976d2";
                      const sel = editInfo.preferFloor2 === floor;
                      return (
                        <button key={floor} className={"pref-floor-btn" + (sel ? " selected" : "")}
                          style={sel ? { borderColor: color + "99", color: color + "99", background: color + "11" } : { opacity: 0.65 }}
                          onClick={() => setEditInfo(prev => ({ ...prev, preferFloor2: prev.preferFloor2 === floor ? null : floor }))}>
                          {sel && "✓ "}{floor}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <label style={{ minWidth: 44, fontSize: 12, color: "#546e7a" }}>주간/야간</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {["주간", "야간"].map(ts => (
                    <button key={ts}
                      style={{ fontSize: 12, fontWeight: 700, border: "1px solid", borderRadius: 6, padding: "4px 14px", cursor: "pointer",
                        background: editInfo.timeSlot === ts ? "#37474f" : "transparent",
                        color: editInfo.timeSlot === ts ? "#fff" : "#90a4ae",
                        borderColor: editInfo.timeSlot === ts ? "#37474f" : "#cfd8dc" }}
                      onClick={() => setEditInfo(prev => ({ ...prev, timeSlot: prev.timeSlot === ts ? null : ts }))}>
                      {ts}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <label style={{ minWidth: 44, fontSize: 12, color: "#546e7a" }}>야간</label>
                <button
                  style={{ fontSize: 12, fontWeight: 700, border: "1px solid", borderRadius: 6, padding: "4px 14px", cursor: "pointer",
                    background: editInfo.isNight ? "#1a237e" : "transparent",
                    color: editInfo.isNight ? "#fff" : "#90a4ae",
                    borderColor: editInfo.isNight ? "#1a237e" : "#cfd8dc" }}
                  onClick={() => setEditInfo(prev => ({ ...prev, isNight: !prev.isNight, timeSlot: !prev.isNight ? "주간" : prev.timeSlot }))}>
                  {editInfo.isNight ? "야간 학생 ✓" : "일반 학생"}
                </button>
              </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="btn-back" style={{ padding: "8px 16px" }} onClick={() => setEditTarget(null)}>취소</button>
              <button className="btn-primary" style={{ padding: "8px 20px" }} onClick={saveEdit}>저장</button>
            </div>
          </div>
        </div>
      )}

      <div className="nav-row">
        <button className="btn-back" onClick={onBack}>← 뒤로</button>
        {members.length > 0 && <button className="btn-next" onClick={onNext}>다음: 수업시간 입력 →</button>}
      </div>
    </div>
  );
}
