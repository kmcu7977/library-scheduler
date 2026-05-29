import { useState, useRef, useEffect } from "react";
import { DAYS, PRESETS } from "./constants";
import { saveToFirebase, loadFromFirebase } from "./firebase";
import { buildTimeSlots } from "./utils";
import { autoSchedule } from "./scheduler";
import { exportToExcel } from "./exporter";
import OperationSetup from "./components/OperationSetup";
import MemberSetup from "./components/MemberSetup";
import ClassSetup from "./components/ClassSetup";
import ScheduleEditor from "./components/ScheduleEditor";
import "./App.css";

export default function App() {
  const [step, setStep]           = useState(0);
  const [cfg, setCfg]             = useState({ ...PRESETS.semester });
  const [members, setMembers]     = useState([]);
  const [schedule, setSchedule]   = useState(null);
  const [timeSlots, setTimeSlots] = useState(() => buildTimeSlots(PRESETS.semester));
  const [saveStatus, setSaveStatus]       = useState("idle");
  const [loadStatus, setLoadStatus]       = useState("loading");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    loadFromFirebase().then(data => {
      if (data) {
        if (data.cfg)     { setCfg(data.cfg); setTimeSlots(buildTimeSlots(data.cfg)); }
        if (data.members) setMembers(data.members);
        if (data.schedule) {
          const restored = {};
          DAYS.forEach(day => {
            restored[day] = Array.isArray(data.schedule[day])
              ? data.schedule[day]
              : Object.values(data.schedule[day] || {});
          });
          setSchedule(restored);
        }
      }
      loadedRef.current = true;
      setLoadStatus("done");
    }).catch(() => setLoadStatus("error"));
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    setSaveStatus("saving");
    const t = setTimeout(() => {
      saveToFirebase({ cfg, members, schedule }).then(ok => {
        setSaveStatus(ok ? "saved" : "error");
        setTimeout(() => setSaveStatus("idle"), 2000);
      });
    }, 800);
    return () => clearTimeout(t);
  }, [cfg, members, schedule]);

  const handleCfgNext = newCfg => {
    setCfg(newCfg);
    setTimeSlots(buildTimeSlots(newCfg));
    setStep(1);
  };

  const handleGenerate = () => {
    const ts = buildTimeSlots(cfg);
    setTimeSlots(ts);
    setSchedule(autoSchedule(members, ts, cfg));
    setStep(3);
  };

  const handleReset = () => {
    setCfg({ ...PRESETS.semester });
    setMembers([]);
    setSchedule(null);
    setTimeSlots(buildTimeSlots(PRESETS.semester));
    setStep(0);
    setShowResetConfirm(false);
    saveToFirebase({ cfg: PRESETS.semester, members: [], schedule: null });
  };

  const STEP_LABELS = ["운영 설정", "인원 등록", "수업 입력", "시간표"];

  if (loadStatus === "loading") return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#e8f4fd", color: "#1976d2", fontSize: 16, fontFamily: "Noto Sans KR, sans-serif" }}>
      불러오는 중...
    </div>
  );

  if (loadStatus === "error") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#e8f4fd", color: "#e06c75", fontSize: 15, fontFamily: "Noto Sans KR, sans-serif", gap: 16 }}>
      <span>⚠️ Firebase 연결에 실패했습니다.</span>
      <span style={{ fontSize: 12, color: "#607d8b" }}>firebaseConfig 설정값을 확인하거나 네트워크 상태를 확인해주세요.</span>
      <button onClick={() => window.location.reload()} style={{ marginTop: 8, background: "#1976d2", color: "#fff", border: "none", borderRadius: 8, padding: "10px 24px", fontSize: 13, cursor: "pointer" }}>
        새로고침
      </button>
    </div>
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-accent" />
        <div className="header-top">
          <h1 className="app-title">도서관 근로장학생 <span>시간표 생성기</span></h1>
          <div className="header-actions">
            <span className={`save-indicator ${saveStatus === "saving" ? "saving" : saveStatus === "saved" ? "flash" : saveStatus === "error" ? "error" : ""}`}>
              {saveStatus === "saving" ? "저장 중..." : saveStatus === "error" ? "⚠️ 저장 실패" : "💾 저장됨"}
            </span>
            <button className="btn-reset" onClick={() => setShowResetConfirm(true)}>🗑 초기화</button>
          </div>
        </div>
        <div className="step-indicator">
          {STEP_LABELS.map((s, i) => (
            <div key={i} className={`step-dot ${step === i ? "current" : step > i ? "done" : ""}`}
              style={{ cursor: step > i ? "pointer" : "default" }}
              onClick={() => step > i && setStep(i)}>
              <span>{i === 0 ? "⓪" : i}</span>
              <label>{s}</label>
            </div>
          ))}
        </div>
      </header>

      <main className="app-main">
        {step === 0 && <OperationSetup cfg={cfg} onNext={handleCfgNext} />}
        {step === 1 && <MemberSetup members={members} setMembers={setMembers} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <ClassSetup  members={members} setMembers={setMembers} onNext={handleGenerate} onBack={() => setStep(1)} />}
        {step === 3 && schedule && (
          <ScheduleEditor members={members} schedule={schedule} setSchedule={setSchedule}
            onExport={() => exportToExcel(schedule, members, timeSlots, cfg)}
            onBack={() => setStep(2)} timeSlots={timeSlots} cfg={cfg} />
        )}
      </main>

      {showResetConfirm && (
        <div className="cell-popup-overlay" onClick={() => setShowResetConfirm(false)}>
          <div className="cell-popup" onClick={e => e.stopPropagation()} style={{ maxWidth: 320, textAlign: "center" }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#e06c75", marginBottom: 8 }}>⚠️ 초기화</p>
            <p className="popup-title" style={{ marginBottom: 20 }}>저장된 모든 데이터가 삭제됩니다.<br />계속하시겠습니까?</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button className="btn-back" onClick={() => setShowResetConfirm(false)}>취소</button>
              <button style={{ background: "#e06c75", color: "#fff", border: "none", borderRadius: 10, padding: "11px 24px", fontSize: 13, fontWeight: 700, cursor: "pointer" }} onClick={handleReset}>초기화</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
