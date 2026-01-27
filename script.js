/* ================= STATE & ELEMENTS ================= */
const settingsBtn = document.getElementById('settingsBtn');
const toolbar = document.getElementById('toolbar');
const fileInput = document.getElementById('fileInput');
const excelInput = document.getElementById('excelInput');
const drawAreaBtn = document.getElementById('drawAreaBtn');
const addTextBtn = document.getElementById('addTextBtn');
const copyGridBtn = document.getElementById('copyGridBtn');
const clearBtn = document.getElementById('clearBtn');
const rowsInput = document.getElementById('rowsInput');
const colsInput = document.getElementById('colsInput');
const canvas = document.getElementById('canvasWrap');
const countdownDiv = document.getElementById('reminderCountdown');
const customAlert = document.getElementById('customAlert');
const customAlertMessage = document.getElementById('customAlertMessage');
const customAlertOk = document.getElementById('customAlertOk');
const voiceToggle = document.getElementById('voiceToggle');
const testVoiceBtn = document.getElementById('testVoiceBtn');

let mode = '';
let drawing = false;
let dragEl = null;
let dragDx = 0, dragDy = 0;
let startX = 0, startY = 0, drawRect = null;

let excelData = null;
let reminders = []; // array of { time:Date, shopsByLP: { lpKey -> Set(shop) }, shown, removed }
let selectedGrid = null;
let rowEntries = {}; // key `${gridId}_${row}` -> {store, ts}

