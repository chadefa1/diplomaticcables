/* Minimal PoC browser for unified diplomatic cables (v0.1) */

const DATA_URL = 'data/diplomatic_cables_v0_1.jsonl';

/** @type {Array<object>} */
let DATA = [];
// Multi-select filters
let FILTER = {
  q: '',
  corpora: new Set(['fr','uk','de']),
  types: new Set(['letter','telegram','despatch','memorandum','circular','enclosure','report','note'])
};
let SORT = { key: 'year', dir: 1 }; // 1 asc, -1 desc

function $(sel){ return document.querySelector(sel); }
function el(tag, attrs={}, children=[]) {
  const n = document.createElement(tag);
  Object.entries(attrs).forEach(([k,v]) => {
    if (k === 'class') n.className = v; else n.setAttribute(k, v);
  });
  children.forEach(c => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return n;
}

async function loadData() {
  const resp = await fetch(DATA_URL);
  if (!resp.ok) throw new Error('Failed to load ' + DATA_URL);
  const text = await resp.text();
  DATA = text.split('\n').filter(Boolean).map(line => JSON.parse(line));
  // derive year, from/to
  DATA.forEach(r => {
    r.year = deriveYear(r.date);
    if (!r.sender_raw || !r.recipient_raw) {
      const [from, to] = deriveFromTo(r);
      if (!r.sender_raw) r.sender_raw = from || '';
      if (!r.recipient_raw) r.recipient_raw = to || '';
    }
  });
}

function recordMatches(r) {
  if (!FILTER.corpora.has(r.corpus)) return false;
  if (r.doc_type && !FILTER.types.has(r.doc_type)) return false;
  const q = FILTER.q.trim().toLowerCase();
  if (!q) return true;
  const hay = [r.doc_type, r.corpus, r.series, r.date, r.sender_raw, r.recipient_raw, r.text].join(' ').toLowerCase();
  return hay.includes(q);
}

function deriveYear(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const m = dateStr.match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function deriveFromTo(r) {
  const txt = (r.text || '').split('\n')[0];
  if (!txt) return [null, null];
  // English pattern: "X to Y."
  let m = txt.match(/^(.{3,120}?)\s+to\s+(.{3,120}?)[\.,;:]/i);
  if (m) return [m[1].trim(), m[2].trim()];
  // German pattern: "X an den/die/das Y"
  m = txt.match(/^(.{3,120}?)\s+an\s+(den|die|das)?\s*(.{3,120}?)[\.,;:]/i);
  if (m) return [m[1].trim(), (m[3] || '').trim()];
  // French pattern: "De X ... à Y"
  m = txt.match(/^\s*(De\s+)?(.{3,120}?)\s+à\s+(.{3,120}?)[\.,;:]/i);
  if (m) return [m[2].trim(), m[3].trim()];
  return [null, null];
}

function renderList() {
  const tbody = $('#results tbody');
  tbody.innerHTML = '';
  const rows = getFilteredRows().sort((a,b) => compareRows(a,b));
  $('#count').textContent = rows.length;
  rows.forEach(r => {
    const tr = el('tr', {}, [
      el('td', {}, [r.corpus || '']),
      el('td', {}, [r.date || '']),
      el('td', {}, [r.doc_type || '']),
      el('td', {}, [r.sender_raw || '—']),
      el('td', {}, [r.recipient_raw || '—'])
    ]);
    tr.addEventListener('click', () => renderDetail(r));
    tbody.appendChild(tr);
  });
}

function truthy(v){ return v===1 || v==='1' || v===true; }

function renderDetail(r) {
  const box = $('#detail');
  box.innerHTML = '';
  const labels = [];
  const LABEL_KEYS = ['cls_crisis','cls_coordination','cls_legal','cls_routine','cls_strategic','cls_annual','cls_ceremonial'];
  LABEL_KEYS.forEach(k => { if (truthy(r[k])) labels.push(k.replace('cls_','')); });

  box.append(
    el('div', {class: 'kv'}, [
      el('div', {}, ['corpus']), el('div', {}, [`${r.corpus || ''} / ${r.series || ''}`]),
      el('div', {}, ['date']), el('div', {}, [r.date || '', '  ', el('span', {class:'dim'}, [r.date_precision || ''])]),
      el('div', {}, ['type']), el('div', {}, [r.doc_type || '']),
      el('div', {}, ['from']), el('div', {}, [r.sender_raw || '—']),
      el('div', {}, ['to']), el('div', {}, [r.recipient_raw || '—']),
      el('div', {}, ['language']), el('div', {}, [r.language || '']),
      el('div', {}, ['labels']), el('div', {class:'labels'}, labels.length ? labels.map(t => el('span',{class:'label'},[t])) : [el('span',{class:'dim'},['—'])]),
    ]),
    el('div', {class: 'doc-text'}, [r.text || '(no text)'])
  );
}

function attachControls() {
  $('#q').addEventListener('input', (e) => { FILTER.q = e.target.value; renderList(); });
  // Multi-selects → Sets
  const updateMulti = (sel, targetSet) => {
    targetSet.clear();
    Array.from(sel.selectedOptions).forEach(opt => targetSet.add(opt.value));
  };
  const corpusSel = $('#corpus-select');
  const typeSel = $('#type-select');
  corpusSel.addEventListener('change', () => { updateMulti(corpusSel, FILTER.corpora); renderList(); });
  typeSel.addEventListener('change', () => { updateMulti(typeSel, FILTER.types); renderList(); });
  $('#reset').addEventListener('click', () => {
    FILTER.q = ''; $('#q').value='';
    // select all options in both selects
    Array.from(corpusSel.options).forEach(o => o.selected = true);
    Array.from(typeSel.options).forEach(o => o.selected = true);
    FILTER.corpora = new Set(Array.from(corpusSel.options).map(o=>o.value));
    FILTER.types = new Set(Array.from(typeSel.options).map(o=>o.value));
    renderList();
  });
  // sorting by year toggle
  const sortBtn = $('#sort-date');
  sortBtn.addEventListener('click', () => {
    SORT.dir *= -1;
    sortBtn.textContent = 'Sort by year ' + (SORT.dir === 1 ? '▲' : '▼');
    renderList();
  });
  // export buttons
  $('#export-csv').addEventListener('click', exportCSV);
  $('#export-json').addEventListener('click', exportJSON);
}

(async function init(){
  try {
    attachControls();
    await loadData();
    renderList();
  } catch (err) {
    const c = document.querySelector('.container');
    c.innerHTML = '<div class="placeholder">Failed to load dataset: ' + (err.message || err) + '</div>';
    console.error(err);
  }
})();

function compareRows(a,b){
  // sort by year, then date string, then corpus
  const ya = a.year ?? -Infinity;
  const yb = b.year ?? -Infinity;
  if (ya !== yb) return (ya - yb) * SORT.dir;
  const da = (a.date || '');
  const db = (b.date || '');
  if (da !== db) return (da < db ? -1 : 1) * SORT.dir;
  return (a.corpus < b.corpus ? -1 : 1) * SORT.dir;
}

function exportCSV(){
  const rows = getFilteredRows().sort(compareRows);
  const cols = ['doc_uid','corpus','series','date','doc_type','sender_raw','recipient_raw','language','source_ref'];
  const header = cols.join(',');
  const body = rows.map(r => cols.map(k => csvEscape(r[k])).join(',')).join('\n');
  const blob = new Blob([header+'\n'+body], {type: 'text/csv;charset=utf-8'});
  triggerDownload(blob, 'diplomatic_cables_filtered.csv');
}

function exportJSON(){
  const rows = getFilteredRows().sort(compareRows);
  const blob = new Blob([JSON.stringify(rows, null, 2)], {type: 'application/json'});
  triggerDownload(blob, 'diplomatic_cables_filtered.json');
}

function csvEscape(v){
  let s = (v===undefined||v===null) ? '' : String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function triggerDownload(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
}

function getFilteredRows(){
  return DATA.filter(recordMatches);
}
