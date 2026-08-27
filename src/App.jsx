import { useState, useRef, useEffect } from "react";
import { DAYS, PRESETS } from "./constants";
import { saveToFirebase, loadFromFirebase } from "./firebase";
import { buildTimeSlots, restoreIndexed } from "./utils";
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

  // 저장된 한 벌을 화면 상태로 되돌린다. 처음 불러올 때와 "보관해둔 버전 불러오기"가
  // 같은 경로를 타야 한쪽만 고쳐지는 일이 없다
  const applyData = data => {
    const nextCfg = data.cfg || PRESETS.semester;
    const ts = buildTimeSlots(nextCfg);
    setCfg(nextCfg);
    setTimeSlots(ts);

    const savedMembers = Array.isArray(data.members) ? data.members : Object.values(data.members || {});
    // 예전 데이터 이관: "야간 학생" 플래그는 사실상 주 근무시간 구분이었다 → weeklyHours로 옮긴다
    setMembers(savedMembers.map(m => {
      if (m.weeklyHours) return m;
      const { isNight, timeSlot, ...rest } = m;
      // 예전 야간 한도(30h 등)를 그대로 옮기면 20/40 선택지 어디에도 안 걸려 화면에 표시되지 않는다
      return { ...rest, weeklyHours: isNight ? 40 : (nextCfg.maxWeeklyHours ?? 20) };
    }));

    // 전 층이 빈 시간대는 Firebase가 통째로 빼고 돌려준다 — 인덱스를 살려 되돌린다(restoreIndexed)
    setSchedule(data.schedule
      ? Object.fromEntries(DAYS.map(day => [day, restoreIndexed(data.schedule[day], ts.length)]))
      : null);

    const restoredPins = {};
    DAYS.forEach(day => {
      const p = data.pins?.[day];
      if (!p) return;
      const entries = Array.isArray(p) ? p.map((v, i) => [i, v]) : Object.entries(p);
      const dayPins = {};
      entries.forEach(([si, byFloor]) => { if (byFloor) dayPins[si] = byFloor; });
      if (Object.keys(dayPins).length) restoredPins[day] = dayPins;
    });
    setPins(restoredPins);
  };

  useEffect(() => {
    loadFromFirebase().then(data => {
      if (data) applyData(data);
      loadedRef.current = true;
      setLoadStatus("done");
    }).catch(e => {
      // 연결 실패든 되돌리는 중 터진 오류든 화면은 같은 문구를 보여준다 —
      // 어느 쪽인지는 콘솔에 남겨야 나중에 원인을 찾을 수 있다
      console.error("불러오기 실패:", e);
      setLoadStatus("error");
    });
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

  // 빈칸 채우기 — 사서가 확정한 칸은 그대로 두고 나머지만 자동으로 채운다.
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

  // 단계 이동은 앞뒤 모두 자유롭게. 다만 인원이 없으면 수업 입력·시간표는 볼 게 없어 막는다.
  // 시간표로 바로 뛰어들 때는 표가 준비되어 있어야 하므로 handleGenerate를 거친다
  const canGoStep = i => i <= 1 || members.length > 0;
  const goStep = i => {
    if (!canGoStep(i)) return;
    if (i === 3) handleGenerate();
    else setStep(i);
  };

  if (loadStatus === "loading") return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#e8f4fd", color: "#1976d2", fontSize: 16, fontFamily: "Noto Sans KR, sans-serif" }}>
      불러오는 중...
    </div>
  );

  if (loadStatus === "error") return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "#e8f4fd", color: "#e06c75", fontSize: 15, fontFamily: "Noto Sans KR, sans-serif", gap: 16 }}>
      <span>Firebase에 연결하지 못했습니다.</span>
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
          <div>
            <p className="masthead-eyebrow">도서관 근로장학생</p>
            <h1 className="app-title">{cfg.title?.trim() || "근무시간표 편성"}</h1>
            {cfg.effectiveDate?.trim() && <p className="masthead-meta">시행 {cfg.effectiveDate.trim()}</p>}
          </div>
          <div className="header-actions">
            <span className={`save-indicator ${saveStatus === "saving" ? "saving" : saveStatus === "saved" ? "flash" : saveStatus === "error" ? "error" : ""}`}>
              {saveStatus === "saving" ? "저장 중..." : saveStatus === "error" ? "저장 실패" : "저장됨"}
            </span>
            <button className="btn-reset" onClick={() => setShowResetConfirm(true)}>전체 초기화</button>
          </div>
        </div>
        <div className="step-indicator">
          {STEP_LABELS.map((s, i) => (
            <div key={i} className={`step-dot ${step === i ? "current" : step > i ? "done" : ""} ${canGoStep(i) ? "" : "locked"}`}
              style={{ cursor: canGoStep(i) && step !== i ? "pointer" : "default" }}
              title={canGoStep(i) ? "" : "인원을 먼저 등록해주세요"}
              onClick={() => step !== i && goStep(i)}>
              <span>{String(i).padStart(2, "0")}</span>
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
            onRestore={applyData}
            onBack={() => setStep(2)} timeSlots={timeSlots} cfg={cfg} />
        )}
      </main>

      {showResetConfirm && (
        <div className="cell-popup-overlay" onClick={() => setShowResetConfirm(false)}>
          <div className="cell-popup" onClick={e => e.stopPropagation()} style={{ maxWidth: 320, textAlign: "center" }}>
            <p className="panel-title" style={{ color: "#9C2B2B", marginBottom: 10 }}>전체 초기화</p>
            <p className="popup-title" style={{ marginBottom: 16 }}>
              아래가 모두 삭제되며 되돌릴 수 없습니다.
              <span className="danger-list">
                · 등록한 인원 <b>{members.length}명</b>{members.length > 0 && <span style={{ fontSize: 11 }}> (학과·학번·연락처 포함)</span>}<br />
                · 인원별 수업시간 <b>{members.reduce((a, m) => a + (m.classes?.length || 0), 0)}건</b><br />
                · 작성한 시간표와 확정 표시<br />
                · 운영 설정 (학기 중 기본값으로 되돌아감)
              </span>
              <span style={{ display: "block", marginTop: 10, fontSize: 12, color: "#607d8b" }}>
                시간표만 지우시려면 시간표 화면의 <b>시간표 비우기</b>를 쓰세요.
              </span>
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button className="btn-back" onClick={() => setShowResetConfirm(false)}>취소</button>
              <button className="btn-danger-solid" onClick={handleReset}>전부 삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