/* helper */
function uid(prefix='g'){ return prefix + '_' + Math.random().toString(36).slice(2,9); }
function clientPos(e){
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function saveRowEntries(){ localStorage.setItem('rowEntries', JSON.stringify(rowEntries)); }
function loadRowEntries(){ try{ rowEntries = JSON.parse(localStorage.getItem('rowEntries')||'{}'); }catch(e){ rowEntries = {}; } }

/* toolbar toggle */
settingsBtn.addEventListener('click', ()=>{ toolbar.style.display = (toolbar.style.display === 'flex' ? 'none' : 'flex'); });
toolbar.style.display = 'none';

/* ================= FILE BACKGROUND ================= */
fileInput.addEventListener('change', e=>{
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ev => { canvas.style.backgroundImage = `url(${ev.target.result})`; saveState(); };
  r.readAsDataURL(f);
});

/* ================= EXCEL ================= */
excelInput.addEventListener('change', handleExcel);
function handleExcel(e){
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = ev => {
    const data = new Uint8Array(ev.target.result);
    const wb = XLSX.read(data,{type:'array'});
    const sheet = wb.Sheets[wb.SheetNames[0]];
    excelData = XLSX.utils.sheet_to_json(sheet,{header:1});
    localStorage.setItem('excelData', JSON.stringify(excelData));
    buildReminders();
    updateFromExcel();
    saveState();
  };
  r.readAsArrayBuffer(f);
}

/* ================= MODES ================= */
drawAreaBtn.addEventListener('click', ()=> mode='draw');
addTextBtn.addEventListener('click', ()=> mode='text');
clearBtn.addEventListener('click', ()=> {
  if(confirm('Na pewno usunąć wszystko?')){
    canvas.innerHTML = '';
    canvas.style.backgroundImage = '';
    localStorage.removeItem('planState');
    localStorage.removeItem('excelData');
    localStorage.removeItem('rowEntries');
    rowEntries = {};
    reminders = [];
    selectedGrid = null;
  }
});

/* ================= COPY GRID ================= */
copyGridBtn.addEventListener('click', ()=>{
  if(!selectedGrid){ alert('Najpierw zaznacz grid do skopiowania!'); return; }
  const g = selectedGrid;
  const clone = g.cloneNode(true);
  const id = uid('g');
  clone.dataset.gridId = id;
  const left = parseFloat(g.style.left || '0%') + 3;
  const top  = parseFloat(g.style.top  || '0%') + 3;
  clone.style.left = left + '%';
  clone.style.top  = top  + '%';
  wireGrid(clone);
  canvas.appendChild(clone);
  const rows = parseInt(clone.dataset.rows,10), cols = parseInt(clone.dataset.cols,10);
  for(let r=0;r<rows;r++) rowEntries[`${id}_${r}`] = { store:'', ts: Date.now() };
  saveRowEntries();
  saveState();
});

/* ================= CANVAS INTERACTIONS (draw/text) ================= */
canvas.addEventListener('mousedown', e=>{
  if(e.button !== 0) return;
  const p = clientPos(e);
  if(mode === 'draw'){
    drawing = true; startX = p.x; startY = p.y;
    drawRect = document.createElement('div');
    drawRect.className = 'drawingRect';
    drawRect.style.left = startX + 'px';
    drawRect.style.top  = startY + 'px';
    canvas.appendChild(drawRect);
    return;
  }
  if(mode === 'text'){
    const t = document.createElement('textarea');
    t.className = 'textBox';
    const rect = canvas.getBoundingClientRect();
    const leftPct = ((p.x) / rect.width) * 100;
    const topPct  = ((p.y) / rect.height) * 100;
    t.style.left = leftPct + '%';
    t.style.top  = topPct + '%';
    t.value = '';
    t.placeholder = 'Wpisz...';
    t.addEventListener('mousedown', ev => ev.stopPropagation());
    t.addEventListener('input', saveState);
    t.addEventListener('contextmenu', ev=>{ ev.preventDefault(); if(confirm('Usunąć to pole tekstowe?')){ t.remove(); saveState(); } });
    canvas.appendChild(t);
    makeDraggable(t);
    saveState();
    mode = '';
  }
});
canvas.addEventListener('mousemove', e=>{
  const p = clientPos(e);
  if(drawing && drawRect){
    const w = p.x - startX, h = p.y - startY;
    drawRect.style.width = Math.abs(w) + 'px';
    drawRect.style.height = Math.abs(h) + 'px';
    drawRect.style.left = (w < 0 ? p.x : startX) + 'px';
    drawRect.style.top  = (h < 0 ? p.y : startY) + 'px';
  }
  if(dragEl){
    const p2 = clientPos(e);
    const rect = canvas.getBoundingClientRect();
    const leftPct = ((p2.x - dragDx) / rect.width) * 100;
    const topPct  = ((p2.y - dragDy) / rect.height) * 100;
    dragEl.style.left = Math.max(0, leftPct) + '%';
    dragEl.style.top  = Math.max(0, topPct)  + '%';
  }
});
canvas.addEventListener('mouseup', e=>{
  if(drawing && drawRect){
    drawing = false;
    const x = parseFloat(drawRect.style.left), y = parseFloat(drawRect.style.top);
    const w = parseFloat(drawRect.style.width), h = parseFloat(drawRect.style.height);
    drawRect.remove(); drawRect = null;
    if(w > 6 && h > 6){
      const rect = canvas.getBoundingClientRect();
      const leftPct = (x / rect.width) * 100;
      const topPct  = (y / rect.height) * 100;
      const widthPct = (w / rect.width) * 100;
      const heightPct = (h / rect.height) * 100;
      createGrid(leftPct + '%', topPct + '%', widthPct + '%', heightPct + '%',
                 parseInt(rowsInput.value||4,10), parseInt(colsInput.value||8,10));
    }
    saveState();
    mode = '';
  }
  if(dragEl){
    saveState();
    dragEl = null;
  }
});

/* click on empty canvas deselects grid */
canvas.addEventListener('click', e=>{
  if(e.target === canvas && selectedGrid){
    selectedGrid.classList.remove('selected');
    selectedGrid = null;
  }
});

/* ================= DRAGGABLE HELPER ================= */
function makeDraggable(el){
  el.addEventListener('mousedown', function(ev){
    if(ev.button !== 0) return;
    if(ev.target && (ev.target.classList.contains('cellText') || ev.target.classList.contains('textBox'))) return;
    dragEl = el;
    const rect = canvas.getBoundingClientRect();
    const ex = ev.clientX - rect.left;
    const ey = ev.clientY - rect.top;
    const leftPx = (parseFloat(el.style.left||0) / 100) * rect.width;
    const topPx  = (parseFloat(el.style.top||0)  / 100) * rect.height;
    dragDx = ex - leftPx;
    dragDy = ey - topPx;
    ev.stopPropagation(); ev.preventDefault();
  });
}

/* ================= CREATE GRID ================= */
function createGrid(left='10%', top='10%', width='30%', height='20%', rows=4, cols=8, gridId=null){
  const grid = document.createElement('div');
  grid.className = 'grid';
  const id = gridId || uid('g');
  grid.dataset.gridId = id;
  grid.dataset.rows = rows;
  grid.dataset.cols = cols;
  grid.style.left = left;
  grid.style.top  = top;
  grid.style.width = width;
  grid.style.height = height;
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  grid.style.gridTemplateColumns = `repeat(${cols-1}, 1fr) 2fr`;

  for(let r=0; r<rows; r++){
    for(let c=0; c<cols; c++){
      if(c < cols - 1){
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.addEventListener('click', ev => { ev.stopPropagation(); toggleCell(cell); saveState(); });
        grid.appendChild(cell);
      } else {
        const ta = document.createElement('textarea');
        ta.className = 'cellText';
        ta.addEventListener('mousedown', ev => ev.stopPropagation());
        ta.addEventListener('input', ev => {
          const idx = Array.prototype.indexOf.call(grid.children, ev.target);
          const rowIndex = Math.floor(idx / cols);
          rowEntries[`${grid.dataset.gridId}_${rowIndex}`] = { store: (ev.target.value||'').trim(), ts: Date.now() };
          saveRowEntries(); updateFromExcel(); saveState();
        });
        grid.appendChild(ta);
      }
    }
  }

  wireGrid(grid);
  canvas.appendChild(grid);

  for(let r=0; r<rows; r++){
    const key = `${id}_${r}`;
    if(!rowEntries[key]) rowEntries[key] = { store:'', ts: Date.now() };
  }
  saveRowEntries();
}

/* ================= TOGGLING CELLS ================= */
function toggleCell(cell){
  if(cell.classList.contains('blue')) cell.classList.replace('blue','red');
  else if(cell.classList.contains('red')) cell.classList.remove('red');
  else cell.classList.add('blue');
}

/* ================= WIRING GRID EVENTS ================= */
function wireGrid(grid){
  grid.addEventListener('click', ev=>{
    ev.stopPropagation();
    if(selectedGrid) selectedGrid.classList.remove('selected');
    selectedGrid = grid;
    grid.classList.add('selected');
  });
  grid.addEventListener('contextmenu', ev=>{
    ev.preventDefault();
    if(confirm('Usunąć ten obszar?')){
      const id = grid.dataset.gridId;
      for(let r=0; r<parseInt(grid.dataset.rows,10); r++) delete rowEntries[`${id}_${r}`];
      saveRowEntries();
      if(selectedGrid === grid) selectedGrid = null;
      grid.remove();
      updateFromExcel();
      saveState();
    }
  });
  makeDraggable(grid);
}

/* ================= SAVE / LOAD ================= */
function saveState(){
  const state = { bg: canvas.style.backgroundImage || '', grids: [], texts: [] };
  Array.from(canvas.querySelectorAll('.grid')).forEach(g=>{
    const rows = parseInt(g.dataset.rows,10), cols = parseInt(g.dataset.cols,10);
    const obj = { gridId: g.dataset.gridId, left: g.style.left, top: g.style.top, width: g.style.width, height: g.style.height, rows, cols, cells: [] };
    Array.from(g.children).forEach(ch=>{
      if(ch.classList.contains('cell')){
        if(ch.classList.contains('black')) obj.cells.push('black');
        else if(ch.classList.contains('blue')) obj.cells.push('blue');
        else if(ch.classList.contains('red')) obj.cells.push('red');
        else if(ch.classList.contains('gray')) obj.cells.push('gray');
        else obj.cells.push('none');
      } else if(ch.classList.contains('cellText')) obj.cells.push({ type:'text', value: ch.value || '' });
    });
    state.grids.push(obj);
  });
  Array.from(canvas.querySelectorAll('.textBox')).forEach(t=>{
    state.texts.push({ left: t.style.left || '0%', top: t.style.top || '0%', width: t.style.width || '10%', height: t.style.height || '4%', value: t.value || '', fontSize: t.style.fontSize || '15px' });
  });
  localStorage.setItem('planState', JSON.stringify(state));
  saveStateToFirebase(state, excelData, rowEntries);
  saveRowEntries();
  if(excelData) localStorage.setItem('excelData', JSON.stringify(excelData));
}

/* px -> percent helper for older states */
function pxToPct(value, axis){
  const px = parseFloat(value);
  const rect = canvas.getBoundingClientRect();
  if(axis === 'x') return (px / rect.width * 100) + '%';
  return (px / rect.height * 100) + '%';
}

function loadState(){
  loadRowEntries();
  const raw = localStorage.getItem('planState');
  if(!raw){
    const storedExcel = localStorage.getItem('excelData');
    if(storedExcel){ excelData = JSON.parse(storedExcel); buildReminders(); updateFromExcel(); }
    return;
  }
  try{
    const state = JSON.parse(raw);
    canvas.innerHTML = '';
    if(state.bg) canvas.style.backgroundImage = state.bg;
    (state.grids || []).forEach(g=>{
      const left = (typeof g.left === 'string' && g.left.includes('px')) ? pxToPct(g.left,'x') : g.left;
      const top  = (typeof g.top  === 'string' && g.top.includes('px')) ? pxToPct(g.top,'y') : g.top;
      const width = (typeof g.width === 'string' && g.width.includes('px')) ? pxToPct(g.width,'x') : g.width;
      const height= (typeof g.height=== 'string' && g.height.includes('px')) ? pxToPct(g.height,'y') : g.height;
      createGrid(left, top, width, height, g.rows, g.cols, g.gridId);
      const gridEl = Array.from(canvas.querySelectorAll('.grid')).find(x => x.dataset.gridId === g.gridId);
      if(!gridEl) return;
      g.cells.forEach((c,i)=>{
        const ch = gridEl.children[i];
        if(!ch) return;
        if(typeof c === 'string'){
          ch.classList.remove('blue','red','gray','black');
          if(c === 'blue') ch.classList.add('blue');
          else if(c === 'red') ch.classList.add('red');
          else if(c === 'gray') ch.classList.add('gray');
          else if(c === 'black') ch.classList.add('black');
        } else if(c.type === 'text'){
          ch.value = c.value || '';
          const cols = parseInt(gridEl.dataset.cols,10);
          const rowIndex = Math.floor(i / cols);
          rowEntries[`${g.gridId}_${rowIndex}`] = { store: (ch.value||'').trim(), ts: Date.now() };
        }
      });
    });
    (state.texts || []).forEach(t=>{
      const box = document.createElement('textarea'); box.className = 'textBox';
      box.style.left   = (t.left && t.left.includes('px')) ? pxToPct(t.left,'x') : (t.left || '2%');
      box.style.top    = (t.top  && t.top.includes('px'))  ? pxToPct(t.top,'y')  : (t.top  || '2%');
      box.style.width  = (t.width && t.width.includes('px'))? pxToPct(t.width,'x') : (t.width || '12%');
      box.style.height = (t.height && t.height.includes('px'))? pxToPct(t.height,'y'): (t.height|| '6%');
      box.value = t.value || '';
      box.style.fontSize = t.fontSize || '15px';
      box.addEventListener('mousedown', ev=> ev.stopPropagation());
      box.addEventListener('input', saveState);
      box.addEventListener('contextmenu', ev=>{ ev.preventDefault(); if(confirm('Usunąć to pole tekstowe?')){ box.remove(); saveState(); } });
      makeDraggable(box);
      canvas.appendChild(box);
    });
    const storedExcel = localStorage.getItem('excelData');
    if(storedExcel){ excelData = JSON.parse(storedExcel); buildReminders(); updateFromExcel(); }
  } catch(err){
    console.error('Failed to load state', err);
  }
}
/* ================= UPDATE FROM EXCEL (rozprowadzanie) ================= */
function updateFromExcel(){
  if(!excelData) return;
  // INDEXES: C -> 2 (shop), H -> 7 (black count), J -> 9 (quantity)
  const totals = {};      // shop -> total BLUE
  const blacks = {};      // shop -> total BLACK
  for (let i = 0; i < excelData.length; i++) {
    const row = excelData[i];
    const shop = String(row[2] || '').trim();
    const totalJ  = parseInt(row[9], 10) || 0;  // całkowita ilość
    const blackH = parseInt(row[7], 10) || 0;   // czarne
    if (!shop) continue;

    const blue = Math.max(0, totalJ - blackH);  // NIEBIESKIE = J - H
    const black = blackH;                       // CZARNE = H

    totals[shop] = (totals[shop] || 0) + blue;
    blacks[shop] = (blacks[shop] || 0) + black;
  }

  // build rowsList (same as before)
  const rowsList = [];
  const grids = Array.from(canvas.querySelectorAll('.grid'));
  grids.forEach(g=>{
    const rows = parseInt(g.dataset.rows,10), cols = parseInt(g.dataset.cols,10);
    const children = Array.from(g.children);
    for(let r=0;r<rows;r++){
      const start = r*cols;
      const cells = children.slice(start, start + cols - 1);
      const lastCell = children[start + cols - 1];
      const storeVal = lastCell && lastCell.value ? String(lastCell.value).trim() : '';
      const key = `${g.dataset.gridId}_${r}`;
      const entry = rowEntries[key] || { store: storeVal, ts: Date.now() };
      if(storeVal !== (entry.store||'')){ entry.store = storeVal; entry.ts = Date.now(); rowEntries[key] = entry; }
      rowsList.push({ key, gridId: g.dataset.gridId, el: g, rowIndex: r, cols, cells, store: storeVal, ts: entry.ts || Date.now() });
    }
  });

  // keep existing behaviour: older rows first
  rowsList.sort((a,b)=> (a.ts || 0) - (b.ts || 0));

  // clear previous colors (including black)
  rowsList.forEach(row => row.cells.forEach(c => { c.classList.remove('blue','red','gray','black'); }));

  // Clone totals/blacks for decrementing
  const remaining = Object.assign({}, totals);
  const blackRemaining = Object.assign({}, blacks);

  // For each shop allocate BLUE first, then BLACK, right-to-left
  for(const shop of Object.keys(totals)){
    let need = remaining[shop] || 0;
    let needBlack = blackRemaining[shop] || 0;
    if(need <= 0 && needBlack <= 0) continue;
    for(const row of rowsList){
      if(need <= 0 && needBlack <= 0) break;
      if(row.store !== shop) continue;
      const available = row.cells.length;
      // fill right-to-left
      for(let i=available-1;i>=0;i--){
        if(need > 0){
          row.cells[i].classList.add('blue');
          need--;
        } else if(needBlack > 0){
          row.cells[i].classList.add('black');
          // black counts toward total as well
          needBlack--;
          need--;
        } else {
          break;
        }
      }
    }
    remaining[shop] = need;
    blackRemaining[shop] = needBlack;
  }

  // For rows that have a store not present in totals, keep gray (unchanged behaviour)
  rowsList.forEach(row=>{
    if(!row.store) return;
    if(!(row.store in totals)){
      row.cells.forEach(c=> c.classList.add('gray'));
    }
  });

  saveRowEntries();
}

/* ================= BUILD REMINDERS (group by time and LP) ================= */
function buildReminders(){
  reminders = [];
  if(!excelData) return;
  console.log('buildReminders called, excelData length:', excelData.length); // Tymczasowe: sprawdź długość danych
  const now = new Date();
  const map = {}; // key -> { time:Date, shopsByLP: {}, shown:false, removed:false }
  // Ogranicz do pierwszych 500 wierszy
  const maxRows = Math.min(excelData.length, 500);
  for(let index = 0; index < maxRows; index++){
    const r = excelData[index];
    const t = r[1], shop = r[2], lp = r[17];
    console.log(`Row ${index}: t=${t}, shop=${shop}, lp=${lp}, k=${r[10]}`); // Tymczasowe: sprawdź dane wiersza
    if(!t || !shop) continue;
    let dt = null;
    if(typeof t === 'number'){
      const totalMinutes = Math.round((t % 1) * 24 * 60);
      const hh = Math.floor(totalMinutes / 60), mm = totalMinutes % 60;
      dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
    } else {
      const s = String(t).trim();
      const parts = s.split(':').map(Number);
      if(parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])){
        dt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parts[0], parts[1], parts[2]||0);
      }
    }
    if(!dt) continue;
    const key = dt.getHours().toString().padStart(2,'0') + ':' + dt.getMinutes().toString().padStart(2,'0');
    if(!map[key]) map[key] = { time: dt, shopsByLP: {}, shown:false, removed:false };
    const lpKey = (lp !== undefined && lp !== null && String(lp).trim() !== '') ? String(lp).trim() : '__NO_LP__';
    let shopName = String(shop).trim();
    // Zmiana: sprawdź, czy shopName występuje w r[10] (jako część tekstu)
    if (r[10] !== undefined && r[10] !== null && String(r[10]).includes(shopName)) {
      shopName += "T";
      console.log(`Added T to shop: ${shopName}`); // Tymczasowe: potwierdź dodanie T
    }
    if(!map[key].shopsByLP[lpKey]) map[key].shopsByLP[lpKey] = new Set();
    map[key].shopsByLP[lpKey].add(shopName);
  }
  for(const k of Object.keys(map)){
    reminders.push({ time: map[k].time, shopsByLP: map[k].shopsByLP, shown:false, removed:false });
  }
  reminders.sort((a,b)=>a.time - b.time);
  console.log('Reminders built:', reminders.length); // Tymczasowe: sprawdź liczbę przypomnień
}
/* helper to format shopsByLP -> {text, shopsArray} */
function formatShopsByLP(shopsByLP){
  const parts = [];
  const allShops = new Set();
  // iterate LP keys in natural order: numeric ascending then NO_LP at end
  const keys = Object.keys(shopsByLP).sort((a,b)=>{
    if(a === '__NO_LP__') return 1;
    if(b === '__NO_LP__') return -1;
    const na = Number(a), nb = Number(b);
    if(!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });
  keys.forEach(lpKey=>{
    const shops = Array.from(shopsByLP[lpKey]).filter(s=>s && s.trim()).map(s=>s.trim());
    shops.forEach(s => allShops.add(s));
    if(lpKey === '__NO_LP__'){
      if(shops.length) parts.push(shops.join(', '));
    } else {
      if(shops.length) parts.push(`LP ${lpKey} – ${shops.join(', ')}`);
    }
  });
  return { text: parts.join('; '), shops: Array.from(allShops) };
}

/* ================= REMINDERS CHECK ================= */
function showModal(msg){
  customAlertMessage.textContent = msg;
  customAlert.style.display = 'block';
  customAlertOk.focus();
}
customAlertOk.addEventListener('click', ()=> {
  if(window.speechSynthesis) window.speechSynthesis.cancel();
  customAlert.style.display = 'none';
});

function checkReminders(){
  const now = new Date();
  reminders.forEach(rem=>{
    const diff = rem.time - now;
    // show 30 minutes before -> show once
    if(diff <= 30*60*1000 && diff > -1 && !rem.shown){
      const formatted = formatShopsByLP(rem.shopsByLP);
      const msg = `Uwaga! Wydanie: ${formatted.text}`;
      showModal(msg);
      speak(msg);
      rem.shown = true;
    }
    // if passed and not removed -> clear matching last-column cells
    if(now >= rem.time && !rem.removed){
      const formatted = formatShopsByLP(rem.shopsByLP);
      const shopsSet = new Set(formatted.shops.map(s => String(s)));
      const grids = Array.from(canvas.querySelectorAll('.grid'));
      grids.forEach(g=>{
        const rows = parseInt(g.dataset.rows,10), cols = parseInt(g.dataset.cols,10);
        const ch = Array.from(g.children);
        for(let r=0;r<rows;r++){
          const last = ch[r*cols + (cols-1)];
          if(last && shopsSet.has(String((last.value||'').trim()))){
            last.value = '';
            rowEntries[`${g.dataset.gridId}_${r}`] = { store: '', ts: Date.now() };
          }
        }
      });
      rem.removed = true;
      saveRowEntries();
      updateFromExcel();
      saveState();
    }
  });
}

/* update countdown display */
function updateCountdownDisplay(){
  const now = new Date();
  const upcoming = reminders.filter(r=>!r.removed && r.time > now);
  if(upcoming.length === 0){ countdownDiv.textContent = ''; return; }
  upcoming.sort((a,b)=>a.time - b.time);
  const next = upcoming[0];
  const diff = Math.max(0, next.time - now);
  const hours = Math.floor(diff / 3600000);
  const mins  = Math.floor((diff % 3600000) / 60000);
  const formatted = formatShopsByLP(next.shopsByLP);
  const shopsText = formatted.text || formatted.shops.join(', ');
  countdownDiv.textContent = `Wydanie: ${shopsText} za ${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}`;
}

/* loop */
setInterval(()=>{
  checkReminders();
  updateCountdownDisplay();
}, 1000);

/* ================== VOICE & PING ================== */
let voiceEnabled = false;
voiceEnabled = voiceToggle.checked || false;
voiceToggle.checked = voiceEnabled;
voiceToggle.addEventListener('change', () => {
  voiceEnabled = voiceToggle.checked;
  if(voiceEnabled) speak("Czytanie komunikatów włączone.");
  else if(window.speechSynthesis) window.speechSynthesis.cancel();
});

function playPing(){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 1000;
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    o.connect(g); g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.2);
  }catch(e){ /* ignore audio errors */ }
}

