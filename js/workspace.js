/* workspace.js: ドキュメント / スプレッドシート / スライド / フォームへの書き込み。
   ・対象は、ドライブのPickerで選んだファイルだけ
   ・AIは「提案」を出すだけ。書き込みは、内容を見せて確認ボタンを押したときにだけ行う
   ・削除は、どこを消すかを説明し、確認ボタンを2回押したときにだけ行う */
(function(){
'use strict';
const O = window.O;
const { toast, log } = O;
const G = 'application/vnd.google-apps.';
const KIND = { [G + 'document']:'doc', [G + 'spreadsheet']:'sheet', [G + 'presentation']:'slide', [G + 'form']:'form' };
const KNAME = { doc:'ドキュメント', sheet:'スプレッドシート', slide:'スライド', form:'フォーム' };
const TYPES = {
  doc_append:'doc', doc_replace:'doc', doc_delete:'doc',
  sheet_write:'sheet', sheet_append:'sheet', sheet_clear:'sheet',
  slide_replace:'slide', slide_add:'slide',
  form_add_question:'form', form_delete_question:'form'
};
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const clip = (t, n) => t.length > n ? t.slice(0, n) + '…' : t;

function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}

/* ---------- AIが出したactionの検査 ---------- */
const A1 = /^('[^']{1,60}'|[^'!:]{1,60})!([A-Za-z]{1,3}\d{1,7})(:[A-Za-z]{1,3}\d{1,7})?$/;
function grid(v){
  if(!Array.isArray(v) || !v.length || v.length > 50) return null;
  let n = 0;
  const out = [];
  for(const row of v){
    if(!Array.isArray(row) || !row.length || row.length > 20) return null;
    out.push(row.map(c => (typeof c === 'number' && isFinite(c)) ? c : str(c, 500)));
    n += row.length;
  }
  return n <= 200 ? out : null;
}
function clean(a){
  if(!a || !TYPES[a.type] || !O.cfg.share.write) return null;
  const f = str(a.file, 100).trim(); if(!f) return null;
  const o = { type:a.type, file:f };
  switch(a.type){
    case 'doc_append': o.text = str(a.text, 5000); return o.text.trim() ? o : null;
    case 'doc_replace': o.find = str(a.find, 500); o.replace = str(a.replace, 2000); return o.find ? o : null;
    case 'doc_delete': o.find = str(a.find, 1000); return o.find.length >= 2 ? o : null;
    case 'sheet_write': o.range = str(a.range, 80).trim(); o.values = grid(a.values); return A1.test(o.range) && o.values ? o : null;
    case 'sheet_append': o.sheet = str(a.sheet, 60).trim().replace(/'/g, ''); o.values = grid(a.values); return o.sheet && o.values ? o : null;
    case 'sheet_clear': o.range = str(a.range, 80).trim(); return A1.test(o.range) ? o : null;
    case 'slide_replace': o.find = str(a.find, 300); o.replace = str(a.replace, 1000); return o.find ? o : null;
    case 'slide_add': o.title = str(a.title, 200); o.body = str(a.body, 2000); return o.title.trim() ? o : null;
    case 'form_add_question':
      o.title = str(a.title, 300); o.kind = a.kind === 'choice' ? 'choice' : 'text';
      o.options = (Array.isArray(a.options) ? a.options : []).map(x => str(x, 100).trim()).filter(Boolean).slice(0, 12);
      return o.title.trim() && (o.kind === 'text' || o.options.length >= 2) ? o : null;
    case 'form_delete_question': o.title = str(a.title, 300); return o.title.trim() ? o : null;
  }
  return null;
}

/* ---------- Google API ---------- */
async function api(url, opts){
  try{ return await (await O.gfetch(url, opts)).json(); }
  catch(e){
    if(e.message === 'AUTH') throw new Error('Googleとの連携が切れています。「連携を更新」を押してください');
    if(/has not been used|disabled|not enabled/i.test(e.message)) throw new Error('Google Cloud Consoleで、このAPI（Docs/Sheets/Slides/Forms）を有効にしてください。' + e.message);
    if(/404|not found/i.test(e.message)) throw new Error('ファイルが見つかりません。コネクタ画面でファイルを選び直してください');
    throw e;
  }
}
const post = (url, body, method) => api(url, { method:method || 'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) });
const E = encodeURIComponent;

function findFile(name, kind){
  const all = O.drive.files().filter(f => KIND[f.mime] === kind);
  const n = name.toLowerCase();
  const ex = all.filter(f => f.name.toLowerCase() === n);
  if(ex.length === 1) return ex[0];
  const part = all.filter(f => f.name.toLowerCase().includes(n) || n.includes(f.name.toLowerCase()));
  if(part.length === 1) return part[0];
  throw new Error(part.length > 1 ? `「${name}」に当てはまるファイルが複数あります` : `「${name}」という${KNAME[kind]}は、選んだファイルの中にありません。コネクタ画面で選んでください`);
}

/* ---------- ドキュメント ---------- */
function walkDoc(content, out){
  (content || []).forEach(el => {
    if(el.paragraph) (el.paragraph.elements || []).forEach(e => { if(e.textRun) out.push(e); });
    else if(el.table) (el.table.tableRows || []).forEach(r => (r.tableCells || []).forEach(c => walkDoc(c.content, out)));
  });
}
function docFlat(doc){
  const runs = []; walkDoc(doc.body && doc.body.content, runs);
  let flat = ''; const map = [];
  runs.forEach(e => { const c = e.textRun.content || ''; for(let k = 0; k < c.length; k++){ flat += c[k]; map.push(e.startIndex + k); } });
  return { flat, map };
}
function occurrences(flat, map, find, max){
  const out = []; let i = 0;
  while(out.length < max && (i = flat.indexOf(find, i)) >= 0){
    const start = map[i], end = map[i + find.length - 1] + 1;
    out.push({ off:i, start, end, ok:end - start === find.length });
    i += find.length;
  }
  return out;
}
const around = (flat, o, len) => ({ before:flat.slice(Math.max(0, o.off - 24), o.off).replace(/\n/g, '↵'), hit:flat.slice(o.off, o.off + len).replace(/\n/g, '↵'), after:flat.slice(o.off + len, o.off + len + 24).replace(/\n/g, '↵') });

async function prepDoc(a, f){
  const url = `https://docs.googleapis.com/v1/documents/${E(f.id)}`;
  if(a.type === 'doc_append'){
    return { title:'ドキュメントに追記', lines:['文書の末尾に、次の文章を追加します。ほかの部分は変わりません。'], after:a.text,
      run:() => post(url + ':batchUpdate', { requests:[{ insertText:{ endOfSegmentLocation:{ segmentId:'' }, text:'\n' + a.text } }] }) };
  }
  const doc = await api(url);
  const { flat, map } = docFlat(doc);
  const occ = occurrences(flat, map, a.find, 50);
  if(!occ.length) throw new Error(`「${clip(a.find, 30)}」は文書の中に見つかりませんでした（表以外の本文で検索しています）`);
  if(a.type === 'doc_replace'){
    const ex = occ.slice(0, 3).map(o => around(flat, o, a.find.length));
    return { title:'ドキュメントの文章を置き換え',
      lines:[`文書の中の「${clip(a.find, 40)}」を、すべて置き換えます（${occ.length}か所）。`, ...ex.map(x => `例: …${x.before}【${x.hit}】${x.after}…`)],
      before:a.find, after:a.replace,
      run:() => post(url + ':batchUpdate', { requests:[{ replaceAllText:{ containsText:{ text:a.find, matchCase:true }, replaceText:a.replace } }] }) };
  }
  // doc_delete
  if(occ.length > 10) throw new Error(`消す対象が${occ.length}か所あり、多すぎます。範囲をもっと具体的に指定してください`);
  if(occ.some(o => !o.ok)) throw new Error('消す範囲に、画像などの文字以外のものが含まれているため、安全のため実行しません');
  if(a.find.length > 2000 || a.find.length > flat.length * 0.5) throw new Error('文書の半分以上を消す操作は、安全のため実行しません');
  const total = occ.length * a.find.length;
  const ex = occ.slice(0, 5).map(o => around(flat, o, a.find.length));
  return { title:'ドキュメントの文章を削除', danger:true,
    lines:[`次の文章を、文書の中から削除します。${occ.length}か所、合計${total}文字です。`,
      ...ex.map((x, i) => `${i + 1}か所目（文書の${occ[i].start}〜${occ[i].end}文字目）: …${x.before}【${x.hit}】${x.after}…`),
      '【 】の中が、消える部分です。', 'Googleドキュメントの「変更履歴」から、元に戻せます。'],
    before:a.find,
    run:() => post(url + ':batchUpdate', { requests:occ.slice().sort((p, q) => q.start - p.start).map(o => ({ deleteContentRange:{ range:{ startIndex:o.start, endIndex:o.end } } })) }) };
}

/* ---------- スプレッドシート ---------- */
const showGrid = v => (v || []).slice(0, 8).map(r => r.map(c => String(c)).join(' | ')).join('\n') + ((v || []).length > 8 ? `\n…（あと${v.length - 8}行）` : '');
async function prepSheet(a, f){
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${E(f.id)}/values/`;
  if(a.type === 'sheet_append'){
    const rng = `'${a.sheet}'`;
    return { title:'スプレッドシートに行を追加', lines:[`シート「${a.sheet}」の、表の最後に${a.values.length}行を追加します。既存のセルは変わりません。`], after:showGrid(a.values),
      run:() => post(`${base}${E(rng)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values:a.values }) };
  }
  const cur = (await api(base + E(a.range))).values || [];
  const cells = cur.reduce((n, r) => n + r.length, 0);
  if(a.type === 'sheet_write'){
    return { title:'スプレッドシートに書き込み',
      lines:[`範囲 ${a.range} に、次の値を書き込みます。`, cells ? `この範囲には、いま${cells}個の値が入っていて、上書きされます。` : 'この範囲は、いま空です。', '数式としては解釈せず、文字・数字としてそのまま入れます。'],
      before:cells ? showGrid(cur) : '', after:showGrid(a.values),
      run:() => post(base + E(a.range) + '?valueInputOption=RAW', { values:a.values }, 'PUT') };
  }
  if(!cells) throw new Error(`範囲 ${a.range} は、すでに空です`);
  return { title:'スプレッドシートの値を削除', danger:true,
    lines:[`範囲 ${a.range} の値を、すべて消去します。${cur.length}行・${cells}個の値が空になります。`, '書式（色・罫線）は残り、値だけが消えます。', 'Googleスプレッドシートの「変更履歴」から、元に戻せます。'],
    before:showGrid(cur),
    run:() => post(base + E(a.range) + ':clear', {}) };
}

