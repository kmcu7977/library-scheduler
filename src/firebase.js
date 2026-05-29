import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get } from "firebase/database";

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
