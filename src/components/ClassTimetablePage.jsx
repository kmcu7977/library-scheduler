import { useEffect, useState } from "react";
import { PRESETS } from "../constants";
import { subscribeToFirebase } from "../firebase";
import { ClassTimetableView } from "./ClassTimetable";
import "../App.css";

// 새 탭(#classes)에서 수업시간표만 크게 본다 — 근무표 탭과 나란히 놓고 쓰라고 만든 화면.
// 본 탭과 값을 주고받지 않고 Firebase를 직접 구독한다: 사서가 본 탭에서 수업을 고치면
// 이 탭도 새로고침 없이 따라오고, 두 탭의 내용이 갈라질 일이 없다.
export default function ClassTimetablePage() {
  const [state, setState] = useState({ status: "loading" });
  const [mode, setMode] = useState("split");   // 새 탭은 화면이 넓으니 나란히 보기로 연다

  useEffect(() => {
    document.title = "학생 수업시간표";
    return subscribeToFirebase(
      data => setState({ status: "done", data }),
      () => setState({ status: "error" }),
    );
  }, []);

  if (state.status !== "done") return (
    <div className="class-page-msg" style={{ color: state.status === "error" ? "#e06c75" : "#1976d2" }}>
      {state.status === "error" ? "⚠️ Firebase 연결에 실패했습니다." : "불러오는 중..."}
      {state.status === "error" && (
        <button className="btn-back" style={{ marginTop: 14 }} onClick={() => window.location.reload()}>다시 시도</button>
      )}
    </div>
  );

  // Firebase는 배열을 객체로 되돌리기도 한다 (App.jsx가 하는 정규화와 같은 이유)
  const raw = state.data?.members;
  const members = Array.isArray(raw) ? raw : Object.values(raw || {});
  const cfg = state.data?.cfg || PRESETS.semester;

  return (
    <div className="app class-page">
      <header className="app-header">
        <div className="header-accent" />
        <div className="header-top">
          <h1 className="app-title">도서관 근로장학생 <span>학생 수업시간표</span></h1>
          <span className="save-indicator">🔄 시간표 탭에서 수업을 고치면 여기도 바로 바뀝니다</span>
        </div>
      </header>
      <main className="app-main">
        <div className="step-card wide">
          {members.length === 0
            ? <p style={{ fontSize: 13, color: "#607d8b" }}>등록된 인원이 없습니다. 시간표 탭에서 인원을 먼저 등록해주세요.</p>
            : <ClassTimetableView members={members} cfg={cfg} mode={mode} setMode={setMode} />}
        </div>
      </main>
    </div>
  );
}