/* ---------- スライド ---------- */
function slideTexts(pres){
  const out = [];
  (pres.slides || []).forEach((s, i) => (s.pageElements || []).forEach(pe => {
    const t = pe.shape && pe.shape.text; if(!t) return;
    const txt = (t.textElements || []).map(e => (e.textRun && e.textRun.content) || '').join('');
    if(txt.trim()) out.push({ slide:i + 1, text:txt });
  }));
  return out;
}
async function prepSlide(a, f){
  const url = `https://slides.googleapis.com/v1/presentations/${E(f.id)}`;
  if(a.type === 'slide_add'){
    const t = 'orbit_t_' + Date.now().toString(36), b = 'orbit_b_' + Date.now().toString(36);
    const reqs = [{ createSlide:{ slideLayoutReference:{ predefinedLayout:'TITLE_AND_BODY' }, placeholderIdMappings:[
      { layoutPlaceholder:{ type:'TITLE', index:0 }, objectId:t }, { layoutPlaceholder:{ type:'BODY', index:0 }, objectId:b }] } },
      { insertText:{ objectId:t, text:a.title } }];
    if(a.body.trim()) reqs.push({ insertText:{ objectId:b, text:a.body } });
    return { title:'スライドを1枚追加', lines:['プレゼンの最後に、新しいスライドを1枚追加します。ほかのスライドは変わりません。'], after:`${a.title}\n\n${a.body}`,
      run:() => post(url + ':batchUpdate', { requests:reqs }) };
  }
  const texts = slideTexts(await api(url));
  const hits = texts.filter(x => x.text.includes(a.find));
  const n = texts.reduce((c, x) => c + x.text.split(a.find).length - 1, 0);
  if(!n) throw new Error(`「${clip(a.find, 30)}」はスライドの中に見つかりませんでした`);
  return { title:'スライドの文章を置き換え',
    lines:[`プレゼン全体の「${clip(a.find, 40)}」を、すべて置き換えます（${n}か所）。`, `対象のスライド: ${[...new Set(hits.map(x => x.slide))].join('、')}枚目`],
    before:a.find, after:a.replace,
    run:() => post(url + ':batchUpdate', { requests:[{ replaceAllText:{ containsText:{ text:a.find, matchCase:true }, replaceText:a.replace } }] }) };
}

