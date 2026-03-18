/* =========================================
   SKOLEMAD PLATFORM – FRONTEND APP
   Mode: hybrid – bruger /api/* hvis tilgængeligt,
         ellers localStorage som fallback.
   ========================================= */

'use strict';

// --- Leverandør colour palette ----------
const LEV_COLORS = {
  'Fru Hansens Kælder':   '#e74c3c',
  'EAT':                  '#1a4a7a',
  'Øjn':                  '#8e44ad',
  'Sund skolemad':        '#27ae60',
  'Det Danske Madhus':    '#2471a3',
  'Kokken og Co':         '#d68910',
  'The Cantina':          '#c0392b',
  'Jespers Torvekøkken':  '#16a085',
  'Vildtkøkken.dk':       '#2ecc71',
  'Madvognen':            '#e67e22',
  'BagelRingen':          '#e91e8c',
  'Bistrup skolemad':     '#3498db',
  'Foodservice Danmark':  '#ba4a00',
  'Madglad':              '#7d3c98',
  'Marinas':              '#1abc9c',
  'Meiers køkken':        '#f39c12',
  'Hemmingsen Food':      '#2980b9',
  'Stoholm Fritids- og kulturcenter': '#7f8c8d',
  'Gastro Kantiner':      '#d35400',
};

function getLevColor(lev) { return LEV_COLORS[lev] || '#5d6d7e'; }

// --- State ---------------------------------
let map, cluster;
let allSchools  = [];
let markerMap   = {};
let activeType  = 'alle';   // 'alle' | 'Folkeskole' | 'Friskole'
let activeLev   = '';       // '' = all, else leverandør name
let currentId   = null;
let selectedRating = 0;
let useServer   = false;   // set after ping

// --- Init ----------------------------------
document.addEventListener('DOMContentLoaded', init);

async function init() {
  initMap();
  bindUI();

  // Check if backend is available
  try {
    const r = await fetch('/api/schools', { signal: AbortSignal.timeout(1500) });
    if (r.ok) { useServer = true; }
  } catch { /* static mode */ }

  allSchools = useServer ? await fetchJSON('/api/schools') : await loadStaticSchools();
  document.getElementById('schoolCount').textContent = allSchools.length;
  buildFilters();
  renderMarkers(allSchools);
  updateBadge(allSchools.length);
}

// --- Map init ------------------------------
function initMap() {
  map = L.map('map', { center: [56.0, 10.5], zoom: 7, zoomControl: true });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);

  cluster = L.markerClusterGroup({
    maxClusterRadius: 48,
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    chunkedLoading: true,
  });
  map.addLayer(cluster);
  map.on('click', () => closePanel());
}

// --- Data helpers -------------------------
async function fetchJSON(url) {
  const r = await fetch(url);
  return r.json();
}

async function loadStaticSchools() {
  if (typeof window.SCHOOLS_DATA !== 'undefined') return window.SCHOOLS_DATA;
  try {
    return await fetchJSON('data/schools.json');
  } catch { return []; }
}

// --- Firebase config ----------------------
// Indsæt din Firebase Realtime Database URL herunder (uden trailing slash)
// Eksempel: 'https://mit-projekt-default-rtdb.europe-west1.firebasedatabase.app'
const FIREBASE_URL = 'https://skolemad-d7a29-default-rtdb.europe-west1.firebasedatabase.app/';


// --- Comments storage ---------------------
// Uses API if server available, else localStorage
const STORE_KEY = 'skolemad_comments';

function getStoredComments() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
  catch { return {}; }
}

function saveStoredComments(all) {
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
}

async function apiGetComments(schoolId) {
  if (useServer) {
    return fetchJSON(`/api/comments/${schoolId}`);
  }
  // localStorage
  const all = getStoredComments();
  return (all[schoolId] || []).slice().reverse(); // newest first
}

