/* vision.js: 画像読み取りページ。画像 → 予定 / タスク / 問題(HTML) / 文字 */
(function(){
'use strict';
const O = window.O;
const { $, $$, toast, pad } = O;
let image = null, mode = 'events', busy = false;

function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone:'Asia/Tokyo' });
const localInput = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function setImage(it){
  image = it;
  const pv = $('#visPreview');
  pv.src = it.thumb; pv.hidden = false; $('#visHint').hidden = true;
  $('#visOut').textContent = '';
}
async function pick(files){
  const f = Array.from(files || []).find(x => (x.type || '').startsWith('image/'));
  if(!f){ toast('画像ファイルを選んでください'); return; }
  try{ setImage(await O.attach.prepareImage(f)); }catch(e){ toast(e.message); }
}

/* ---------- プロンプト ---------- */
function prompt(m){
  const base = `あなたは画像の内容を正確に読み取るアシスタントです。今日は${today()}（日本時間、Asia/Tokyo）。画像に書かれていないことを推測で作らないでください。読み取れない部分は省きます。JSONだけを返し、前後に文章やコードブロックは付けません。`;
  if(m === 'events') return base + '\n画像から、カレンダーに入れるべき予定を抜き出してください。\n{"events":[{"title":"予定名","start":"YYYY-MM-DDTHH:mm","end":"YYYY-MM-DDTHH:mm","note":"場所や持ち物など(任意)"}]}\n年が書かれていなければ今日以降の直近の日付とします。終了時刻が不明なら開始の1時間後にします。時刻が全く無い予定は09:00開始にします。';
  if(m === 'tasks') return base + '\n画像から、やることリスト（タスク）を抜き出してください。\n{"tasks":["タスク1","タスク2"]}\n1件は短く具体的に、最大20件。';
  if(m === 'quiz') return base + '\n画像の内容から、学習用のクイズを作ってください。\n{"title":"クイズの題","questions":[{"q":"問題文","choices":["選択肢A","選択肢B","選択肢C","選択肢D"],"answer":0,"explain":"正解の理由を1〜2文"}]}\n5〜8問。answerは正解の選択肢の番号(0始まり)。答えは画像の内容に基づくものだけにします。';
  return base + '\n画像の文字を、できるだけそのまま書き起こしてください。\n{"text":"書き起こし"}';
}

/* ---------- 結果の検査 ---------- */
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
function cleanEvents(j){
  return (Array.isArray(j && j.events) ? j.events : []).slice(0, 20).map(e => {
    const s = new Date(e && e.start); if(isNaN(s)) return null;
    let en = new Date(e.end); if(isNaN(en) || en <= s) en = new Date(s.getTime() + 3600e3);
    return { title:str(e.title, 120) || '(無題)', start:s, end:en, note:str(e.note, 200) };
  }).filter(Boolean);
}
const cleanTasks = j => (Array.isArray(j && j.tasks) ? j.tasks : []).map(t => str(typeof t === 'string' ? t : t && t.text, 200).trim()).filter(Boolean).slice(0, 20);
function cleanQuiz(j){
  const qs = (Array.isArray(j && j.questions) ? j.questions : []).slice(0, 10).map(x => {
    const ch = (Array.isArray(x && x.choices) ? x.choices : []).map(c => str(c, 120)).filter(Boolean).slice(0, 6);
    const a = Math.round(+x.answer);
    if(!x || !x.q || ch.length < 2 || !(a >= 0 && a < ch.length)) return null;
    return { q:str(x.q, 300), choices:ch, answer:a, explain:str(x.explain, 300) };
  }).filter(Boolean);
  return { title:str(j && j.title, 60) || 'クイズ', questions:qs };
}