/* ---------- フォーム ---------- */
async function readForm(id){
  const fm = await api(`https://forms.googleapis.com/v1/forms/${E(id)}`);
  const items = (fm.items || []).map((it, i) => {
    const q = it.questionItem && it.questionItem.question;
    const opts = q && q.choiceQuestion ? '（選択肢: ' + (q.choiceQuestion.options || []).map(o => o.value).join(' / ') + '）' : '';
    return `${i + 1}. ${it.title || '(無題)'}${opts}`;
  });
  return `フォーム「${(fm.info && fm.info.title) || ''}」\n${(fm.info && fm.info.description) || ''}\n` + items.join('\n');
}
async function prepForm(a, f){
  const url = `https://forms.googleapis.com/v1/forms/${E(f.id)}`;
  const fm = await api(url);
  const items = fm.items || [];
  if(a.type === 'form_add_question'){
    const question = a.kind === 'choice' ? { choiceQuestion:{ type:'RADIO', options:a.options.map(v => ({ value:v })) } } : { textQuestion:{ paragraph:false } };
    return { title:'フォームに質問を追加', lines:[`フォームの最後（${items.length + 1}番目）に、質問を1つ追加します。ほかの質問は変わりません。`],
      after:a.title + (a.kind === 'choice' ? '\n' + a.options.map(o => '○ ' + o).join('\n') : '\n（記述式）'),
      run:() => post(url + ':batchUpdate', { requests:[{ createItem:{ item:{ title:a.title, questionItem:{ question } }, location:{ index:items.length } } }] }) };
  }
  const idx = items.map((it, i) => ({ it, i })).filter(x => (x.it.title || '') === a.title);
  if(idx.length !== 1) throw new Error(idx.length ? '同じ題名の質問が複数あるため、実行しません' : `質問「${clip(a.title, 30)}」は見つかりませんでした`);
  const { it, i } = idx[0];
  const q = it.questionItem && it.questionItem.question;
  return { title:'フォームの質問を削除', danger:true,
    lines:[`${i + 1}番目の質問「${clip(it.title, 60)}」を、フォームから削除します。`, q && q.choiceQuestion ? '選択肢: ' + (q.choiceQuestion.options || []).map(o => o.value).join(' / ') : '', 'この質問への回答は、フォームの結果画面で見られなくなる場合があります。'].filter(Boolean),
    before:it.title,
    run:() => post(url + ':batchUpdate', { requests:[{ deleteItem:{ location:{ index:i } } }] }) };
}

