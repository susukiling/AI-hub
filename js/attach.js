/* attach.js: 「＋」メニューと添付（画像・PDF・テキスト） */
(function(){
'use strict';
const O = window.O;
const { $, $$, toast } = O;
const MAX_IMAGES = 4, MAX_TEXT_CHARS = 20000, MAX_PDF = 10 * 1024 * 1024;

function el(tag, cls, text){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(text !== undefined) e.textContent = text;
  return e;
}
const readDataURL = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(new Error('ファイルを読み込めませんでした'));
  r.readAsDataURL(blob);
});

/* 画像は長辺1600pxに縮めてJPEGにする（送信サイズを抑え、読み取りは十分な大きさ） */
async function prepareImage(file){
  const url = URL.createObjectURL(file);
  try{
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('画像を開けませんでした: ' + (file.name || '画像')));
      i.src = url;
    });
    const sc = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * sc)), h = Math.max(1, Math.round(img.naturalHeight * sc));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.88));
    if(!blob) throw new Error('画像を変換できませんでした');
    const dataUrl = await readDataURL(blob);
    return { kind:'image', mime:'image/jpeg', data:dataUrl.split(',')[1], thumb:URL.createObjectURL(blob), name:file.name || '画像' };
  }finally{ URL.revokeObjectURL(url); }
}

const isText = f => (f.type || '').startsWith('text/') || f.type === 'application/json' || /\.(txt|md|csv|tsv|json|log|html|css|js|py)$/i.test(f.name || '');
const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
let items = [];

async function addFiles(list){
  for(const f of Array.from(list || [])){
    try{
      if((f.type || '').startsWith('image/')){
        if(items.filter(i => i.kind === 'image').length >= MAX_IMAGES){ toast(`画像は${MAX_IMAGES}枚までです`); continue; }
        items.push(await prepareImage(f));
      }else if(isPdf(f)){
        if(f.size > MAX_PDF){ toast(`${f.name} は大きすぎます（PDFは10MBまで）`); continue; }
        items.push({ kind:'pdf', mime:'application/pdf', data:(await readDataURL(f)).split(',')[1], name:f.name });
      }else if(isText(f)){
        if(f.size > 2e6){ toast(`${f.name} は大きすぎます（テキストは2MBまで）`); continue; }
        let t = await f.text(); const cut = t.length > MAX_TEXT_CHARS;
        if(cut) t = t.slice(0, MAX_TEXT_CHARS);
        items.push({ kind:'text', name:f.name, text:t, truncated:cut });
      }else{
        toast(`${f.name} は対応していない形式です（画像・PDF・テキスト）`);
      }
    }catch(e){ toast(e.message); }
  }
  render();
}
function render(){
  const bar = $('#attachBar'); bar.textContent = '';
  bar.hidden = !items.length;
  items.forEach(it => {
    const c = el('div', 'att');
    if(it.kind === 'image'){ const im = el('img'); im.src = it.thumb; im.alt = ''; c.append(im); }
    else c.append(el('span', 'att-ico', it.kind === 'pdf' ? 'PDF' : 'TXT'));
    c.append(el('span', 'att-name', it.name + (it.truncated ? '（先頭のみ）' : '')));
    const x = el('button', 'icon-btn', '×'); x.type = 'button'; x.setAttribute('aria-label', it.name + ' を外す');
    x.onclick = () => { items = items.filter(i => i !== it); render(); };
    c.append(x); bar.append(c);
  });
}

O.attach = {
  prepareImage,
  add:addFiles,
  count:() => items.length,
  firstImage:() => items.find(i => i.kind === 'image') || null,
  /* 送信用に取り出す（取り出したら、添付欄は空になる） */
  take(){
    const out = {
      media:items.filter(i => i.kind === 'image' || i.kind === 'pdf').map(i => ({ mime:i.mime, data:i.data })),
      texts:items.filter(i => i.kind === 'text').map(i => ({ name:i.name, text:i.text })),
      names:items.map(i => i.name),
      thumbs:items.filter(i => i.kind === 'image').map(i => i.thumb)
    };
    items = []; render();
    return out;
  }
};

/* ---------- 「＋」メニュー ---------- */
const btn = $('#plusBtn'), menu = $('#plusMenu');
function setMenu(open){
  menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
  if(open){ const f = menu.querySelector('button'); if(f) f.focus(); }
}
btn.addEventListener('click', e => { e.stopPropagation(); setMenu(menu.hidden); });
document.addEventListener('click', e => { if(!menu.hidden && !menu.contains(e.target)) setMenu(false); });
document.addEventListener('keydown', e => { if(e.key === 'Escape' && !menu.hidden){ setMenu(false); btn.focus(); } });
menu.addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if(!b) return;
  setMenu(false);
  const a = b.dataset.act;
  if(a === 'image') $('#imgInput').click();
  else if(a === 'file') $('#fileInput').click();
  else if(a === 'vision'){
    const im = O.attach.firstImage();
    O.ui.setView('vision');
    if(im && O.vision){ O.vision.setImage(im); items = items.filter(i => i !== im); render(); }
  }
  else if(a === 'connectors') O.ui.openConnectors();
});
$('#imgInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
$('#fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });

/* 貼り付け・ドラッグ＆ドロップでも添付できる */
$('#chatInput').addEventListener('paste', e => {
  const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
  if(files.length){ e.preventDefault(); addFiles(files); }
});
const tile = $('.jarvis');
['dragenter', 'dragover'].forEach(ev => tile.addEventListener(ev, e => { e.preventDefault(); tile.classList.add('dropping'); }));
['dragleave', 'drop'].forEach(ev => tile.addEventListener(ev, e => { if(ev === 'dragleave' && tile.contains(e.relatedTarget)) return; tile.classList.remove('dropping'); }));
tile.addEventListener('drop', e => { e.preventDefault(); addFiles(e.dataTransfer.files); });
})();