/* ---------- クイズHTML（自分で組み立てる。AIの文章はJSONの値として埋め込むだけ） ---------- */
function quizRuntime(){
  const D = JSON.parse(document.getElementById('d').textContent);
  const root = document.getElementById('q'); let score = 0, done = 0;
  document.getElementById('t').textContent = D.title;
  D.questions.forEach((x, i) => {
    const c = document.createElement('section');
    const h = document.createElement('h2'); h.textContent = (i + 1) + '. ' + x.q; c.append(h);
    const ex = document.createElement('p'); ex.className = 'ex'; ex.hidden = true; ex.textContent = x.explain;
    x.choices.forEach((t, k) => {
      const b = document.createElement('button'); b.textContent = t;
      b.onclick = () => {
        if(c.dataset.d) return; c.dataset.d = 1; done++;
        const ok = k === x.answer; if(ok) score++;
        b.className = ok ? 'ok' : 'ng';
        if(!ok) c.querySelectorAll('button')[x.answer].className = 'ok';
        ex.hidden = false; ex.textContent = (ok ? '正解。 ' : '不正解。 ') + x.explain;
        if(done === D.questions.length) document.getElementById('s').textContent = '結果: ' + score + ' / ' + D.questions.length;
      };
      c.append(b);
    });
    c.append(ex); root.append(c);
  });
}
function quizHtml(q){
  const data = JSON.stringify(q).replace(/</g, '\\u003c');
  const css = 'body{font:16px/1.6 system-ui,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#fff;color:#1a1f2b}h1{font-size:22px}h2{font-size:17px;margin:0 0 8px}section{border:1px solid #d7dbe4;border-radius:12px;padding:14px;margin:14px 0}button{display:block;width:100%;text-align:left;margin:6px 0;padding:10px 12px;border:1px solid #c5cad6;border-radius:8px;background:#f6f7fb;font:inherit;cursor:pointer}button.ok{background:#d9f5e3;border-color:#2e9e5b}button.ng{background:#fde1e1;border-color:#d04545}.ex{font-size:14px;color:#445}#s{font-weight:700;font-size:18px}';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${q.title.replace(/[<>&]/g, '')}</title><style>${css}</style></head><body><h1 id="t"></h1><div id="q"></div><p id="s"></p><script type="application/json" id="d">${data}</script><script>(${quizRuntime.toString()})()</script></body></html>`;
}

/* ---------- 表示 ---------- */
function out(){ const o = $('#visOut'); o.textContent = ''; return o; }
function showEvents(list, o){
  if(!list.length){ o.append(el('p', 'empty', '予定が見つかりませんでした。')); return; }
  const rows = [];
  list.forEach(ev => {
    const r = el('div', 'vrow');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = true; cb.setAttribute('aria-label', '追加する');
    const t = el('input', 'field'); t.value = ev.title; t.setAttribute('aria-label', '予定名');
    const s = el('input', 'field'); s.type = 'datetime-local'; s.value = localInput(ev.start); s.setAttribute('aria-label', '開始');
    const e = el('input', 'field'); e.type = 'datetime-local'; e.value = localInput(ev.end); e.setAttribute('aria-label', '終了');
    r.append(cb, t, s, e); if(ev.note) r.append(el('small', '', ev.note));
    o.append(r); rows.push({ cb, t, s, e });
  });
  const ex = O.accounts.list.filter(O.accounts.valid);
  let target = null;
  if(ex.length){
    target = el('select', 'select'); target.setAttribute('aria-label', '追加先のアカウント');
    [O.user && O.user.email].concat(ex.map(x => x.email)).forEach(m => { if(m){ const op = el('option', '', m); op.value = m; target.append(op); } });
    o.append(target);
  }
  const add = el('button', 'btn primary', '選んだ予定をカレンダーに追加'); add.type = 'button';
  add.onclick = async () => {
    const sel = rows.filter(r => r.cb.checked);
    if(!sel.length){ toast('追加する予定を選んでください'); return; }
    if(!O.google.valid){ toast('カレンダーとの連携が必要です'); O.user ? O.ui.doConnect() : O.ui.doLogin(); return; }
    add.disabled = true; let n = 0;
    for(const r of sel){
      try{ await O.createEvent({ title:r.t.value, start:new Date(r.s.value), end:new Date(r.e.value) }, target && target.value); n++; r.cb.checked = false; r.cb.disabled = true; }
      catch(err){ toast('追加できませんでした: ' + err.message); break; }
    }
    add.disabled = false;
    if(n){ toast(`${n}件の予定を追加しました`); O.ui.loadEvents(); }
  };
  o.append(add, el('p', 'hint', '日時は追加前に直せます。追加するまでカレンダーは変わりません。'));
}
function showTasks(list, o){
  if(!list.length){ o.append(el('p', 'empty', 'タスクが見つかりませんでした。')); return; }
  const rows = list.map(t => {
    const r = el('div', 'vrow one'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = true;
    const f = el('input', 'field'); f.value = t; r.append(cb, f); o.append(r); return { cb, f };
  });
  const add = el('button', 'btn primary', '選んだタスクを追加'); add.type = 'button';
  add.onclick = () => {
    const sel = rows.filter(r => r.cb.checked && r.f.value.trim());
    sel.forEach(r => { O.ui.addTask(r.f.value.trim()); r.cb.checked = false; r.cb.disabled = true; });
    if(sel.length) toast(`${sel.length}件のタスクを追加しました`);
  };
  o.append(add);
}
function showQuiz(q, o){
  if(!q.questions.length){ o.append(el('p', 'empty', '問題を作れませんでした。文字がはっきり写った画像で試してください。')); return; }
  const html = quizHtml(q);
  const fr = el('iframe', 'vframe'); fr.setAttribute('sandbox', 'allow-scripts'); fr.title = q.title; fr.srcdoc = html;
  const dl = el('button', 'btn sm', 'HTMLを保存'); dl.type = 'button';
  dl.onclick = () => {
    const a = el('a'); a.href = URL.createObjectURL(new Blob([html], { type:'text/html' })); a.download = 'quiz.html';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  o.append(el('p', 'hint', `${q.title}（${q.questions.length}問）。このHTMLは1つのファイルで動き、保存して友達に送れます。`), fr, dl);
}

/* ---------- 実行 ---------- */
async function run(){
  if(busy) return;
  if(!image){ toast('先に画像を選んでください'); return; }
  busy = true; $('#visRun').disabled = true; $('#visRun').textContent = '読み取り中…';
  const o = out(); o.append(el('p', 'empty', 'Geminiが画像を読んでいます…'));
  try{
    const r = await O.callAI('gemini', {
      system:prompt(mode), json:true, tag:'vision', mode, user:'画像を読み取る', temperature:.2, maxTokens:3000,
      messages:[{ role:'user', content:'この画像を読み取ってください。', media:[{ mime:image.mime, data:image.data }] }]
    });
    const j = O.safeJSON(r.text) || {};
    const o2 = out();
    let title = '', body = '';
    if(mode === 'events'){ const l = cleanEvents(j); showEvents(l, o2); title = '画像→予定'; body = l.map(e => `${localInput(e.start)} ${e.title}`).join('\n'); }
    else if(mode === 'tasks'){ const l = cleanTasks(j); showTasks(l, o2); title = '画像→タスク'; body = l.join('\n'); }
    else if(mode === 'quiz'){ const q = cleanQuiz(j); showQuiz(q, o2); title = '画像→' + q.title; body = q.questions.map((x, i) => `${i + 1}. ${x.q}`).join('\n'); }
    else{
      const t = str(j.text, 20000);
      o2.append(el('pre', 'vtext', t || '文字が見つかりませんでした。'));
      const cp = el('button', 'btn sm', 'コピー'); cp.type = 'button';
      cp.onclick = () => navigator.clipboard.writeText(t).then(() => toast('コピーしました'), () => toast('コピーできませんでした'));
      o2.append(cp); title = '画像→文字'; body = t;
    }
    if(r.demo) o2.prepend(el('p', 'hint', 'デモ表示です。キーを設定するか、Googleログインすると、実際に画像を読み取ります。'));
    if(body) O.hist.record('vision', title, [{ role:'user', text:'画像を読み取り（' + ({ events:'予定', tasks:'タスク', quiz:'問題', text:'文字' })[mode] + '）' }, { role:'ai', agent:r.agent, demo:r.demo, text:body }]);
    O.log(r.agent, '画像読み取り: ' + mode);
  }catch(e){
    const o3 = out(); o3.append(el('p', 'err-text', '読み取りに失敗しました: ' + e.message));
  }finally{
    busy = false; $('#visRun').disabled = false; $('#visRun').textContent = '読み取る';
  }
}

/* デモ（キーもAI Logicも無いとき、動作が分かる例を返す） */
O.demoVision = function(m){
  const d = new Date(Date.now() + 86400e3), ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if(m === 'events') return { events:[{ title:'三者面談（サンプル）', start:ymd + 'T15:00', end:ymd + 'T15:30', note:'デモ表示' }] };
  if(m === 'tasks') return { tasks:['プリントに名前を書く（サンプル）', '持ち物を確認する（サンプル）'] };
  if(m === 'quiz') return { title:'サンプルクイズ', questions:[{ q:'日本の首都は？', choices:['大阪', '東京', '京都', '札幌'], answer:1, explain:'東京都です。' }] };
  return { text:'（デモ表示）ここに画像の文字が入ります。' };
};

/* ---------- 入力 ---------- */
const drop = $('#visDrop');
drop.addEventListener('click', () => $('#visFile').click());
drop.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); $('#visFile').click(); } });
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('dropping'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('dropping')));
drop.addEventListener('drop', e => { e.preventDefault(); pick(e.dataTransfer.files); });
$('#visFile').addEventListener('change', e => { pick(e.target.files); e.target.value = ''; });
$('#visCam').addEventListener('change', e => { pick(e.target.files); e.target.value = ''; });
$('#visCamBtn').addEventListener('click', () => $('#visCam').click());
document.addEventListener('paste', e => {
  if($('.vision').hidden) return;
  const f = Array.from((e.clipboardData && e.clipboardData.files) || []);
  if(f.length){ e.preventDefault(); pick(f); }
});
$$('#visModes button').forEach(b => b.addEventListener('click', () => {
  mode = b.dataset.mode;
  $$('#visModes button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
}));
$('#visRun').addEventListener('click', run);

O.vision = { setImage };
})();
