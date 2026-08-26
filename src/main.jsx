import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import ClassTimetablePage from "./components/ClassTimetablePage.jsx";

// #classes 로 열면 수업시간표만 있는 화면이 뜬다 (시간표 화면의 "🗗 새 탭으로 열기"가 여는 주소).
// 라우터를 들이는 대신 해시 하나로 갈라놓는다 — 화면이 둘뿐이고 주소를 옮겨 다닐 일도 없다
const isClassTab = window.location.hash.replace(/^#\/?/, "") === "classes";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {isClassTab ? <ClassTimetablePage /> : <App />}
  </StrictMode>
);
