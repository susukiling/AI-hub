// Firebaseコンソール → プロジェクトの設定 → マイアプリ(ウェブ) の firebaseConfig をここに貼ると、
// 全員が同じ設定でGoogleログインできます。空のままなら、アプリの「設定」画面に貼った値を使います。
// firebaseConfigは公開されても問題ない値です（守るのはFirestoreのルールと、承認済みドメインの設定）。
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAWkbqTkw694kENn0j4seAm-T9o6ManOoI",
  authDomain: "ai-hub-00.firebaseapp.com",
  projectId: "ai-hub-00",
  storageBucket: "ai-hub-00.firebasestorage.app",
  messagingSenderId: "275342734734",
  appId: "1:275342734734:web:86145132dca11534aa20df"
};
// 例:
// window.FIREBASE_CONFIG = {
//   apiKey: "...",
//   authDomain: "your-project.firebaseapp.com",
//   projectId: "your-project",
//   appId: "..."
// };
