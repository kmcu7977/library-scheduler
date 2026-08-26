import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, onValue } from "firebase/database";

const firebaseConfig = {
  apiKey:            "AIzaSyBfMCrCsoMUrJQW9zGpRZvVbcghRUHvMfw",
  authDomain:        "library-scheduler-aec7b.firebaseapp.com",
  databaseURL:       "https://library-scheduler-aec7b-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "library-scheduler-aec7b",
  storageBucket:     "library-scheduler-aec7b.firebasestorage.app",
  messagingSenderId: "393819398330",
  appId:             "1:393819398330:web:a80d7446cb63f71e652283",
};
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);
const DB_PATH = "scheduler/data";

export async function saveToFirebase(data) {
  try { await set(ref(db, DB_PATH), data); return true; }
  catch (e) { console.error("Firebase 저장 실패:", e); return false; }
}

export async function loadFromFirebase() {
  try {
    const snap = await get(ref(db, DB_PATH));
    return snap.exists() ? snap.val() : null;
  } catch (e) { console.error("Firebase 불러오기 실패:", e); throw e; }
}

// 수업시간표 탭은 한 번 읽고 마는 get 대신 구독한다 —
// 본 탭에서 수업을 고치는 즉시 따라와야 두 탭을 나란히 놓고 볼 수 있다. 반환값은 구독 해제 함수
export function subscribeToFirebase(onData, onError) {
  return onValue(ref(db, DB_PATH), snap => onData(snap.exists() ? snap.val() : null), onError);
}
