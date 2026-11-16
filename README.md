# Orbit

GroqとGeminiのAPIで、Llama・GPT-OSS・Geminiが分担して作業するマルチAIハブ。Jarvis風の音声アシスタント付き。
デザインはグラスモーフィズム × ベントーグリッド × オーロラ。

## 使い方

1. `index.html` をChromeかEdgeで開く（GitHub Pagesでも可）
2. メニューの「APIキーとモデルの設定」にキーを入れる
   - Groq: https://console.groq.com/keys
   - Gemini: https://aistudio.google.com/apikey
3. キーなしでもデモモードで動きます

## 構成

- **Jarvis**: 音声・文字で操作。タスク追加、タイマー、AIチームへの依頼を自動実行
- **AI Team**: Geminiが計画 → LlamaとGPT-OSSが並列実行 → Geminiが統合
- **Tasks / Timers / Activity**: 補助タイル

## 注意

APIキーはブラウザのlocalStorageに保存されます。キーをコードに書かず、このリポジトリにもコミットしないでください。
公開サイトとして配るなら、キーはサーバー側（Firebase Functionsなど）に置いて中継する構成にしてください。
