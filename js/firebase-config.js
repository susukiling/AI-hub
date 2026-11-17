// 公開しても問題ない設定値の置き場です（AIのAPIキー〈Groq・Gemini〉は、ここに書かないでください）。
//
// ■ Firebase: コンソール → プロジェクトの設定 → マイアプリ(ウェブ) の firebaseConfig。
//   firebaseConfigは公開されても問題ない値です（守るのはFirestoreのルールと、承認済みドメインの設定）。
//   空にした場合は、アプリの「設定」画面に貼った値を使います。
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAWkbqTkw694kENn0j4seAm-T9o6ManOoI",
  authDomain: "ai-hub-00.firebaseapp.com",
  projectId: "ai-hub-00",
  storageBucket: "ai-hub-00.firebasestorage.app",
  messagingSenderId: "275342734734",
  appId: "1:275342734734:web:86145132dca11534aa20df"
};

// ■ 共有プロキシ: cloudflare/ のWorkerをデプロイしたURL。
//   入れておくと、自分のキーを持たない人もGoogleログインだけでAIを使えます。
window.ORBIT_PROXY_URL = '';
// window.ORBIT_PROXY_URL = 'https://orbit-proxy.xxxx.workers.dev';

// ■ reCAPTCHA v3 のサイトキー（Firebase App Check用。サイトキーは公開値です）。
window.RECAPTCHA_SITE_KEY = '';

// ■ Googleドライブのファイル選択（Picker）用。どちらも公開してよい値です。
//   キーはHTTPリファラーとPicker APIに制限してあること（制限なしのキーは貼らないでください）。
window.PICKER_API_KEY = 'AIzaSyCpBPM5JbYFj7SVaH6RfW4FX5PSKC1c4Js';
window.GCP_PROJECT_NUMBER = '275342734734';
