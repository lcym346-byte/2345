// 其他頁面引用此檔，自動檢查登入狀態
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } 
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, doc, getDoc } 
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

window.firebaseAuth = auth;
window.firebaseDB = db;

export function requireLogin(allowedRoles = null) {
  return new Promise((resolve) => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        location.href = 'index.html';
        return;
      }
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (!userDoc.exists() || userDoc.data().active === false) {
        await signOut(auth);
        location.href = 'index.html';
        return;
      }
      const data = userDoc.data();
      if (allowedRoles && !allowedRoles.includes(data.role)) {
        alert('您沒有權限使用此功能');
        location.href = 'index.html';
        return;
      }
      const currentUser = {
        uid: user.uid,
        email: user.email,
        displayName: data.displayName,
        role: data.role,
        storeId: data.storeId
      };
      sessionStorage.setItem('currentUser', JSON.stringify(currentUser));
      resolve(currentUser);
    });
  });
}

export function logout() {
  signOut(auth).then(() => location.href = 'index.html');
}