function speak(text){
  if(!voiceEnabled) return;
  if(!('speechSynthesis' in window)) return;
  try{
    // small ping and then speak
    playPing();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'pl-PL';
    utter.rate = 1.0;
    utter.pitch = 1.0;
    const voices = window.speechSynthesis.getVoices();
    if(voices && voices.length) utter.voice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('pl')) || voices[0];
    setTimeout(()=> window.speechSynthesis.speak(utter), 180);
  }catch(e){ console.warn('Błąd syntezy mowy:', e); }
}

/* test button */
testVoiceBtn.addEventListener('click', ()=>{
  const msg = "Test komunikatu głosowego — wszystko działa poprawnie.";
  showModal(msg);
  speak(msg);
});
/* ================= PNG MODAL ================= */
const pngBtn = document.getElementById('pngBtn');
const pngModal = document.createElement('div');
pngModal.id = 'pngModal';
pngModal.innerHTML = `
  <h3>Edytuj dane PNG</h3>
  <table id="pngTable"></table>
  <button id="pngSaveBtn">Zapisz</button>
  <button id="pngCloseBtn">Zamknij</button>
`;
document.body.appendChild(pngModal);

const pngTable = document.getElementById('pngTable');
const pngSaveBtn = document.getElementById('pngSaveBtn');
const pngCloseBtn = document.getElementById('pngCloseBtn');

