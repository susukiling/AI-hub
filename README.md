# Orbit（AI-hub）

あなた専属のエージェント／マネージャー。Gemini・Llama・GPT-OSS（Groq）が連携して動き、毎日のホームに「今日の天気・予定・やること・ニュース」と「Geminiからの提案」を並べます。
デザインはグラスモーフィズム × ベントーグリッド × オーロラ。ビルド不要の静的サイトです。

## できること

| 機能 | 内容 |
|---|---|
| ブリーフィング | 挨拶と、Geminiが書く「今日の一言」。Jarvisへの入力欄つき |
| 提案フィード | Geminiが天気・予定・タスク・利用時間を見て「これやってみませんか？」とカードを置く。ボタンでタスク追加・タイマー・AIチームへの依頼・カレンダー登録まで実行 |
| 天気 | Open-Meteo（キー不要）。場所は設定で選択 |
| 今日の予定 | Googleカレンダー（ログイン後） |
| ニュース | Gemini＋Google検索で主要ニュースを取得し、出典リンクつきで表示 |
| スクリーンタイム | このアプリの利用時間を自動記録。端末全体の合計は手入力 |
| フォト | Googleフォトのピッカーで選んだ写真を表示 |
| Jarvis | 声か文字で操作。ウェイクワード「ジャービス」「オービット」は設定でオン |
| AI Team | Geminiが計画 → LlamaとGPT-OSSが並列で実行 → Geminiが統合 |

予定の登録など取り消しにくい操作は、AIが直接実行せず、フィードに確認カードを出してからボタンで実行します。

## 使い方

1. `index.html` をChromeかEdgeで開く（GitHub Pagesで公開してもよい）
2. メニュー →「設定」にAPIキーを入れる
   - Groq: https://console.groq.com/keys
   - Gemini: https://aistudio.google.com/apikey
3. キーなしでもデモモードで画面と流れを確認できます

## Googleログイン・同期（Firebase）の設定

1. [Firebaseコンソール](https://console.firebase.google.com/)でプロジェクトを作る
2. Authentication → Sign-in method で **Google** を有効にする
3. Authentication → 設定 → 承認済みドメインに、公開するドメイン（例: `susukiling.github.io`）を追加する
4. Firestore Database を作成し、`firestore.rules` の内容をルールに貼って公開する
5. プロジェクトの設定 → マイアプリ（ウェブ）の `firebaseConfig` を、アプリの設定画面か `js/firebase-config.js` に貼る
6. [Google Cloud コンソール](https://console.cloud.google.com/)の同じプロジェクトで次を有効にする
   - Google Calendar API
   - Google Photos Picker API
7. OAuth同意画面にスコープ `calendar.events` と `photospicker.mediaitems.readonly` を追加する。公開前の「テスト」状態では、使う人のGoogleアカウントを「テストユーザー」に登録する

同期されるのは、タスク・提案フィード・利用時間・今日の一言だけです。**APIキーは同期されず、このブラウザにだけ残ります。**

## 公開（GitHub Pages）

リポジトリの Settings → Pages で、ブランチ `main` のルートを公開します。

## 制限と注意

- **スクリーンタイム**: ブラウザからは端末全体（iOSのスクリーンタイム、AndroidのDigital Wellbeing）を読めません。OSの値を手入力するか、将来のネイティブアプリ版（Android: UsageStatsManager）で自動取得します。
- **フォト**: Googleの仕様変更（2025年）で、アプリはライブラリ全体を読めず、ピッカーで「その場で選んだ写真」だけ読めます。
- **カレンダーとフォトの接続は約1時間で切れます**（ブラウザ内のアクセストークンのため）。切れたら「再接続」を押してください。
- **APIキーはブラウザ内に保存**され、各社のAPIへ直接送られます。自分専用の使い方向けです。複数人に配る場合は、Firebase Functionsなどサーバー側でキーを持って中継する構成にしてください。
- ニュースはGeminiのGoogle検索連携を使います。この機能の利用条件（検索候補の表示など）はGoogleの規約に従ってください。
- 「GPT」はGroqで動くオープンモデル `gpt-oss-120b` です。モデル名は設定で変えられます。

## ファイル構成

```
index.html           画面
css/base.css         ガラス・オーロラ・共通部品
css/home.css         ホームのグリッドと各タイル
js/core.js           保存・設定・AI呼び出し・デモ
js/services.js       天気・Googleログイン・カレンダー・フォト・利用時間・同期
js/app.js            画面の動き（フィード、Jarvis、AI Team、メニュー、設定）
js/firebase-config.js  firebaseConfigの置き場
firestore.rules      Firestoreのルール
```

## 参考にした考え方

- 前提（プロフィール）を毎回渡す、質問してから動く、段階的に進める（[しくみタス](https://note.com/shikumitas/n/n26836c4b74b8)）
- 小さく動かしてから広げる、処理を分けて詰まりを切り分ける、取り消せない操作は確認を挟む、キーを公開リポジトリに入れない（[jarvis-build-guide](https://github.com/voixa/jarvis-build-guide)）