async function apiPostComment(schoolId, author, rating, comment) {
  if (useServer) {
    const r = await fetch(`/api/comments/${schoolId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, rating, comment }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Serverfejl');
    return data;
  }
  // localStorage
  const all = getStoredComments();
  if (!all[schoolId]) all[schoolId] = [];
  const entry = {
    id: Date.now(),
    school_id: schoolId,
    author: author.trim().substring(0, 100),
    rating: parseInt(rating),
    comment: comment.trim().substring(0, 1000),
    created_at: new Date().toISOString(),
  };
  all[schoolId].push(entry);
  saveStoredComments(all);
  return entry;
}

function getLocalStats(schoolId) {
  const all = getStoredComments();
  const list = all[schoolId] || [];
  if (!list.length) return null;
  const avg = (list.reduce((s, c) => s + c.rating, 0) / list.length).toFixed(1);
  return { count: list.length, avg_rating: avg };
}

// --- Build filters ------------------------
function buildFilters() {
  const sel = document.getElementById('levSelect');

  const levSet = [...new Set(allSchools.map(s => s.leverandor).filter(l => l))]
    .sort((a, b) => a.localeCompare(b, 'da'));

  levSet.forEach(lev => {
    const opt = document.createElement('option');
    opt.value = lev;
    opt.textContent = lev;
    sel.appendChild(opt);
  });

  sel.addEventListener('change', () => {
    activeLev = sel.value;
    applyFilters();
  });

  document.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeType = btn.dataset.type;
      applyFilters();
    });
  });
}

// --- Filtering ----------------------------
function applyFilters() {
  const term = document.getElementById('searchInput').value.trim().toLowerCase();

  const visible = allSchools.filter(s => {
    if (activeType !== 'alle' && s.type !== activeType) return false;
    if (activeLev && s.leverandor !== activeLev) return false;
    if (term && !s.name.toLowerCase().includes(term) && !s.kommune.toLowerCase().includes(term)) return false;
    return true;
  });
  renderMarkers(visible);
  updateBadge(visible.length);
}

// --- Markers ------------------------------
function renderMarkers(schools) {
  cluster.clearLayers();
  markerMap = {};

  schools.forEach(school => {
    const color  = getLevColor(school.leverandor);
    const marker = L.marker([school.lat, school.lng], {
      icon: makeDotIcon(color),
      title: school.name,
    });

    marker.bindPopup(`
      <div class="map-popup">
        <div class="map-popup-name">${escHtml(school.name)}</div>
        <div class="map-popup-lev">${escHtml(school.leverandor)}</div>
        <button class="map-popup-btn" onclick="openPanel('${school.id}')">Se skole &amp; kommentarer</button>
      </div>`, { maxWidth: 220, closeButton: false });

    markerMap[school.id] = marker;
    cluster.addLayer(marker);
  });
}

function makeDotIcon(color, size = 14) {
  return L.divIcon({
    className: '',
    html: `<div class="school-dot" style="width:${size}px;height:${size}px;background:${color}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// --- Panel --------------------------------
async function openPanel(schoolId) {
  currentId = schoolId;
  selectedRating = 0;
  const school = allSchools.find(s => s.id === schoolId);
  if (!school) return;

  document.getElementById('detailPanel').classList.add('open');
  renderDetail(school);
  await loadComments(schoolId);

  if (markerMap[schoolId]) {
    map.setView([school.lat, school.lng], Math.max(map.getZoom(), 12), { animate: true });
  }
}

function closePanel() {
  document.getElementById('detailPanel').classList.remove('open');
  currentId = null;
  selectedRating = 0;
}

window.openPanel = openPanel;

// --- Detail rendering ---------------------
function renderDetail(school) {
  const color   = getLevColor(school.leverandor);
  const stats   = useServer ? null : getLocalStats(school.id); // server stats loaded async
  const content = document.getElementById('detailContent');

  content.innerHTML = `
    <div class="school-header" style="border-top: 4px solid ${color}">
      <h2 class="school-name">${escHtml(school.name)}</h2>
      <div class="school-meta">
        <div class="meta-item">
          <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          <span>${escHtml(school.address)}</span>
        </div>
        <div class="meta-item">
          <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
          <span>${escHtml(school.kommune)} Kommune</span>
        </div>
      </div>
      <div class="leverandor-card" style="border-left-color: ${color}">
        <div class="leverandor-label">Skolemadsleverandør</div>
        <div class="leverandor-name">${escHtml(school.leverandor)}</div>
        <span class="leverandor-badge" style="background:${color}1a;color:${color}">Deltager i forsøget</span>
      </div>
    </div>

    <div class="comments-section">
      <h3 class="comments-title">Kommentarer &amp; erfaringer</h3>
      <div id="statsBlock"></div>
      <div id="commentsList">
        <div class="skeleton" style="height:68px;margin-bottom:10px;border-radius:8px"></div>
        <div class="skeleton" style="height:68px;margin-bottom:10px;border-radius:8px"></div>
      </div>

      <div class="comment-form">
        <h4>Del din erfaring</h4>
        <div class="form-group">
          <label for="cf-name">Dit navn</label>
          <input type="text" id="cf-name" placeholder="Forælder, lærer eller elev…" maxlength="100" autocomplete="name"/>
        </div>
        <div class="form-group">
          <label>Din vurdering</label>
          <div class="star-selector" id="starSelector">
            ${[1,2,3,4,5].map(i=>`<button type="button" class="star-btn" data-r="${i}" aria-label="${i} stjerner">★</button>`).join('')}
          </div>
        </div>
        <div class="form-group">
          <label for="cf-text">Din kommentar</label>
          <textarea id="cf-text" rows="4" maxlength="1000" placeholder="Skriv om din oplevelse med skolemaden…"></textarea>
          <div class="char-count"><span id="cf-chars">0</span>/1000</div>
        </div>
        <button class="submit-btn" id="cf-submit">Send kommentar</button>
        <div class="submit-msg" id="cf-msg"></div>
      </div>
    </div>`;

  // Stars
  const stars = content.querySelectorAll('.star-btn');
  stars.forEach(btn => {
    btn.addEventListener('mouseenter', () => litStars(stars, +btn.dataset.r));
    btn.addEventListener('mouseleave', () => litStars(stars, selectedRating));
    btn.addEventListener('click', () => {
      selectedRating = +btn.dataset.r;
      litStars(stars, selectedRating);
    });
  });

  // Char counter
  content.querySelector('#cf-text').addEventListener('input', function () {
    content.querySelector('#cf-chars').textContent = this.value.length;
  });

  // Submit
  content.querySelector('#cf-submit').addEventListener('click', () => submitComment(school.id));
}

function litStars(stars, n) {
  stars.forEach(s => s.classList.toggle('lit', +s.dataset.r <= n));
}

// --- Comments load ------------------------
async function loadComments(schoolId) {
  const list      = document.getElementById('commentsList');
  const statsBlock = document.getElementById('statsBlock');
  if (!list) return;

  try {
    const comments = await apiGetComments(schoolId);
    renderComments(list, comments);

    // Render aggregate stats
    if (statsBlock && comments.length > 0) {
      const avg = (comments.reduce((s, c) => s + c.rating, 0) / comments.length).toFixed(1);
      statsBlock.innerHTML = `
        <div class="avg-rating-block">
          <div class="avg-score">${avg}</div>
          <div>
            <div class="avg-stars">${renderStars(Math.round(avg))}</div>
            <div class="avg-count">${comments.length} ${comments.length === 1 ? 'kommentar' : 'kommentarer'}</div>
          </div>
        </div>`;
    }
  } catch {
    list.innerHTML = '<p class="no-comments">Kunne ikke hente kommentarer.</p>';
  }
}

function renderComments(container, comments) {
  if (comments.length === 0) {
    container.innerHTML = '<p class="no-comments">Ingen kommentarer endnu. Vær den første til at dele din erfaring!</p>';
    return;
  }
  container.innerHTML = comments.map(c => `
    <div class="comment-card">
      <div class="comment-header">
        <div class="comment-avatar">${escHtml(c.author.charAt(0).toUpperCase())}</div>
        <div class="comment-meta">
          <div class="comment-author">${escHtml(c.author)}</div>
          <div class="comment-date">${fmtDate(c.created_at)}</div>
        </div>
        <div class="comment-rating">${renderStars(c.rating)}</div>
      </div>
      <p class="comment-text">${escHtml(c.comment)}</p>
    </div>`).join('');
}

// --- Submit -------------------------------
async function submitComment(schoolId) {
  const nameEl  = document.getElementById('cf-name');
  const textEl  = document.getElementById('cf-text');
  const btn     = document.getElementById('cf-submit');
  const msgEl   = document.getElementById('cf-msg');

  const author  = nameEl.value.trim();
  const comment = textEl.value.trim();

  if (!author)         { showMsg(msgEl, 'Angiv venligst dit navn.', 'error'); return; }
  if (!selectedRating) { showMsg(msgEl, 'Vælg venligst en vurdering (1–5 stjerner).', 'error'); return; }
  if (!comment)        { showMsg(msgEl, 'Skriv venligst en kommentar.', 'error'); return; }

  btn.disabled = true;
  btn.textContent = 'Sender…';

  try {
    await apiPostComment(schoolId, author, selectedRating, comment);
    showMsg(msgEl, 'Tak for din kommentar!', 'success');
    nameEl.value = '';
    textEl.value = '';
    document.getElementById('cf-chars').textContent = '0';
    selectedRating = 0;
    litStars(document.querySelectorAll('.star-btn'), 0);
    await loadComments(schoolId);
  } catch (err) {
    showMsg(msgEl, err.message || 'Noget gik galt. Prøv igen.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send kommentar';
  }
}

// --- Helpers ------------------------------
function showMsg(el, text, type) {
  el.textContent = text;
  el.className   = `submit-msg ${type} visible`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'submit-msg'; }, 5000);
}

function renderStars(n) {
  return [1,2,3,4,5].map(i =>
    `<span class="${i <= n ? 'star-filled' : 'star-empty'}">★</span>`
  ).join('');
}

function fmtDate(str) {
  return new Date(str).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
}

function escHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

function updateBadge(n) {
  document.getElementById('visibleBadge').textContent = `${n} ${n === 1 ? 'skole' : 'skoler'} vist`;
}

// --- UI bindings --------------------------
function bindUI() {
  document.getElementById('closePanel').addEventListener('click', closePanel);

  let searchTimer;
  const inp = document.getElementById('searchInput');
  const clr = document.getElementById('searchClear');

  inp.addEventListener('input', () => {
    clr.classList.toggle('visible', inp.value.length > 0);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFilters, 200);
  });
  clr.addEventListener('click', () => {
    inp.value = '';
    clr.classList.remove('visible');
    applyFilters();
  });

  document.getElementById('resetFilters')?.addEventListener('click', resetFilters);
}

function resetFilters() {
  // Reset type
  activeType = 'alle';
  document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === 'alle'));
  // Reset leverandør
  activeLev = '';
  document.getElementById('levSelect').value = '';
  // Reset search
  document.getElementById('searchInput').value = '';
  document.getElementById('searchClear').classList.remove('visible');
  renderMarkers(allSchools);
  updateBadge(allSchools.length);
}
