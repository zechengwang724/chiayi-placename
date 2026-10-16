/* 網站外框＋地圖頁。其餘頁面尚未製作，先以空白頁表示。 */
(function () {
  'use strict';
  var D = window.SITE_DATA || { places: [], sites: [], elders: [] };
  var app = document.getElementById('app');
  var EXAMPLE = '（範例資料，待替換）';

  var PAGES = {
    map:    { nav: 'map',    title: '地圖' },
    sites:  { nav: 'sites',  title: '古蹟列表', note: '' },
    site:   { nav: 'sites',  title: '古蹟頁', note: '單欄長頁（線框 A）＋耆老卡片 A' },
    places: { nav: 'places', title: '地名列表', note: '' },
    place:  { nav: 'places', title: '地名頁', note: '字卡式（線框 A）' },
    search: { nav: '',       title: '搜尋結果', note: '' }
  };

  var siteById = {}, placeById = {};
  D.sites.forEach(function (s) { siteById[s.id] = s; });
  D.places.forEach(function (p) { placeById[p.id] = p; });

  // ---------- 小工具 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function enc(s) { return encodeURIComponent(s); }
  function hasPos(x) { return x && x.lat != null && x.lng != null; }
  function where(x) { return [x.county, x.town, x.village].filter(Boolean).join(' '); }
  function meters(m) { return m == null ? '' : (m >= 1000 ? (m / 1000).toFixed(1) + ' 公里' : m + ' 公尺'); }
  function text(s) {
    // 範例標記改用小標籤顯示，不混在內文裡
    s = s || '';
    var ex = s.indexOf(EXAMPLE) === 0;
    return (ex ? '<span class="tag-ex">範例資料</span> ' : '') + esc(ex ? s.slice(EXAMPLE.length) : s);
  }
  // ---------- 照片、錄音：缺檔時顯示預設空框 ----------
  var MISSING_LABEL = { IMG: '照片未提供', AUDIO: '錄音未提供' };
  function placeholder(kind, cls, name) {
    return '<div class="missing ' + (cls || '') + '" data-kind="' + kind + '">' +
      '<span>' + MISSING_LABEL[kind] + '</span>' + (name ? '<small>' + esc(name) + '</small>' : '') + '</div>';
  }
  function photo(p, cls, alt) {
    if (!p || p.missing) return placeholder('IMG', cls, p && p.name);
    return '<img class="' + cls + '" src="' + esc(p.thumb || p.src) + '" alt="' + esc(alt || '') + '" data-name="' + esc(p.name) + '">';
  }
  function audio(a) {
    if (!a || a.missing) return placeholder('AUDIO', 'audio-missing', a && a.name);
    return '<audio controls preload="none" src="' + esc(a.src) + '" data-name="' + esc(a.name) + '"></audio>';
  }
  // 檔案在資料裡有登記、但實際不在（例如上傳 GitHub 時沒放照片和錄音）
  document.addEventListener('error', function (e) {
    var el = e.target;
    var src = el.tagName === 'SOURCE' ? el.parentNode : el;
    if (!MISSING_LABEL[src.tagName] || src.dataset.failed) return;
    src.dataset.failed = '1';
    var cls = src.tagName === 'IMG' ? src.className : 'audio-missing';
    src.insertAdjacentHTML('afterend', placeholder(src.tagName, cls, src.dataset.name));
    src.remove();
  }, true);

  function parse() {
    var h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    var q = '';
    var qi = h.indexOf('?');
    if (qi >= 0) { q = h.slice(qi + 1); h = h.slice(0, qi); }
    var parts = h.split('/').filter(Boolean);
    return { view: parts[0] || 'map', parts: parts, id: parts[1] || '', query: q };
  }

  function blank(page, r) {
    var extra = r.id ? '：' + esc(r.id) : (r.query ? '：「' + esc(r.query.replace(/^q=/, '')) + '」' : '');
    return '<section class="blank">' +
      '<span class="blank-tag">尚未製作</span>' +
      '<h1>' + esc(page.title) + extra + '</h1>' +
      (page.note ? '<p>' + esc(page.note) + '</p>' : '') +
      '</section>';
  }

  // ---------- 地圖頁 ----------
  var TILES = {
    emap:  { name: '電子地圖', url: 'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}' },
    photo: { name: '空照圖',   url: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}' }
  };
  var M = null;   // 目前的地圖狀態

  function key(type, id) { return type + ':' + id; }

  function buildMap() {
    app.innerHTML =
      '<div class="home">' +
        '<div class="map-wrap">' +
          '<div class="map-el" id="map"></div>' +
          '<div class="offline" id="offline" hidden>目前沒有網路，底圖無法顯示。標記和資料仍可正常瀏覽。</div>' +
          '<div class="map-legend">' +
            '<span><i class="mk mk-site"></i>古蹟</span><span><i class="mk mk-place"></i>古地名</span>' +
            '<span class="sep"></span>' +
            '<button type="button" class="chip" data-tile="emap" aria-pressed="true">電子地圖</button>' +
            '<button type="button" class="chip" data-tile="photo" aria-pressed="false">空照圖</button>' +
          '</div>' +
        '</div>' +
        '<aside class="home-panel" id="panel" aria-live="polite"></aside>' +
      '</div>';

    var map = L.map('map', { zoomControl: false, attributionControl: true });
    L.control.zoom({ position: 'topright', zoomInTitle: '放大', zoomOutTitle: '縮小' }).addTo(map);
    map.attributionControl.setPrefix(false);

    var errors = 0;
    var layers = {};
    Object.keys(TILES).forEach(function (k) {
      layers[k] = L.tileLayer(TILES[k].url, { maxZoom: 18, attribution: '底圖：內政部國土測繪中心' });
      layers[k].on('tileerror', function () { if (++errors > 3) document.getElementById('offline').hidden = false; });
      layers[k].on('tileload', function () { errors = 0; document.getElementById('offline').hidden = true; });
    });
    layers.emap.addTo(map);

    M = { map: map, layers: layers, tile: 'emap', markers: {}, lines: L.layerGroup().addTo(map),
          filter: 'all', town: '', sel: null };

    function addMarker(type, x) {
      if (!hasPos(x)) return;
      var m = L.marker([x.lat, x.lng], {
        icon: L.divIcon({ className: 'mk-wrap', html: '<i class="mk mk-' + type + '"></i>', iconSize: [16, 16], iconAnchor: [8, 8] }),
        title: x.name, keyboard: true, riseOnHover: true
      });
      m.bindTooltip(esc(x.name), { permanent: true, direction: 'right', offset: [10, 0], className: 'lbl' });
      m.on('click', function () { location.hash = '#/map/' + type + '/' + enc(x.id); });
      m.on('mouseover', function () { hl(type, x.id, true); });
      m.on('mouseout', function () { hl(type, x.id, false); });
      m.addTo(map);
      M.markers[key(type, x.id)] = { m: m, type: type, x: x };
    }
    D.sites.forEach(function (s) { addMarker('site', s); });
    D.places.forEach(function (p) { addMarker('place', p); });

    function labels() { map.getContainer().classList.toggle('labels-off', map.getZoom() < 14); }
    map.on('zoomend', labels);

    var all = Object.keys(M.markers).map(function (k) { return M.markers[k].m.getLatLng(); });
    if (all.length) map.fitBounds(L.latLngBounds(all), fitPad());
    else map.setView([23.4800, 120.4491], 13);
    labels();

    app.querySelector('.map-legend').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tile]');
      if (!b || b.dataset.tile === M.tile) return;
      map.removeLayer(layers[M.tile]);
      M.tile = b.dataset.tile;
      layers[M.tile].addTo(map);
      app.querySelectorAll('[data-tile]').forEach(function (x) { x.setAttribute('aria-pressed', x.dataset.tile === M.tile); });
    });

    var panel = document.getElementById('panel');
    panel.addEventListener('click', function (e) {
      var f = e.target.closest('[data-filter]');
      if (f) { M.filter = f.dataset.filter; applyFilter(); renderList(); }
    });
    panel.addEventListener('change', function (e) {
      if (e.target.id === 'town') { M.town = e.target.value; applyFilter(); renderList(); }
    });
    panel.addEventListener('mouseover', function (e) {
      var a = e.target.closest('[data-key]');
      if (a) markerEl(a.dataset.key, function (el) { el.classList.add('hover'); });
    });
    panel.addEventListener('mouseout', function (e) {
      var a = e.target.closest('[data-key]');
      if (a) markerEl(a.dataset.key, function (el) { el.classList.remove('hover'); });
    });
    panel.addEventListener('submit', function (e) {
      if (e.target.id !== 'panel-search') return;
      e.preventDefault();
      var q = document.getElementById('panel-q').value.trim();
      if (q) location.hash = '#/search?q=' + enc(q);
    });
  }

  function fitPad() {
    var wide = window.matchMedia('(min-width: 821px)').matches;
    return wide ? { paddingTopLeft: [420, 40], paddingBottomRight: [60, 60], maxZoom: 16 }
                : { padding: [40, 40], maxZoom: 16 };
  }

  function markerEl(k, fn) {
    var o = M && M.markers[k];
    var el = o && o.m.getElement();
    if (el) fn(el.querySelector('.mk'), el);
  }
  function hl(type, id, on) {
    var a = document.querySelector('#panel [data-key="' + key(type, id) + '"]');
    if (a) a.classList.toggle('hl', on);
  }

  function visible(o) {
    if (M.filter !== 'all' && o.type !== M.filter) return false;
    if (M.town && o.x.town !== M.town) return false;
    return true;
  }
  function applyFilter() {
    Object.keys(M.markers).forEach(function (k) {
      var o = M.markers[k];
      var show = visible(o);
      if (show && !M.map.hasLayer(o.m)) o.m.addTo(M.map);
      if (!show && M.map.hasLayer(o.m)) M.map.removeLayer(o.m);
    });
  }

  function towns() {
    var t = {};
    D.sites.concat(D.places).forEach(function (x) { if (x.town) t[x.town] = 1; });
    return Object.keys(t).sort();
  }

  function listItem(type, x) {
    var r = type === 'place' ? (x.tailo || x.poj) : '';
    return '<li><a href="#/map/' + type + '/' + enc(x.id) + '" data-key="' + key(type, x.id) + '">' +
      '<i class="mk mk-' + type + '"></i>' +
      '<span><span class="nm">' + esc(x.name) + '</span>' + (r ? '<span class="r">' + esc(r) + '</span>' : '') + '</span>' +
      '<span class="town">' + esc(x.town) + (hasPos(x) ? '' : '・無座標') + '</span></a></li>';
  }

  function renderList() {
    var panel = document.getElementById('panel');
    var items = [];
    if (M.filter !== 'place') D.sites.forEach(function (s) { if (!M.town || s.town === M.town) items.push(listItem('site', s)); });
    if (M.filter !== 'site') D.places.forEach(function (p) { if (!M.town || p.town === M.town) items.push(listItem('place', p)); });
    var f = function (v, label) { return '<button type="button" class="chip" data-filter="' + v + '" aria-pressed="' + (M.filter === v) + '">' + label + '</button>'; };
    panel.innerHTML =
      '<h1>嘉義古蹟與古地名</h1>' +
      '<p class="lead">嘉義市的古蹟、古地名與耆老口述紀錄。點選地圖上的標記，或從下方清單查看。</p>' +
      '<div class="counts"><span><b>' + D.sites.length + '</b>處古蹟</span><span><b>' + D.places.length + '</b>筆古地名</span><span><b>' + D.elders.length + '</b>位耆老訪談</span></div>' +
      '<form id="panel-search" role="search"><label class="sr" for="panel-q">搜尋</label>' +
        '<input id="panel-q" type="search" class="panel-q" placeholder="搜尋地名、古蹟、訪談內容"></form>' +
      '<div class="filters">' + f('all', '全部') + f('site', '古蹟') + f('place', '古地名') +
        '<label class="sr" for="town">鄉鎮</label><select id="town"><option value="">全部鄉鎮</option>' +
        towns().map(function (t) { return '<option' + (t === M.town ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') +
        '</select></div>' +
      (items.length ? '<ul class="list">' + items.join('') + '</ul>' : '<p class="empty">沒有符合條件的資料。</p>');
  }

  function relRow(type, x, extra) {
    return '<li><a href="#/map/' + type + '/' + enc(x.id) + '" data-key="' + key(type, x.id) + '">' +
      '<i class="mk mk-' + type + '"></i><span><span class="nm">' + esc(x.name) + '</span>' +
      (type === 'place' && x.tailo ? '<span class="r">' + esc(x.tailo) + '</span>' : '') + '</span>' +
      '<span class="town">' + esc(extra || '') + '</span></a></li>';
  }

  function renderDetail(type, x) {
    var panel = document.getElementById('panel');
    var related = [];   // [type, obj]
    var h = '<div class="pd">' +
      '<a class="back" href="#/">← 回清單</a>' +
      '<div class="kicker"><i class="mk mk-' + type + '"></i>' + (type === 'site' ? '古蹟' : '古地名') +
        (where(x) ? '・' + esc(where(x)) : '') + '</div>' +
      '<h2 class="pd-name">' + esc(x.name) + '</h2>';

    if (type === 'site') {
      if (x.tailo || x.poj) h += '<div class="roman">' + esc([x.tailo, x.poj].filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' ／ ')) + '</div>';
      var ph = (x.photos || [])[0];
      if (ph) h += photo(ph, 'pd-photo', x.name);
      if (x.intro) h += '<p class="pd-intro">' + text(x.intro) + '</p>';
      var near = (x.near || []).slice().sort(function (a, b) { return a.m - b.m; });
      var listed = {};
      var rows = [];
      (x.places || []).forEach(function (pid) {
        var p = placeById[pid]; if (!p) return;
        listed[pid] = 1; related.push(['place', p]);
        var d = near.filter(function (n) { return n.id === pid; })[0];
        rows.push(relRow('place', p, d ? meters(d.m) : ''));
      });
      near.forEach(function (n) {
        if (listed[n.id]) return;
        var p = placeById[n.id]; if (!p) return;
        rows.push(relRow('place', p, meters(n.m) + '・距離推算'));
      });
      (x.placesUnlinked || []).forEach(function (t) {
        rows.push('<li><span class="unlinked"><i class="mk mk-place"></i><span class="nm">' + esc(t) + '</span><span class="town">未收錄</span></span></li>');
      });
      if (rows.length) h += '<h3>附近古地名</h3><ul class="list">' + rows.join('') + '</ul>';
      var n = (x.elders || []).length;
      h += '<h3>耆老訪談</h3><p class="pd-note">' + (n ? n + ' 位耆老談到這裡：' + x.elders.map(esc).join('、') : '尚無訪談') + '</p>';
    } else {
      var rd = [];
      if (x.tailo) rd.push('<dt>台羅</dt><dd>' + esc(x.tailo) + '</dd>');
      if (x.poj) rd.push('<dt>白話字</dt><dd>' + esc(x.poj) + '</dd>');
      if (x.hanyu) rd.push('<dt>漢語拼音</dt><dd>' + esc(x.hanyu) + '</dd>');
      if (rd.length) h += '<dl class="pd-read">' + rd.join('') + '</dl>';
      if (x.audio) h += audio(x.audio);
      if (x.intro) h += '<p class="pd-intro">' + text(x.intro) + '</p>';
      if (x.source) h += '<p class="pd-note">資料來源：' + esc(x.source) + '</p>';
      var srows = [];
      var seen = {};
      (x.sites || []).forEach(function (sid) {
        var s = siteById[sid]; if (!s) return;
        seen[sid] = 1; related.push(['site', s]);
        srows.push(relRow('site', s, x.dist && x.dist[sid] != null ? meters(x.dist[sid]) : ''));
      });
      (x.nearSites || []).forEach(function (sid) {
        var s = siteById[sid]; if (!s || seen[sid]) return;
        srows.push(relRow('site', s, meters(x.dist[sid]) + '・距離推算'));
      });
      if (srows.length) h += '<h3>相關古蹟</h3><ul class="list">' + srows.join('') + '</ul>';
      var m = (x.elders || []).length;
      h += '<h3>耆老口述</h3><p class="pd-note">' + (m ? m + ' 位耆老提到這個地名：' + x.elders.map(esc).join('、') : '尚無耆老提及') + '</p>';
    }
    h += '<a class="btn solid pd-go" href="#/' + type + '/' + enc(x.id) + '">看完整介紹 →</a></div>';
    panel.innerHTML = h;
    panel.scrollTop = 0;
    return related;
  }

  function select(type, id) {
    var x = type === 'site' ? siteById[id] : placeById[id];
    M.lines.clearLayers();
    Object.keys(M.markers).forEach(function (k) {
      markerEl(k, function (el, wrap) { el.classList.remove('sel', 'dim'); wrap.classList.remove('on'); });
    });
    if (!x) { M.sel = null; renderList(); return; }

    var related = renderDetail(type, x);
    var k = key(type, id);
    var relKeys = {};
    related.forEach(function (r) { relKeys[key(r[0], r[1].id)] = 1; });
    Object.keys(M.markers).forEach(function (mk) {
      markerEl(mk, function (el, wrap) {
        if (mk === k) { el.classList.add('sel'); wrap.classList.add('on'); }
        else if (!relKeys[mk]) el.classList.add('dim');
      });
    });
    var pts = [];
    if (hasPos(x)) pts.push([x.lat, x.lng]);
    related.forEach(function (r) {
      if (!hasPos(r[1]) || !hasPos(x)) return;
      pts.push([r[1].lat, r[1].lng]);
      L.polyline([[x.lat, x.lng], [r[1].lat, r[1].lng]], { className: 'rel-line', weight: 2, dashArray: '6 6', interactive: false }).addTo(M.lines);
    });
    if (pts.length === 1) M.map.setView(pts[0], Math.max(M.map.getZoom(), 15));
    else if (pts.length) M.map.fitBounds(L.latLngBounds(pts), fitPad());
    M.sel = k;
  }

  function renderMap(r) {
    if (!M || !document.getElementById('map')) buildMap();
    var type = r.parts[1], id = r.parts[2];
    if (type && id) select(type, id);
    else select(null, null);
  }

  function destroyMap() {
    if (M) { M.map.remove(); M = null; }
  }

  // ---------- 路由 ----------
  function render() {
    var r = parse();
    var page = PAGES[r.view] || PAGES.map;
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      a.classList.toggle('on', a.dataset.nav === page.nav);
      if (a.dataset.nav === page.nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.body.classList.toggle('is-map', page === PAGES.map);
    if (page === PAGES.map) {
      var t = r.parts[1] === 'site' ? siteById[r.parts[2]] : r.parts[1] === 'place' ? placeById[r.parts[2]] : null;
      document.title = (t ? t.name + '｜' : '') + '嘉義古蹟與古地名';
      renderMap(r);
      return;
    }
    destroyMap();
    document.title = page.title + '｜嘉義古蹟與古地名';
    app.innerHTML = blank(page, r);
    window.scrollTo(0, 0);
  }

  document.getElementById('head-search').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = document.getElementById('head-q').value.trim();
    if (q) location.hash = '#/search?q=' + enc(q);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && M && M.sel) location.hash = '#/';
  });

  var foot = document.createElement('footer');
  foot.className = 'foot';
  foot.textContent = '地名 ' + D.places.length +
    ' 筆、古蹟 ' + D.sites.length + ' 處、耆老訪談 ' + D.elders.length + ' 位';
  document.body.appendChild(foot);

  window.addEventListener('hashchange', render);
  render();
})();
