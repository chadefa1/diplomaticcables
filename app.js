/* Minimal PoC browser for unified diplomatic cables (v0.1) */

const DATA_URL = 'data/diplomatic_cables_v0_1.jsonl';

/** @type {Array<object>} */
let DATA = [];
// Multi-select filters + year range
let FILTER = {
  q: '',
  corpora: new Set(['fr','uk','de']),
  types: new Set(['letter','telegram','despatch','memorandum','circular','enclosure','report','note']),
  yearFrom: null,
  yearTo: null,
  minYear: null,
  maxYear: null,
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
  // derive global year bounds for slider and initialize
  const years = DATA.map(d=>d.year).filter(y=>Number.isInteger(y));
  FILTER.minYear = years.length ? Math.min(...years) : null;
  FILTER.maxYear = years.length ? Math.max(...years) : null;
  initYearSlider();
}

function recordMatches(r) {
  if (!FILTER.corpora.has(r.corpus)) return false;
  if (r.doc_type && !FILTER.types.has(r.doc_type)) return false;
  if (FILTER.yearFrom !== null && Number.isInteger(r.year) && r.year < FILTER.yearFrom) return false;
  if (FILTER.yearTo !== null && Number.isInteger(r.year) && r.year > FILTER.yearTo) return false;
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
  if (rows.length === 0){
    const tr = el('tr', {}, [ el('td', { colspan: '5' }, [ 'No matching records. ', el('a', {href:'#', onclick:'return resetFiltersFromLink();'}, ['Reset filters']) ]) ]);
    tbody.appendChild(tr);
    return;
  }
  rows.forEach(r => {
    const tr = el('tr', {}, [
      el('td', {}, [ badgeForCorpus(r.corpus) ]),
      el('td', {}, [r.date || '']),
      el('td', {}, [ badgeForType(r.doc_type) ]),
      el('td', { class: 'td-ellipsis', title: r.sender_raw || '' }, [r.sender_raw || '—']),
      el('td', { class: 'td-ellipsis', title: r.recipient_raw || '' }, [r.recipient_raw || '—'])
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
  const debounced = debounce((v)=>{ FILTER.q = v; updateURL(); renderList(); }, 200);
  $('#q').addEventListener('input', (e) => { debounced(e.target.value); });
  // Multi-selects → Sets
  const updateMulti = (sel, targetSet) => {
    targetSet.clear();
    Array.from(sel.selectedOptions).forEach(opt => targetSet.add(opt.value));
  };
  const corpusSel = $('#corpus-select');
  const typeSel = $('#type-select');
  corpusSel.addEventListener('change', () => { updateMulti(corpusSel, FILTER.corpora); updateURL(); renderList(); });
  typeSel.addEventListener('change', () => { updateMulti(typeSel, FILTER.types); updateURL(); renderList(); });
  // Collapsible filters
  const panel = $('#filters-panel');
  const toggleBtn = $('#toggle-filters');
  toggleBtn.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    toggleBtn.textContent = collapsed ? 'Show Filters ▾' : 'Hide Filters ▴';
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
  });
  // Export dropdown
  const exportBtn = $('#export-btn');
  const exportMenu = $('#export-menu');
  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = exportMenu.classList.toggle('open');
    exportBtn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', () => { exportMenu.classList.remove('open'); exportBtn.setAttribute('aria-expanded','false'); });
  $('#reset').addEventListener('click', () => {
    FILTER.q = ''; $('#q').value='';
    // select all options in both selects
    Array.from(corpusSel.options).forEach(o => o.selected = true);
    Array.from(typeSel.options).forEach(o => o.selected = true);
    FILTER.corpora = new Set(Array.from(corpusSel.options).map(o=>o.value));
    FILTER.types = new Set(Array.from(typeSel.options).map(o=>o.value));
    if (FILTER.minYear !== null && FILTER.maxYear !== null) {
      setYearSlider(FILTER.minYear, FILTER.maxYear);
    } else { setYearSlider(null, null); }
    updateURL();
    renderList();
  });
  // sorting by year toggle
  const sortBtn = $('#sort-date');
  sortBtn.addEventListener('click', () => {
    SORT.dir *= -1;
    sortBtn.textContent = 'Sort by year ' + (SORT.dir === 1 ? '▲' : '▼');
    updateURL();
    renderList();
  });
  // export buttons
  $('#export-csv').addEventListener('click', exportCSV);
  $('#export-json').addEventListener('click', exportJSON);
  $('#export-meta').addEventListener('click', exportMeta);
  // header click sort
  const dateTh = document.querySelector('th[data-sort="date"]');
  if (dateTh) dateTh.addEventListener('click', () => { sortBtn.click(); });
}

(async function init(){
  try {
    attachControls();
    applyURL();
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
  const bom = '\ufeff';
  const blob = new Blob([bom + header+'\n'+body], {type: 'text/csv;charset=utf-8'});
  triggerDownload(blob, 'diplomatic_cables_filtered.csv');
}

function exportJSON(){
  const rows = getFilteredRows().sort(compareRows);
  const blob = new Blob([JSON.stringify(rows, null, 2)], {type: 'application/json'});
  triggerDownload(blob, 'diplomatic_cables_filtered.json');
}

function exportMeta(){
  const rows = getFilteredRows();
  const meta = {
    generated_at: new Date().toISOString(),
    count: rows.length,
    filters: {
      q: FILTER.q,
      corpora: Array.from(FILTER.corpora),
      types: Array.from(FILTER.types),
      year_from: FILTER.yearFrom,
      year_to: FILTER.yearTo,
    },
    sort: { key: SORT.key, dir: SORT.dir },
  };
  const blob = new Blob([JSON.stringify(meta, null, 2)], {type: 'application/json'});
  triggerDownload(blob, 'diplomatic_cables_metadata.json');
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

// ── URL state -------------------------------------------------------------
function updateURL(){
  const params = new URLSearchParams();
  if (FILTER.q) params.set('q', FILTER.q);
  const corp = Array.from(FILTER.corpora);
  if (corp.length && corp.length < 3) params.set('corpora', corp.join(','));
  const types = Array.from(FILTER.types);
  if (types.length && types.length < 8) params.set('types', types.join(','));
  if (FILTER.yearFrom !== null) params.set('yf', String(FILTER.yearFrom));
  if (FILTER.yearTo !== null) params.set('yt', String(FILTER.yearTo));
  if (SORT.dir !== 1) params.set('sd', String(SORT.dir));
  const qs = params.toString();
  const url = qs ? ('?'+qs) : window.location.pathname;
  history.replaceState(null, '', url);
}

function applyURL(){
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q'); if (q){ FILTER.q = q; $('#q').value = q; }
  const corp = params.get('corpora');
  if (corp){
    FILTER.corpora = new Set(corp.split(',').filter(Boolean));
    const sel = $('#corpus-select'); Array.from(sel.options).forEach(o => o.selected = FILTER.corpora.has(o.value));
  }
  const types = params.get('types');
  if (types){
    FILTER.types = new Set(types.split(',').filter(Boolean));
    const sel = $('#type-select'); Array.from(sel.options).forEach(o => o.selected = FILTER.types.has(o.value));
  }
  const yf = params.get('yf'); if (yf){ FILTER.yearFrom = parseInt(yf,10); }
  const yt = params.get('yt'); if (yt){ FILTER.yearTo = parseInt(yt,10); }
  const sd = params.get('sd'); if (sd){ const d = parseInt(sd,10); if (d===-1){ SORT.dir = -1; const btn=$('#sort-date'); if (btn) btn.textContent='Sort by year ▼'; } }
}

// Utility: debounce
function debounce(fn, wait){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); }; }

// Reset via link
function resetFiltersFromLink(){ const btn=$('#reset'); if (btn) btn.click(); return false; }

// Badges
function badgeForCorpus(c){
  const map = {fr:'FR', uk:'UK', de:'DE'};
  const label = map[c] || (c||'');
  return el('span', {class: `badge corpus-${c||'other'}`}, [label]);
}
function badgeForType(t){
  return el('span', {class: 'badge type', title: t||''}, [t||'']);
}

// Dual year slider
function initYearSlider(){
  const minEl = $('#year-min'); const maxEl = $('#year-max'); const highlight = $('#range-highlight'); const readout = $('#year-readout');
  if (!minEl || !maxEl || FILTER.minYear===null || FILTER.maxYear===null) return;
  const min = FILTER.minYear; const max = FILTER.maxYear;
  minEl.min = String(min); minEl.max = String(max);
  maxEl.min = String(min); maxEl.max = String(max);
  const yf = FILTER.yearFrom ?? min; const yt = FILTER.yearTo ?? max;
  minEl.value = String(yf); maxEl.value = String(yt);
  const update = ()=>{
    let a = parseInt(minEl.value,10), b = parseInt(maxEl.value,10);
    if (!Number.isFinite(a)) a = min; if (!Number.isFinite(b)) b = max;
    if (a > b) { const tmp=a; a=b; b=tmp; }
    FILTER.yearFrom = a; FILTER.yearTo = b;
    const range = max - min || 1; const left = ((a - min)/range)*100; const right = 100 - ((b - min)/range)*100;
    if (highlight){ highlight.style.left = left+'%'; highlight.style.right = right+'%'; }
    if (readout){ readout.textContent = (a===min && b===max) ? 'All' : `${a}–${b}`; }
    updateURL(); renderList();
  };
  minEl.addEventListener('input', update); maxEl.addEventListener('input', update);
  update();
}
function setYearSlider(a,b){
  const minEl = $('#year-min'); const maxEl = $('#year-max'); const highlight = $('#range-highlight'); const readout = $('#year-readout');
  if (!minEl || !maxEl) return;
  if (FILTER.minYear===null || FILTER.maxYear===null) return;
  const min = FILTER.minYear; const max = FILTER.maxYear;
  const a2 = (a===null ? min : a); const b2 = (b===null ? max : b);
  minEl.min = String(min); minEl.max = String(max);
  maxEl.min = String(min); maxEl.max = String(max);
  minEl.value = String(a2); maxEl.value = String(b2);
  const range = max - min || 1; const left = ((a2 - min)/range)*100; const right = 100 - ((b2 - min)/range)*100;
  if (highlight){ highlight.style.left = left+'%'; highlight.style.right = right+'%'; }
  if (readout){ readout.textContent = (a2===min && b2===max) ? 'All' : `${a2}–${b2}`; }
}