async function prepare(a){
  const kind = TYPES[a.type], f = findFile(a.file, kind);
  const p = await ({ doc:prepDoc, sheet:prepSheet, slide:prepSlide, form:prepForm })[kind](a, f);
  p.file = f; p.kind = kind; return p;
}

/* ---------- 確認ダイアログ ---------- */
let dlg = null;
function ensureDlg(){
  if(dlg) return dlg;
  dlg = el('dialog'); dlg.id = 'wsConfirm'; document.body.append(dlg);
  return dlg;
}
function ask(p){
  return new Promise(resolve => {
    const d = ensureDlg(); d.textContent = '';
    let step = 1, done = false;
    const finish = v => { if(done) return; done = true; if(d.open) d.close(); resolve(v); };
    const draw = () => {
      d.textContent = '';
      const box = el('div', 'wsc' + (p.danger ? ' danger' : ''));
      box.append(el('h3', '', p.danger && step === 2 ? '最終確認: 本当に削除しますか？' : p.title));
      box.append(el('p', 'wsc-file', `${KNAME[p.kind]}「${p.file.name}」`));
      if(!(p.danger && step === 2)){
        p.lines.forEach(l => box.append(el('p', 'wsc-line', l)));
        if(p.before){ box.append(el('h6', '', p.danger ? '消える内容' : '書き換わる前')); box.append(el('pre', 'wsc-pre before', clip(p.before, 1200))); }
        if(p.after){ box.append(el('h6', '', p.kind === 'doc' && !p.before ? '追加される内容' : '書き込まれる内容')); box.append(el('pre', 'wsc-pre after', clip(p.after, 1500))); }
      }else{
        box.append(el('p', 'wsc-line', '1回目の確認は済んでいます。もう一度、押すと実行します。'));
        box.append(el('pre', 'wsc-pre before', clip(p.before || '', 400)));
      }
      const row = el('div', 'dlg-actions');
      const no = el('button', 'btn', 'やめる'); no.type = 'button'; no.onclick = () => finish(false);
      const go = el('button', 'btn ' + (p.danger ? 'danger' : 'primary'), p.danger ? (step === 1 ? '消える内容を確認した（1/2）' : '削除する（2/2）') : 'この内容で書き込む');
      go.type = 'button';
      go.onclick = () => { if(p.danger && step === 1){ step = 2; draw(); } else finish(true); };
      if(p.danger && step === 2){ go.disabled = true; setTimeout(() => { go.disabled = false; }, 1500); }
      row.append(no, go); box.append(row);
      d.append(box);
    };
    d.addEventListener('close', () => finish(false), { once:true });
    draw(); d.showModal();
  });
}

let chain = Promise.resolve();
function propose(a){
  chain = chain.then(async () => {
    try{
      const p = await prepare(a);
      if(!await ask(p)){ log('sys', '書き込みをやめました: ' + p.title); toast('やめました。何も変更していません'); return; }
      await p.run();
      O.drive.invalidate(p.file.id);
      log('sys', `${p.title}: ${p.file.name}`); toast(`${p.title} を実行しました`);
    }catch(e){
      log('sys', '書き込みできませんでした: ' + e.message); toast('書き込みできませんでした: ' + e.message);
    }
  });
}

O.ws = {
  clean, propose, readForm,
  isWs:t => !!TYPES[t],
  canWrite:() => !!O.cfg.share.write && O.drive.files().some(f => KIND[f.mime]),
  label:a => ({ doc_append:'ドキュメントに追記', doc_replace:'ドキュメントを置換', doc_delete:'ドキュメントの文章を削除', sheet_write:'シートに書き込み', sheet_append:'シートに行を追加', sheet_clear:'シートの値を削除', slide_replace:'スライドを置換', slide_add:'スライドを追加', form_add_question:'フォームに質問を追加', form_delete_question:'フォームの質問を削除' })[a.type]
};
})();