// Funkcja do tworzenia tabeli 15x2
function createPngTable() {
  pngTable.innerHTML = '';
  for (let i = 0; i < 15; i++) {
    const row = document.createElement('tr');
    for (let j = 0; j < 2; j++) {
      const cell = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'text';
      input.dataset.row = i;
      input.dataset.col = j;
      input.value = loadPngData(i, j) || '';
      input.addEventListener('input', () => savePngData(i, j, input.value));
      cell.appendChild(input);
      row.appendChild(cell);
    }
    pngTable.appendChild(row);
  }
}

// Funkcje do zapisywania/wczytywania danych w localStorage
function savePngData(row, col, value) {
  const key = `pngData_${row}_${col}`;
  localStorage.setItem(key, value);
}

function loadPngData(row, col) {
  const key = `pngData_${row}_${col}`;
  return localStorage.getItem(key) || '';
}

// Obsługa przycisków
pngBtn.addEventListener('click', () => {
  createPngTable();
  pngModal.style.display = 'block';
});

pngCloseBtn.addEventListener('click', () => {
  pngModal.style.display = 'none';
});

pngSaveBtn.addEventListener('click', () => {
  // Opcjonalnie: dodatkowa logika po zapisaniu, np. alert('Zapisano!');
  pngModal.style.display = 'none';
});
/* ================= INIT ================= */
loadRowEntries();
loadState();
loadStateFromFirebase();

