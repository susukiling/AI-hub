# Orbit（AI-hub）

あなた専属のエージェント／マネージャー。Gemini・Qwen・GPT-OSS（Groq）が連携して動き、毎日のホームに「今日の天気・予定・やること・ニュース」と「Geminiからの提案」を並べます。
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
| AI Team | Geminiが計画 → QwenとGPT-OSSが並列で実行 → Geminiが統合 |

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
5. プロジェクトの設定 → マイアプリ（ウェブ）の `firebaseConfig` を、**コードの `js/firebase-config.js`** に貼る（アプリの設定画面には入力欄がありません）
6. [Google Cloud コンソール](https://console.cloud.google.com/)の同じプロジェクトで次を有効にする
   - Google Calendar API
   - Google Photos Picker API
7. OAuth同意画面にスコープ `calendar.events` と `photospicker.mediaitems.readonly` を追加する。公開前の「テスト」状態では、使う人のGoogleアカウントを「テストユーザー」に登録する

ログインは2段階です。
1. 「Googleでログイン」: 名前とメールだけを使います。ここは手順2・3が済んでいれば通ります。
2. 「カレンダーと連携」: ログイン後に、カレンダーとフォトの権限を追加で許可します。手順6・7が必要です。連携は約1時間で切れるので、切れたらもう一度押します。

ログインに失敗したときは、画面に原因を表示します（承認済みドメインの未登録、Googleログインが無効、ポップアップのブロックなど）。ファイルを直接開く（`file://`）とログインできません。GitHub Pagesか `http://localhost` で開いてください。

同期されるのは、タスク・提案フィード・利用時間・今日の一言だけです。**APIキーは同期されず、このブラウザにだけ残ります。**

## APIキーの置き方

| 方法 | キーの場所 | 向いている使い方 |
|---|---|---|
| Firebase AI Logic（Geminiだけ） | Firebase側。鍵の入力は不要 | Geminiを鍵なしで使う。`js/firebase-config.js` が入っていて、FirebaseコンソールでAI Logic（Gemini Developer API）を有効にしてあれば自動で使われます |
| 設定画面に貼る | 自分のブラウザだけ | 自分専用 |
| 共有プロキシ（Cloudflare Workers） | Workerの暗号化された変数 | 友だちや家族にも使わせる |

設定の「このブラウザにキーを保存する」で、キーを残すかどうかを選べます。オンなら次回も入力不要、オフならタブを閉じると消えます。
Geminiの呼び出し順は、①設定画面に貼った自分のキー → ②Firebase AI Logic → ③共有プロキシ、です。AI Logicが使えるなら、Workerに `GEMINI_API_KEY` を登録しなくても動きます（Groq用のプロキシだけ残せます）。
Qwen・GPT-OSS（Groq）はAI Logicの対象外なので、鍵を入れるかプロキシが必要です。鍵がない間、AI Teamの実行役はGeminiが代わりに務めます。
ニュースの「Google検索の候補」は、Google検索の利用条件で表示が必須なので、画面に出しています。

GitHubのActions secretsは、公開サイトのコードにキーを埋め込む使い方では守れません（完成したJavaScriptに入るため）。代わりに下のプロキシを使います。

## 共有プロキシ（Cloudflare Workers）

ブラウザ → Worker（キーはここだけ） → Groq / Gemini。Googleログインした人だけが通れて、1人あたり1日の回数にも上限があります。

1. Cloudflareの無料アカウントを作り、Node.jsを入れる
2. `cd cloudflare`
3. `npx wrangler kv namespace create RATE` を実行し、出力されたidを `wrangler.toml` の `YOUR_KV_NAMESPACE_ID` に貼る
4. `wrangler.toml` の `FIREBASE_PROJECT_ID` と `ALLOWED_ORIGINS`（例: `https://susukiling.github.io`）を自分の値にする
5. キーを暗号化して登録する
   ```
   npx wrangler secret put GROQ_API_KEY
   npx wrangler secret put GEMINI_API_KEY
   ```
6. `npx wrangler deploy` を実行すると、WorkerのURLが表示される
7. そのURLを `js/firebase-config.js` の `ORBIT_PROXY_URL`、またはアプリの設定画面に入れる

調整できる項目（`wrangler.toml` の `[vars]`）:
- `DAILY_LIMIT`: 1人あたり1日の回数（初期値200）
- `ALLOWED_EMAILS`: 使える人のメールアドレスを絞る
- `GROQ_MODELS` / `GEMINI_MODELS`: 許可するモデル名（カンマ区切り）。初期値にないモデルは、ここに足さないと拒否されます
- `APPCHECK_PROJECT_NUMBER`: reCAPTCHA（App Check）を必須にする。FirebaseでApp Checkを有効にし、reCAPTCHA v3のサイトキーを `RECAPTCHA_SITE_KEY` に入れます

注意:
- 手元のファイルをそのまま開く（`file://`）と、Workerに拒否されます。GitHub Pagesか、`http://localhost:8000` を `ALLOWED_ORIGINS` に足したローカルサーバーで開いてください。
- 回数の記録にはKVを使います。KVの無料枠は書き込み回数に上限があるため（1日1,000回前後）、全員の合計で1日あたりそのくらいが目安です。Cloudflareの現在の無料枠で確認してください。
- 認証・回数制限・許可サイトの判定は、模擬トークンで `cd cloudflare && npm test` により確認済みです。Cloudflare上での実際の動作は未確認です。

## 公開（GitHub Pages）

リポジトリの Settings → Pages で、ブランチ `main` のルートを公開します。

## 制限と注意

- **スクリーンタイム**: ブラウザからは端末全体（iOSのスクリーンタイム、AndroidのDigital Wellbeing）を読めません。OSの値を手入力するか、将来のネイティブアプリ版（Android: UsageStatsManager）で自動取得します。
- **フォト**: Googleの仕様変更（2025年）で、アプリはライブラリ全体を読めず、ピッカーで「その場で選んだ写真」だけ読めます。
- **カレンダーとフォトの接続は約1時間で切れます**（ブラウザ内のアクセストークンのため）。切れたら「再接続」を押してください。
- 設定画面に貼ったAPIキーは、ブラウザ内に保存され、各社のAPIへ直接送られます。自分専用の使い方向けです。複数人に配る場合は、上の共有プロキシを使ってください。
- **キーをコードやリポジトリに書かないでください。** 公開リポジトリでは誰でも読めます。reCAPTCHAでも、コードに書いたキーは守れません。
- ニュースはGeminiのGoogle検索連携を使います。この機能の利用条件（検索候補の表示など）はGoogleの規約に従ってください。
- **モデル名は定期的に古くなります。** Geminiは `gemini-3.6-flash` を既定にしています。「このモデルは使えません」というエラーが出たら、設定画面のモデル名を、[Firebase AI Logicのモデル一覧](https://firebase.google.com/docs/ai-logic/models)にある新しい名前に変えてください。Cloudflare Workerを使っている場合は、`wrangler.toml` の `GEMINI_MODELS` にも同じ名前を足します。
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

## Phase A の機能
- AI Team: Qwen・GPT-OSS・Geminiが独立に答え、互いの誤りを指摘し合って修正（回数は0〜2回）。必要なときだけ「1つにまとめる」。
- 会話履歴: このブラウザに保存し、ログイン中はFirestore（`users/{uid}/convs`）にも同期。検索・再開・削除ができる。
- 「＋」メニュー: 画像・PDF・テキストを添付（画像は長辺1600pxに縮小）。添付はGeminiが読む。Workerを使う場合、Geminiの本文上限は8MB。
- 画像読み取り: 画像 → 予定（確認後にカレンダーへ）/ タスク / 問題（単体のHTML）/ 文字。
- コネクタ: AIに見せる情報の切り替えと、各サービスの「できること／しないこと」の説明。Drive・Docs系・GAS・Gmail・Chat・Classroomは次の段階で対応。

## ドキュメント・スライド・スプレッドシート・フォーム
- 対象は、ドライブのPickerで選んだファイルだけ（権限は `drive.file`）。AIは「提案」を出すだけで、書き込みは確認ダイアログで押したときにだけ実行されます。
- 追記・置き換え・行の追加・スライド／質問の追加は、内容を見せて確認ボタン1回。削除は、消す範囲を説明し、確認ボタン2回。
- 使うには、Google Cloud Consoleで Docs / Sheets / Slides / Forms の各APIを有効にします。
- コネクタ画面の「書き込みの提案」で、まとめてオフにできます。GAS・Gmail・Chat・Classroomは未対応です。
