/* connectors.js: コネクタ画面。AIに見せる情報の切り替えと、各サービスの「できること／できないこと」 */
(function(){
'use strict';
const O = window.O;
const { $ } = O;
const dlg = $('#connectors');

function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}
const SHARE = [
  ['events', '今日の予定', 'Jarvisと提案フィードに渡す'],
  ['tasks', 'タスク', '未完了のタスク'],
  ['weather', '天気', '選んだ場所の天気'],
  ['news', 'ニュース', '主要ニュースの見出し'],
  ['screen', 'スクリーンタイム', 'このアプリの利用時間など'],
  ['profile', 'プロフィール', '設定に書いた自己紹介・口調']
];
/* status: live=使える / soon=次の更新 */
const SERVICES = [
  { id:'calendar', name:'Googleカレンダー', status:'live', can:['今日の予定を読む', '確認カードで「予定に入れる」を押したときだけ追加する'], cant:['予定の削除・変更', '他人の予定の共有'] },
  { id:'photos', name:'Googleフォト', status:'live', can:['あなたが選んだ写真だけ読む（Picker）'], cant:['アルバム全体の閲覧', '写真の削除・変更'] },
  { id:'drive', name:'Googleドライブ', status:'soon', can:['あなたが選んだファイルだけAIに見せる（drive.file）'], cant:['選んでいないファイルの閲覧', '共有設定の変更', 'ファイルの削除'] },
  { id:'docs', name:'ドキュメント / スライド / スプレッドシート / フォーム', status:'soon',
    can:['読む', '書き込む（毎回、内容を見せて確認ボタンを押してから）'],
    cant:['確認なしの書き込み', '削除は「どこからどこまで消すか」を説明し、確認ボタンを2回押すまで実行しない'] },
  { id:'gas', name:'Apps Script（GAS）', status:'soon',
    can:['コードを読む', 'コードを書き換える（変更点の差分を見せて確認してから）'],
    cant:['実行は絶対にしない', '権限の付与は絶対にしない', 'トリガー作成・デプロイはしない'], warn:'既にトリガーが設定されたスクリプトは、書き換えると次の自動実行で新しいコードが動きます。書き換え前に、トリガーの有無をお知らせします。' },
  { id:'gmail', name:'Gmail', status:'soon', can:['メールを読む', '履歴を検索する（差出人・期間・キーワード）'], cant:['送信・返信・削除・ラベル変更'], warn:'メール本文はGeminiにだけ渡し、Groq系には渡しません。' },
  { id:'chat', name:'Google Chat', status:'soon', can:['メッセージを読む', '履歴を検索する'], cant:['送信・削除'], warn:'Chat APIは、公式にはWorkspace（会社・学校）のアカウント向けです。個人のGmailでは使えない場合があります。' },
  { id:'classroom', name:'Classroom', status:'soon', can:['自分の課題・提出状況を読む（読み取り専用）'], cant:['課題の作成・提出・採点'] }
];

function statusOf(s){
  if(s.status === 'soon') return ['準備中', 'soon'];
  if(s.id === 'calendar' || s.id === 'photos') return O.google.valid ? ['連携中', 'on'] : [O.user ? '未連携' : '未ログイン', 'off'];
  return ['', ''];
}
function render(){
  const sb = $('#shareBox'); sb.textContent = '';
  SHARE.forEach(([k, t, d]) => {
    const l = el('label', 'switch');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!O.cfg.share[k];
    cb.onchange = () => { O.cfg.share[k] = cb.checked; O.saveCfg(); };
    const sp = el('span'); sp.append(el('b', '', t), el('small', '', ' ' + d));
    l.append(cb, sp); sb.append(l);
  });
  const box = $('#connList'); box.textContent = '';
  SERVICES.forEach(s => {
    const c = el('details', 'svc'); c.dataset.id = s.id;
    const sm = el('summary'); const [lab, cls] = statusOf(s);
    sm.append(el('b', '', s.name)); if(lab) sm.append(el('span', 'state ' + cls, lab));
    c.append(sm);
    const g = el('div', 'svc-body');
    g.append(el('h6', '', 'できること')); const u1 = el('ul'); s.can.forEach(x => u1.append(el('li', '', x))); g.append(u1);
    g.append(el('h6', '', 'しないこと')); const u2 = el('ul', 'no'); s.cant.forEach(x => u2.append(el('li', '', x))); g.append(u2);
    if(s.warn) g.append(el('p', 'hint', s.warn));
    if((s.id === 'calendar' || s.id === 'photos') && !O.google.valid){
      const b = el('button', 'btn sm primary', O.user ? 'カレンダー・フォトを連携' : 'Googleでログイン'); b.type = 'button';
      b.onclick = () => { dlg.close(); O.user ? O.ui.doConnect() : O.ui.doLogin(); };
      g.append(b);
    }
    if(s.status === 'soon') g.append(el('p', 'hint', '次の更新で対応します。Google側の設定（APIの有効化・権限）が必要なので、準備ができたらご案内します。'));
    c.append(g); box.append(c);
  });
}
O.connectors = { open(){ render(); if(!dlg.open) dlg.showModal(); } };
$('#closeConnectors').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', e => { if(e.target === dlg) dlg.close(); });
})();