const storedExcel = localStorage.getItem('excelData');
if(storedExcel){ excelData = JSON.parse(storedExcel); buildReminders(); updateFromExcel(); }

/* expose some functions for debugging */
window.updateFromExcel = updateFromExcel;
window.buildReminders = buildReminders;
window.saveState = saveState;


const FIREBASE_DOC = "shared/plan";

function saveStateToFirebase(state, excelData, rowEntries) {
  if (typeof db === "undefined") return;

  db.doc(FIREBASE_DOC).set({
    state,
    excelData: excelData || null,
    rowEntries: rowEntries || {},
    updatedAt: Date.now()
  }).then(() => {
    console.log("🔥 Zapisano do Firebase");
  }).catch(err => console.error("Firebase save error:", err));
}

function loadStateFromFirebase() {
  if (typeof db === "undefined") return;

  db.doc(FIREBASE_DOC).get()
    .then(doc => {
      if (!doc.exists) return;

      const data = doc.data();
      console.log("🔥 Wczytano z Firebase");

      if (data.rowEntries) {
        rowEntries = data.rowEntries;
        saveRowEntries();
      }

      if (data.excelData) {
        excelData = data.excelData;
        localStorage.setItem('excelData', JSON.stringify(excelData));
        buildReminders();
        updateFromExcel();
      }

      if (data.state) {
        localStorage.setItem('planState', JSON.stringify(data.state));
        loadState();
      }
    })
    .catch(err => console.error("Firebase load error:", err));
}

