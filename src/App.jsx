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
  const [pins, setPins]           = useState({}); // 사서가 고정한 칸 {요일: {si: {층키: 이름}}}
  const [timeSlots, setTimeSlots] = useState(() => buildTimeSlots(PRESETS.semester));
  const [saveStatus, setSaveStatus]       = useState("idle");
  const [loadStatus, setLoadStatus]       = useState("loading");
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    loadFromFirebase().then(data => {
      if (data) {
        if (data.cfg)     { setCfg(data.cfg); setTimeSlots(buildTimeSlots(data.cfg)); }
        // 예전 데이터 이관: "야간 학생" 플래그는 사실상 주 근무시간 구분이었다 → weeklyHours로 옮긴다
        if (data.members) setMembers(data.members.map(m => {
          if (m.weeklyHours) return m;
          const { isNight, timeSlot, ...rest } = m;
          // 예전 야간 한도(30h 등)를 그대로 옮기면 20/40 선택지 어디에도 안 걸려 화면에 표시되지 않는다
          return { ...rest, weeklyHours: isNight ? 40 : (data.cfg?.maxWeeklyHours ?? 20) };
        }));
        if (data.schedule) {
          const restored = {};
          DAYS.forEach(day => {
            restored[day] = Array.isArray(data.schedule[day])
              ? data.schedule[day]
              : Object.values(data.schedule[day] || {});
          });
          setSchedule(restored);
        }
        if (data.pins) {
          // Firebase는 연속 숫자 키 객체를 배열로 되돌릴 수 있어 정규화
          const restoredPins = {};
          DAYS.forEach(day => {
            const p = data.pins[day];
            if (!p) return;
            const entries = Array.isArray(p) ? p.map((v, i) => [i, v]) : Object.entries(p);
            const dayPins = {};
            entries.forEach(([si, byFloor]) => { if (byFloor) dayPins[si] = byFloor; });
            if (Object.keys(dayPins).length) restoredPins[day] = dayPins;
          });
          setPins(restoredPins);
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
      saveToFirebase({ cfg, members, schedule, pins }).then(ok => {
        setSaveStatus(ok ? "saved" : "error");
        setTimeout(() => setSaveStatus("idle"), 2000);
      });
    }, 800);
    return () => clearTimeout(t);
  }, [cfg, members, schedule, pins]);

  const handleCfgNext = newCfg => {
    setCfg(newCfg);
    setTimeSlots(buildTimeSlots(newCfg));
    setStep(1);
  };

  const emptyGrid = ts => Object.fromEntries(DAYS.map(d => [d, ts.map(() => ({ f2: null, f3a: null, f3b: null, f4: null }))]));

  // 빈 표에서 시작한다 — 사서가 직접 채우고, 남은 빈칸만 "빈칸 채우기"로 넘긴다.
  // 이미 짜둔 시간표가 있으면 그대로 이어서 연다 (운영 설정이 바뀌어 칸 수가 안 맞을 때만 새로)
  const handleGenerate = () => {
    const ts = buildTimeSlots(cfg);
    setTimeSlots(ts);
    const fits = s => s && DAYS.every(d => Array.isArray(s[d]) && s[d].length === ts.length);
    setSchedule(s => (fits(s) ? s : emptyGrid(ts)));
    setStep(3);
  };

  // 빈칸 채우기 — 사서가 지정한 칸(📌)은 그대로 두고 나머지만 자동으로 채운다.
  // 기존 시간표를 앵커로 함께 넘겨 이미 자동으로 채워졌던 칸도 되도록 유지한다(판이 통째로 섞이지 않게)
  const handleRegenerate = () => {
    const ts = buildTimeSlots(cfg);
    setTimeSlots(ts);
    setSchedule(autoSchedule(members, ts, cfg, pins, schedule));
    setStep(3);
  };

  const handleReset = () => {
    setCfg({ ...PRESETS.semester });
    setMembers([]);
    setSchedule(null);
    setPins({});
    setTimeSlots(buildTimeSlots(PRESETS.semester));
    setStep(0);
    setShowResetConfirm(false);
    saveToFirebase({ cfg: PRESETS.semester, members: [], schedule: null, pins: {} });
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
            pins={pins} setPins={setPins} onRegenerate={handleRegenerate}
            onExport={() => exportToExcel(schedule, members, timeSlots, cfg)}
            onBack={() => setStep(2)} timeSlots={timeSlots} cfg={cfg} />
        )}
      </main>

      {showResetConfirm && (
        <div className="cell-popup-overlay" onClick={() => setShowResetConfirm(false)}>
          <div className="cell-popup" onClick={e => e.stopPropagation()} style={{ maxWidth: 320, textAlign: "center" }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#e06c75", marginBottom: 8 }}>⚠️ 전체 초기화</p>
            <p className="popup-title" style={{ marginBottom: 16 }}>
              아래가 모두 삭제되며 되돌릴 수 없습니다.
              <span style={{ display: "block", marginTop: 10, padding: "10px 12px", background: "#ffebee", borderRadius: 8, color: "#b71c1c", fontSize: 13, textAlign: "left", lineHeight: 1.8 }}>
                · 등록한 인원 <b>{members.length}명</b>{members.length > 0 && <span style={{ fontSize: 11 }}> (학과·학번·연락처 포함)</span>}<br />
                · 인원별 수업시간 <b>{members.reduce((a, m) => a + (m.classes?.length || 0), 0)}건</b><br />
                · 작성한 시간표와 📌 고정<br />
                · 운영 설정 (학기 중 기본값으로 되돌아감)
              </span>
              <span style={{ display: "block", marginTop: 10, fontSize: 12, color: "#607d8b" }}>
                시간표만 지우시려면 시간표 화면의 <b>🧹 시간표 비우기</b>를 쓰세요.
              </span>
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button className="btn-back" onClick={() => setShowResetConfirm(false)}>취소</button>
              <button style={{ background: "#e06c75", color: "#fff", border: "none", borderRadius: 10, padding: "11px 24px", fontSize: 13, fontWeight: 700, cursor: "pointer" }} onClick={handleReset}>전부 삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
