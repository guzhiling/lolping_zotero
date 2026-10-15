/* global Zotero, Components, ChromeUtils, PingWheel:writable */
/*
 * Ping Wheel for Zotero.
 * Wheel geometry (pickSlice) and ping colors adapted from lolPing,
 * MIT License, Copyright (c) 2026 Danrui Meng. See LICENSE.
 * The files in assets/ are (c) Riot Games, Inc., taken from lolPing. See LICENSE.
 */

var PW_Cu = Components.utils;
var PW_Timer = (function () {
  try { return ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs'); }
  catch (e) { return null; }
})();
var PW_NetUtil = (function () {
  try { return ChromeUtils.importESModule('resource://gre/modules/NetUtil.sys.mjs').NetUtil; }
  catch (e) { return null; }
})();

var PW_PINGS = [
  { id: 'danger', name: 'Danger', glyph: '\u26A0\uFE0F', color: '#ff3b55', icon: 'pingwheel_retreatrender', art: ['pingwheel_retreatrender'], sound: 'SRP_12', tone: [660, 330] },
  { id: 'push', name: 'Push', glyph: '\u23E9', color: '#35d27a', icon: 'push', art: ['pingwheel_pushrender'], sound: 'SRP_9', tone: [520, 880] },
  { id: 'omw', name: 'On My Way', glyph: '\uD83C\uDFC3', color: '#2e8bff', icon: 'omw', art: ['omw'], sound: 'OnMyWay', tone: [600, 900] },
  { id: 'allin', name: 'All In', glyph: '\u2694\uFE0F', color: '#f2b320', icon: 'all_in', art: ['pingwheel_allin_render_01', 'pingwheel_allin_render_02'], sound: 'SRP_4', tone: [440, 990] },
  { id: 'assist', name: 'Assist Me', glyph: '\uD83D\uDEE1\uFE0F', color: '#56d43c', icon: 'assist_me', art: ['assist_me'], sound: 'ComeHere', tone: [700, 520] },
  { id: 'needvision', name: 'Need Vision', glyph: '\uD83D\uDC41\uFE0F', color: '#56d43c', icon: 'need_vision', art: ['need_vision'], sound: 'SRP_7', tone: [800, 1000] },
  { id: 'missing', name: 'Enemy Missing', glyph: '\u2753', color: '#f2c518', icon: 'enemy_missing', art: ['enemy_missing'], sound: 'MIA', tone: [880, 660] },
  { id: 'enemyvision', name: 'Enemy Vision', glyph: '\uD83D\uDC40', color: '#ff3b55', icon: 'pingwheel_enemyvisionrender', art: ['pingwheel_enemyvisionrender'], sound: 'AreaIsWarded', tone: [500, 400] },
  { id: 'generic', name: 'Generic', glyph: '\uD83D\uDCCD', color: '#2e8bff', icon: 'generic_ping', art: ['pingwheel_basicpingrender'], sound: 'Base', tone: [740, 740] },
  { id: 'bait', name: 'Bait', glyph: '\uD83C\uDFA3', color: '#efbc12', icon: 'pingwheel_baitrender', art: ['pingwheel_baitrender'], sound: 'SRP_11', tone: [620, 470] },
  { id: 'visioncleared', name: 'Vision Cleared', glyph: '\u2705', color: '#2b80ff', icon: 'vision_cleared', art: ['pingwheel_visionclearedrender'], sound: 'SRP_6', tone: [900, 1200] },
  { id: 'missingflip', name: 'Upside-down Missing', glyph: '\u00BF', color: '#f2c518', icon: 'enemy_missing_flipped', art: ['enemy_missing_flipped'], sound: 'MIA', tone: [660, 880] },
];
var PW_DEFAULT_WHEEL = ['danger', 'push', 'omw', 'allin', 'assist', 'needvision', 'missing', 'enemyvision'];
var PW_SIZES = { small: 88, medium: 110, large: 136 };
// On-screen size of a ping's art, both when it pops up and on a saved note.
var PW_ART_PX = 46;
// A second ping of the same kind this soon and this close (screen pixels) saves a note.
var PW_DOUBLE_MS = 3000;
var PW_DOUBLE_PX = 40;
var PW_SVGNS = 'http://www.w3.org/2000/svg';
var PW_INK = '#f0e6d2';
var PW_BASE = 'rgba(14, 19, 28, 0.80)';
var PW_RIM = 'rgba(200, 170, 110, 0.60)';

function pwPing(id) { return PW_PINGS.find(p => p.id === id); }

function pwEditable(t) {
  try { return !!t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.localName || '')); }
  catch (e) { return false; }
}

/** Texture for a ping: 'icon' on the wheel, 'art' where the ping lands. */
function pwArtName(def, which) {
  return which === 'art' && def.art.length === 1 ? def.art[0] : def.icon;
}

function pwTextureNames() {
  return new Set(PW_PINGS.flatMap(p => [pwArtName(p, 'icon'), pwArtName(p, 'art')]));
}

function pwDataURI(bytes, type) {
  // data: URIs want plain base64, so turn base64url's two odd characters back.
  const b64 = ChromeUtils.base64URLEncode(bytes, { pad: true }).replace(/-/g, '+').replace(/_/g, '/');
  return `data:${type};base64,${b64}`;
}

/** Reads a file inside the plugin. A channel copes with the '@' in the plugin's jar: URL. */
function pwReadURL(url) {
  return new Promise((resolve, reject) => {
    PW_NetUtil.asyncFetch({
      uri: url,
      loadUsingSystemPrincipal: true,
      securityFlags: Components.interfaces.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
      contentPolicyType: Components.interfaces.nsIContentPolicy.TYPE_OTHER,
    }, (stream, status) => {
      if (!Components.isSuccessCode(status)) { reject(new Error(`can't read ${url}`)); return; }
      try { resolve(new Uint8Array(PW_NetUtil.readInputStream(stream, stream.available()))); }
      catch (e) { reject(e); }
      finally { try { stream.close(); } catch (e) {} }
    });
  });
}

function pwRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Slice under an offset from the wheel centre (screen coords, y down). -1 = dead zone, else 0..7 clockwise from N. */
function pwPickSlice(dx, dy, deadZone) {
  if (Math.hypot(dx, dy) < deadZone) return -1;
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 22.5 + 360) % 360;
  return Math.floor(deg / 45) % 8;
}

function pwAnimate(el, frames, opts) {
  try { return typeof el.animate === 'function' ? el.animate(frames, opts) : null; } catch (e) { return null; }
}

function pwPolar(r, deg) {
  const t = (deg * Math.PI) / 180;
  return [r * Math.sin(t), -r * Math.cos(t)];
}

function pwSector(ri, ro, a0, a1) {
  const [x0, y0] = pwPolar(ro, a0), [x1, y1] = pwPolar(ro, a1);
  const [x2, y2] = pwPolar(ri, a1), [x3, y3] = pwPolar(ri, a0);
  return `M ${x0} ${y0} A ${ro} ${ro} 0 0 1 ${x1} ${y1} L ${x2} ${y2} A ${ri} ${ri} 0 0 0 ${x3} ${y3} Z`;
}

PingWheel = {
  PREF: 'extensions.zotero-pingwheel.',
  _wins: new WeakSet(),
  _bindings: [],
  _timer: null,
  _looping: false,
  _gesture: null,
  _suppressUntil: 0,
  _swallowAltUp: false,
  _keyHeld: false,
  _lastPing: null,
  _audioCtx: null,
  _assets: { loadedFor: null, gen: 0, textures: new Map(), sounds: new Map() },
  _bundled: null,
  _notifierID: null,
  _prefObservers: [],
  _drawPatches: [],

  init({ id, version, rootURI }) {
    this.id = id;
    this.version = version;
    this.rootURI = rootURI;
    try {
      this._notifierID = Zotero.Notifier.registerObserver(
        { notify: () => this._queueAllArt() }, ['item', 'item-tag'], 'pingwheel');
      this._prefObservers = [
        Zotero.Prefs.registerObserver(this.PREF + 'artOnNotes', () => this._queueAllArt(), true),
        Zotero.Prefs.registerObserver(this.PREF + 'assetsDir', () => this._ensureAssets(), true),
      ];
    } catch (e) {
      Zotero.logError(e);
    }
    if (PW_Timer) {
      this._timer = PW_Timer.setInterval(() => this._scan(), 1500);
    } else {
      this._looping = true;
      (async () => {
        while (this._looping) { this._scan(); await Zotero.Promise.delay(1500); }
      })();
    }
    this._scan();
    this._ensureAssets();
    Zotero.debug('Ping Wheel: started');
  },

  shutdown() {
    if (this._timer && PW_Timer) PW_Timer.clearInterval(this._timer);
    this._timer = null;
    this._looping = false;
    this._cancel();
    try {
      if (this._notifierID) Zotero.Notifier.unregisterObserver(this._notifierID);
      for (const symbol of this._prefObservers) Zotero.Prefs.unregisterObserver(symbol);
    } catch (e) {}
    this._notifierID = null;
    this._prefObservers = [];
    // Put Zotero's own note drawing back before this code goes away, or the reader would call a dead function.
    for (const { proto, orig } of this._drawPatches) {
      try { proto._drawNote = orig; } catch (e) {}
    }
    this._drawPatches = [];
    for (const b of this._bindings) { b.artKeys = new Set(); this._redraw(b); }
    for (const b of this._bindings) b.detach();
    this._bindings = [];
    try { if (this._audioCtx) this._audioCtx.close(); } catch (e) {}
    this._audioCtx = null;
  },

  pref(key) {
    return Zotero.Prefs.get(this.PREF + key, true);
  },

  /* ---------- Finding the PDF views ---------- */

  _scan() {
    try {
      this._bindings = this._bindings.filter((b) => {
        if (b.dead()) { b.detach(); return false; }
        return true;
      });
      // Catches anything the page observer and the notifier miss.
      for (const b of this._bindings) this._syncArt(b);
      const readers = (Zotero.Reader && Zotero.Reader._readers) || [];
      for (const reader of readers) {
        let ir;
        try { ir = reader._internalReader && PW_Cu.waiveXrays(reader._internalReader); } catch (e) { continue; }
        if (!ir) continue;
        for (const viewName of ['_primaryView', '_secondaryView']) {
          let win;
          try { win = ir[viewName] && ir[viewName]._iframeWindow; } catch (e) { continue; }
          if (win) this._attach(reader, win, viewName);
        }
      }
    } catch (e) {
      Zotero.logError(e);
    }
  },

  _attach(reader, win, viewName) {
    let xwin;
    try {
      xwin = PW_Cu.unwaiveXrays(win);
      if (PW_Cu.isDeadWrapper(xwin) || this._wins.has(xwin)) return;
      const app = PW_Cu.waiveXrays(xwin).PDFViewerApplication;
      if (!app || !app.pdfViewer || !xwin.document || !xwin.document.body) return; // not a PDF or not ready
    } catch (e) {
      return;
    }
    this._wins.add(xwin);

    const on = {
      pointerdown: e => this._onPointerDown(e, reader, xwin),
      pointermove: e => this._onPointerMove(e),
      pointerup: e => this._onPointerUp(e),
      pointercancel: () => this._cancel(),
      mousedown: e => this._swallow(e),
      mouseup: e => this._swallow(e),
      click: e => this._swallow(e),
      dblclick: e => this._swallow(e),
      contextmenu: e => this._swallow(e),
      selectstart: e => this._swallow(e),
      dragstart: e => this._swallow(e),
      keydown: e => this._onKeyDown(e),
      keyup: e => this._onKeyUp(e),
      blur: (e) => {
        // A key let go in another window never sends keyup here.
        if (!(e.target && e.target.nodeType)) this._keyHeld = false;
        this._cancel();
      },
    };
    for (const [type, fn] of Object.entries(on)) xwin.addEventListener(type, fn, true);

    const b = {
      xwin,
      reader,
      viewName,
      artTimer: null,
      observer: null,
      // Ping notes whose sticky-note icon Zotero skips because the art is drawn instead.
      artKeys: new Set(),
      dead: () => { try { return PW_Cu.isDeadWrapper(xwin) || xwin.closed; } catch (e) { return true; } },
      detach: () => {
        try {
          if (PW_Cu.isDeadWrapper(xwin)) return;
          for (const [type, fn] of Object.entries(on)) xwin.removeEventListener(type, fn, true);
          if (b.observer) b.observer.disconnect();
          for (const el of xwin.document.querySelectorAll('.pw-note-art')) el.remove();
        } catch (e) {}
      },
    };
    // pdf.js clears a page's extra children when it re-renders it, so put the art back afterwards.
    try {
      b.observer = new xwin.MutationObserver(() => this._queueArt(b));
      b.observer.observe(xwin.document.body, { childList: true, subtree: true });
    } catch (e) {
      Zotero.logError(e);
    }
    this._bindings.push(b);
    this._syncArt(b);
    Zotero.debug('Ping Wheel: attached to a PDF view');
  },

  /* ---------- Gesture ---------- */

  _isTriggerKey(e) {
    const key = String(this.pref('triggerKey') || 'g').trim().toLowerCase() || 'g';
    return this.pref('trigger') === 'key' && typeof e.key === 'string' && e.key.toLowerCase() === key;
  },

  _triggerHeld(e) {
    switch (this.pref('trigger')) {
      case 'key': return this._keyHeld && !e.altKey && !e.ctrlKey && !e.metaKey;
      case 'shift': return e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey;
      case 'ctrl': return e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
      case 'meta': return e.metaKey && !e.altKey && !e.shiftKey && !e.ctrlKey;
      case 'alt':
      default: return e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    }
  },

  _stop(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  },

  _swallow(e) {
    if (this._gesture || Date.now() < this._suppressUntil) this._stop(e);
  },

  _findPage(doc, target, x, y) {
    try {
      const el = target && target.closest ? target.closest('.page[data-page-number]') : null;
      if (el) return el;
    } catch (e) {}
    for (const page of doc.querySelectorAll('.page[data-page-number]')) {
      const r = page.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return page;
    }
    return null;
  },

  _onPointerDown(e, reader, xwin) {
    if (this._gesture) {
      this._stop(e);
      if (e.button !== 0) this._cancel();
      return;
    }
    if (e.button !== 0 || !this._triggerHeld(e)) return;

    const doc = xwin.document;
    const pageEl = this._findPage(doc, e.target, e.clientX, e.clientY);
    if (!pageEl) return;

    const spot = this._pdfSpot(xwin, pageEl, e.clientX, e.clientY);
    if (!spot) return;

    this._stop(e);
    try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
    this._swallowAltUp = e.altKey;
    this._ensureAssets();

    const ro = PW_SIZES[this.pref('wheelSize')] || PW_SIZES.medium;
    const g = {
      xwin, doc, reader, pageEl, spot,
      cx: e.clientX, cy: e.clientY,
      ro, ri: Math.round(ro * 0.38),
      slice: -1,
      wheel: this._wheelDefs(),
      reduced: this._reducedMotion(xwin),
    };
    this._gesture = g;
    this._buildWheel(g);
    this._setSlice(-1);
  },

  _onPointerMove(e) {
    const g = this._gesture;
    if (!g) return;
    this._stop(e);
    const dx = e.clientX - g.cx, dy = e.clientY - g.cy;
    this._setSlice(pwPickSlice(dx, dy, g.ri));
    const d = Math.hypot(dx, dy) || 1, k = Math.min(1, (g.ro - 6) / d);
    g.els.line.setAttribute('x2', dx * k);
    g.els.line.setAttribute('y2', dy * k);
  },

  _onPointerUp(e) {
    if (!this._gesture) return;
    this._stop(e);
    if (e.button === 0) this._finish();
  },

  _onKeyDown(e) {
    if (!this._gesture) {
      if (this._isTriggerKey(e) && !pwEditable(e.target)) this._keyHeld = true;
      return;
    }
    this._stop(e);
    if (e.key === 'Escape') this._cancel();
  },

  _onKeyUp(e) {
    if (this._isTriggerKey(e)) this._keyHeld = false;
    if (e.key === 'Alt' && this._swallowAltUp) {
      // Keep Windows/Linux from opening the menu bar after an Alt + drag.
      this._swallowAltUp = false;
      e.preventDefault();
    }
  },

  _cancel() {
    const g = this._gesture;
    if (!g) return;
    this._gesture = null;
    this._suppressUntil = Date.now() + 400;
    this._removeWheel(g);
  },

  _finish() {
    const g = this._gesture;
    this._gesture = null;
    this._suppressUntil = Date.now() + 400;
    this._removeWheel(g);

    let def = g.slice >= 0 ? g.wheel[g.slice] : null;
    if (!def && this.pref('centerAction') !== 'cancel') def = pwPing('generic');
    if (!def) return;

    const save = this._shouldSave(g, def, Date.now());
    // A ping that isn't saved stays up for the whole window for a second ping.
    this._fx(g, def, save ? 1300 : PW_DOUBLE_MS);
    this._playSound(def, g.xwin);
    if (!save) return;
    this._save(g, def).catch((err) => {
      Zotero.logError(err);
      this._toast(g.doc, `Couldn't save the ping: ${err.message || err}`);
    });
  },

  /** Every ping saves, or (the default) only the same ping again near the last one within 3 seconds. */
  _shouldSave(g, def, now) {
    if (this.pref('saveMode') === 'single') return true;
    const last = this._lastPing, s = g.spot;
    const again = !!last && last.xwin === g.xwin && last.id === def.id && last.pageIndex === s.pageIndex
      && now - last.time <= PW_DOUBLE_MS && Math.hypot(s.x - last.x, s.y - last.y) * s.scale <= PW_DOUBLE_PX;
    this._lastPing = again ? null : { xwin: g.xwin, id: def.id, pageIndex: s.pageIndex, x: s.x, y: s.y, time: now };
    return again;
  },

  _wheelDefs() {
    const ids = String(this.pref('wheel') || '').split(',').map(s => s.trim()).filter(Boolean);
    const valid = ids.length === 8 && new Set(ids).size === 8 && ids.every(pwPing);
    return (valid ? ids : PW_DEFAULT_WHEEL).map(pwPing);
  },

  _reducedMotion(xwin) {
    try { return xwin.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  },

  /* ---------- Coordinates ---------- */

  _pdfSpot(xwin, pageEl, clientX, clientY) {
    try {
      const pageNumber = parseInt(pageEl.getAttribute('data-page-number'), 10);
      const app = PW_Cu.waiveXrays(xwin).PDFViewerApplication;
      const pageView = app.pdfViewer.getPageView(pageNumber - 1);
      const vp = pageView.viewport;
      const ref = pageEl.querySelector('.canvasWrapper') || pageEl;
      const r = ref.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const lx = ((clientX - r.left) * vp.width) / r.width;
      const ly = ((clientY - r.top) * vp.height) / r.height;
      const pt = vp.convertToPdfPoint(lx, ly);
      const vb = vp.viewBox;
      const x0 = Math.min(vb[0], vb[2]), x1 = Math.max(vb[0], vb[2]);
      const y0 = Math.min(vb[1], vb[3]), y1 = Math.max(vb[1], vb[3]);
      const half = 11;
      const x = Math.min(Math.max(pt[0], x0 + half), x1 - half);
      const y = Math.min(Math.max(pt[1], y0 + half), y1 - half);
      const pageRect = pageEl.getBoundingClientRect();
      return {
        pageIndex: pageNumber - 1,
        pageLabel: String(pageView.pageLabel || pageNumber),
        x, y,
        scale: vp.scale,
        top: Math.max(0, Math.floor(y1 - y)),
        localX: clientX - pageRect.left - pageEl.clientLeft,
        localY: clientY - pageRect.top - pageEl.clientTop,
      };
    } catch (e) {
      Zotero.logError(e);
      return null;
    }
  },

  /* ---------- Saving ---------- */

  async _save(g, def) {
    const att = Zotero.Items.get(g.reader.itemID);
    if (!att || !att.isPDFAttachment || !att.isPDFAttachment()) throw new Error('this reader is not showing a PDF attachment');
    let editable = true;
    try { editable = Zotero.Libraries.get(att.libraryID).editable; } catch (e) {}
    if (!editable) {
      this._toast(g.doc, "This library is read-only, so the ping wasn't saved.");
      return;
    }
    const s = g.spot;
    const pad = (n, w) => String(Math.max(0, Math.round(n))).padStart(w, '0');
    const item = new Zotero.Item('annotation');
    item.libraryID = att.libraryID;
    item.parentID = att.id;
    item.annotationType = 'note';
    item.annotationColor = def.color;
    item.annotationComment = `${def.glyph} ${def.name}`;
    item.annotationPageLabel = s.pageLabel;
    item.annotationSortIndex = `${pad(s.pageIndex, 5)}|${pad(0, 6)}|${pad(s.top, 5)}`;
    item.annotationPosition = JSON.stringify({
      pageIndex: s.pageIndex,
      rects: [[s.x - 11, s.y - 11, s.x + 11, s.y + 11].map(v => Math.round(v * 1000) / 1000)],
    });
    if (this.pref('addTag')) item.addTag(`ping:${def.id}`);
    await item.saveTx();
  },

  /* ---------- Drawing ---------- */

  _iconEl(doc, def, size, which) {
    const src = this._assets.textures.get(pwArtName(def, which));
    const wrap = doc.createElement('div');
    wrap.style.cssText = `position:absolute;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;`
      + `font-size:${Math.round(size * 0.62)}px;line-height:1;color:${PW_INK};`;
    if (src) {
      const img = doc.createElement('img');
      img.style.cssText = `width:${size}px;height:${size}px;object-fit:contain;`;
      img.alt = '';
      img.addEventListener('error', () => { img.remove(); wrap.textContent = def.glyph; });
      img.src = src;
      wrap.appendChild(img);
    } else {
      wrap.textContent = def.glyph;
    }
    return wrap;
  },

  _buildWheel(g) {
    const doc = g.doc, ro = g.ro, ri = g.ri;
    const box = (ro + 10) * 2, c = box / 2;
    const root = doc.createElement('div');
    root.style.cssText = `position:fixed;left:${g.cx - c}px;top:${g.cy - c}px;width:${box}px;height:${box}px;`
      + 'z-index:2147483647;pointer-events:none;user-select:none;'
      + 'font-family:system-ui,-apple-system,"Segoe UI",sans-serif;';

    const svg = doc.createElementNS(PW_SVGNS, 'svg');
    svg.setAttribute('width', box);
    svg.setAttribute('height', box);
    svg.setAttribute('viewBox', `${-c} ${-c} ${box} ${box}`);
    svg.style.cssText = 'position:absolute;left:0;top:0;overflow:visible;';

    const halo = doc.createElementNS(PW_SVGNS, 'circle');
    halo.setAttribute('r', ro + 4);
    halo.setAttribute('fill', 'rgba(0,0,0,0.18)');
    svg.appendChild(halo);

    const paths = [];
    for (let i = 0; i < 8; i++) {
      const p = doc.createElementNS(PW_SVGNS, 'path');
      p.setAttribute('d', pwSector(ri + 3, ro, i * 45 - 22.5 + 1.4, i * 45 + 22.5 - 1.4));
      p.setAttribute('fill', PW_BASE);
      p.setAttribute('stroke', PW_RIM);
      p.setAttribute('stroke-width', '1.2');
      svg.appendChild(p);
      paths.push(p);
    }

    const hub = doc.createElementNS(PW_SVGNS, 'circle');
    hub.setAttribute('r', ri - 3);
    hub.setAttribute('fill', PW_BASE);
    hub.setAttribute('stroke', PW_RIM);
    hub.setAttribute('stroke-width', '1.2');
    svg.appendChild(hub);

    const line = doc.createElementNS(PW_SVGNS, 'line');
    line.setAttribute('x1', 0);
    line.setAttribute('y1', 0);
    line.setAttribute('x2', 0);
    line.setAttribute('y2', 0);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', '0');
    svg.appendChild(line);
    root.appendChild(svg);

    const iconSize = Math.round((ro - ri) * 0.56);
    const icons = g.wheel.map((def, i) => {
      const [x, y] = pwPolar((ri + ro) / 2 + 1, i * 45);
      const el = this._iconEl(doc, def, iconSize, 'icon');
      el.style.left = `${c + x - iconSize / 2}px`;
      el.style.top = `${c + y - iconSize / 2}px`;
      el.style.transition = g.reduced ? 'none' : 'transform 90ms ease-out';
      root.appendChild(el);
      return el;
    });

    const label = doc.createElement('div');
    const lw = (ri - 8) * 2;
    label.style.cssText = `position:absolute;left:${c - lw / 2}px;top:${c - 16}px;width:${lw}px;height:32px;`
      + `display:flex;align-items:center;justify-content:center;text-align:center;`
      + `color:${PW_INK};font-size:${ro < 100 ? 10 : 11}px;font-weight:600;line-height:1.15;letter-spacing:0.01em;`;
    root.appendChild(label);

    (doc.body || doc.documentElement).appendChild(root);
    g.els = { root, paths, icons, label, line };

    if (!g.reduced) {
      pwAnimate(root, [{ opacity: 0, transform: 'scale(0.86)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: 110, easing: 'ease-out' });
    }
  },

  _setSlice(i) {
    const g = this._gesture;
    if (!g || !g.els) return;
    if (i === g.slice && g.els.label.textContent) return;
    const { paths, icons, label, line } = g.els;
    if (g.slice >= 0) {
      paths[g.slice].setAttribute('fill', PW_BASE);
      paths[g.slice].setAttribute('stroke', PW_RIM);
      icons[g.slice].style.transform = 'scale(1)';
    }
    g.slice = i;
    if (i >= 0) {
      const def = g.wheel[i];
      paths[i].setAttribute('fill', pwRgba(def.color, 0.78));
      paths[i].setAttribute('stroke', def.color);
      icons[i].style.transform = 'scale(1.18)';
      label.textContent = def.name;
      line.setAttribute('stroke', def.color);
      line.setAttribute('opacity', '0.9');
    } else {
      label.textContent = this.pref('centerAction') === 'cancel' ? 'Cancel' : 'Generic';
      line.setAttribute('opacity', '0');
    }
  },

  _removeWheel(g) {
    const root = g && g.els && g.els.root;
    if (!root) return;
    try {
      if (g.reduced) { root.remove(); return; }
      const a = pwAnimate(root, [{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: 'ease-in' });
      if (a) a.onfinish = () => root.remove(); else root.remove();
      g.xwin.setTimeout(() => root.remove(), 300);
    } catch (e) {
      try { root.remove(); } catch (err) {}
    }
  },

  _fx(g, def, hold) {
    try {
      const doc = g.doc;
      const fx = doc.createElement('div');
      fx.style.cssText = `position:absolute;left:${g.spot.localX}px;top:${g.spot.localY}px;width:0;height:0;z-index:60;pointer-events:none;`;

      const ring = (delay) => {
        const r = doc.createElement('div');
        r.style.cssText = `position:absolute;left:-34px;top:-34px;width:68px;height:68px;border-radius:50%;`
          + `border:3px solid ${def.color};box-shadow:0 0 14px ${pwRgba(def.color, 0.7)};opacity:0;`;
        fx.appendChild(r);
        if (g.reduced) r.style.opacity = '0.9';
        else {
          const a = pwAnimate(r, [
            { opacity: 0.95, transform: 'scale(0.25)' },
            { opacity: 0, transform: 'scale(1.6)' },
          ], { duration: 700, delay, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' });
          if (!a) r.style.opacity = '0.9';
        }
      };
      ring(0);
      ring(160);

      const size = PW_ART_PX;
      const icon = this._iconEl(doc, def, size, 'art');
      icon.style.left = `${-size / 2}px`;
      icon.style.top = `${-size}px`;
      icon.style.filter = `drop-shadow(0 2px 4px rgba(0,0,0,0.45)) drop-shadow(0 0 6px ${pwRgba(def.color, 0.6)})`;
      fx.appendChild(icon);

      g.pageEl.appendChild(fx);
      if (!g.reduced) {
        const at = ms => ms / hold;
        pwAnimate(icon, [
          { opacity: 0, transform: 'translateY(10px) scale(0.4)' },
          { opacity: 1, transform: 'translateY(-4px) scale(1.15)', offset: at(234) },
          { opacity: 1, transform: 'translateY(0) scale(1)', offset: at(390) },
          { opacity: 1, transform: 'translateY(0) scale(1)', offset: at(hold - 260) },
          { opacity: 0, transform: 'translateY(-6px) scale(0.9)' },
        ], { duration: hold, easing: 'ease-out', fill: 'forwards' });
      }
      g.xwin.setTimeout(() => fx.remove(), hold + 100);
    } catch (e) {
      Zotero.logError(e);
    }
  },

  _toast(doc, text) {
    try {
      const t = doc.createElement('div');
      t.textContent = text;
      t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;'
        + `max-width:80%;padding:8px 14px;border-radius:8px;background:${PW_BASE};color:${PW_INK};`
        + `border:1px solid ${PW_RIM};font:600 12px system-ui,-apple-system,"Segoe UI",sans-serif;pointer-events:none;`;
      (doc.body || doc.documentElement).appendChild(t);
      doc.defaultView.setTimeout(() => t.remove(), 3500);
    } catch (e) {}
  },

  /* ---------- Art on ping notes ---------- */

  _queueAllArt() {
    for (const b of this._bindings) this._queueArt(b);
  },

  _queueArt(b) {
    if (b.artTimer) return;
    try {
      b.artTimer = b.xwin.setTimeout(() => { b.artTimer = null; this._syncArt(b); }, 80);
    } catch (e) {
      b.artTimer = null;
    }
  },

  /** The ping a note annotation was made for: by its tag, or by its comment when tags are off. */
  _pingOf(ann) {
    if (ann.annotationType !== 'note') return null;
    for (const { tag } of ann.getTags()) {
      const def = tag.startsWith('ping:') && pwPing(tag.slice(5));
      if (def) return def;
    }
    const comment = ann.annotationComment || '';
    return PW_PINGS.find(p => comment.startsWith(`${p.glyph} ${p.name}`)) || null;
  },

  /** Puts the ping's art over each ping note on the rendered pages, and removes art that no longer belongs. */
  _syncArt(b) {
    try {
      if (b.dead()) return;
      const doc = b.xwin.document;
      if (!doc || !doc.body) return;
      const want = new Map();
      const att = this.pref('artOnNotes') ? Zotero.Items.get(b.reader.itemID) : null;
      if (att && att.isPDFAttachment && att.isPDFAttachment()) {
        for (const ann of att.getAnnotations()) {
          const def = this._pingOf(ann);
          const src = def && this._assets.textures.get(pwArtName(def, 'art'));
          if (!src) continue;
          let pos;
          try { pos = JSON.parse(ann.annotationPosition); } catch (e) { continue; }
          if (!pos || !Array.isArray(pos.rects) || !pos.rects[0]) continue;
          want.set(ann.key, { def, src, pageIndex: pos.pageIndex, rect: pos.rects[0] });
        }
      }
      for (const el of doc.querySelectorAll('.pw-note-art')) {
        const w = want.get(el.getAttribute('data-key'));
        const page = el.parentNode;
        if (!w || !page || page.getAttribute('data-page-number') !== String(w.pageIndex + 1)) el.remove();
      }
      // Without the hook, a circle behind the art hides the sticky note instead.
      const hooked = want.size > 0 && this._hookNoteDrawing(b);
      const keys = hooked ? new Set(want.keys()) : new Set();
      const keysChanged = keys.size !== b.artKeys.size || [...keys].some(k => !b.artKeys.has(k));
      b.artKeys = keys;
      if (keysChanged) this._redraw(b);
      if (!want.size) return;
      const app = PW_Cu.waiveXrays(b.xwin).PDFViewerApplication;
      for (const [key, w] of want) {
        const pageEl = doc.querySelector(`.page[data-page-number="${w.pageIndex + 1}"]`);
        const box = pageEl && this._artBox(app, w, hooked);
        if (!box) continue;
        let el = pageEl.querySelector(`:scope > .pw-note-art[data-key="${key}"]`);
        if (!el) {
          el = this._noteArtEl(doc, key);
          pageEl.appendChild(el);
        }
        const sig = `${box.left},${box.top},${box.width},${box.height}|${w.def.id}|${this._assets.gen}|${hooked}`;
        if (el.getAttribute('data-sig') === sig) continue;
        el.setAttribute('data-sig', sig);
        el.style.cssText = `position:absolute;left:${box.left};top:${box.top};width:${box.width};height:${box.height};`
          + 'transform:translate(-50%, -50%);z-index:50;pointer-events:none;box-sizing:border-box;border-radius:50%;'
          + (hooked ? '' : `background:rgba(14, 19, 28, 0.92);border:1.5px solid ${w.def.color};`
            + `box-shadow:0 0 5px ${pwRgba(w.def.color, 0.55)};`);
        el.firstChild.src = w.src;
      }
    } catch (e) {
      Zotero.logError(e);
    }
  },

  /**
   * Makes the reader skip the sticky-note icon of notes in a binding's artKeys. The note stays a
   * normal note: Zotero finds clicks from the annotation data, not from what it drew.
   */
  _hookNoteDrawing(b) {
    try {
      const view = PW_Cu.waiveXrays(b.reader._internalReader)[b.viewName];
      const page = view && view._pages && view._pages[0];
      const renderer = page && page._pageRenderer;
      if (!renderer) return false;
      const proto = PW_Cu.waiveXrays(Object.getPrototypeOf(renderer));
      const raw = PW_Cu.unwaiveXrays(proto);
      if (this._drawPatches.some(p => PW_Cu.unwaiveXrays(p.proto) === raw)) return true;
      const orig = proto._drawNote;
      if (typeof orig !== 'function') return false;
      const self = this;
      proto._drawNote = PW_Cu.exportFunction(function (annotation) {
        let skip = false;
        try {
          const id = PW_Cu.waiveXrays(annotation).id;
          skip = self._bindings.some(x => x.artKeys.has(id));
        } catch (e) {}
        if (!skip) return orig.call(this, annotation);
        return undefined;
      }, proto);
      this._drawPatches.push({ proto, orig });
      return true;
    } catch (e) {
      Zotero.logError(e);
      return false;
    }
  },

  _redraw(b) {
    try {
      const view = PW_Cu.waiveXrays(b.reader._internalReader)[b.viewName];
      if (!view || typeof view._render !== 'function') return;
      // The renderers skip a repaint when the annotations look unchanged, which they do here.
      const pages = view._pages || [];
      for (let i = 0; i < pages.length; i++) {
        for (const r of [pages[i]._pageRenderer, pages[i]._detailRenderer]) {
          if (r && typeof r._invalidateSignature === 'function') r._invalidateSignature();
        }
      }
      view._render();
    } catch (e) {}
  },

  /**
   * The centre of the note icon, in percent of the page so zooming keeps it in place, and the art's size:
   * the pop-up's size when Zotero skips the sticky note, else a circle that grows with the page to cover it.
   */
  _artBox(app, w, hooked) {
    const pv = app.pdfViewer.getPageView(w.pageIndex);
    const vp = pv && pv.viewport;
    if (!vp || !vp.width || !vp.height) return null;
    // Pass numbers, not an array: page code can't read an array made here.
    const p1 = vp.convertToViewportPoint(w.rect[0], w.rect[1]);
    const p2 = vp.convertToViewportPoint(w.rect[2], w.rect[3]);
    // The reader draws the note icon as a 24-point square from the rect's top-left corner.
    // A circle 1.45 times that wide covers the whole square.
    const icon = 24 * vp.scale, cover = icon * 1.45;
    const cx = Math.min(p1[0], p2[0]) + icon / 2, cy = Math.min(p1[1], p2[1]) + icon / 2;
    const pct = (v, total) => `${((v / total) * 100).toFixed(3)}%`;
    return {
      left: pct(cx, vp.width),
      top: pct(cy, vp.height),
      width: hooked ? `${PW_ART_PX}px` : pct(cover, vp.width),
      height: hooked ? `${PW_ART_PX}px` : pct(cover, vp.height),
    };
  },

  _noteArtEl(doc, key) {
    const el = doc.createElement('div');
    el.className = 'pw-note-art';
    el.setAttribute('data-key', key);
    const img = doc.createElement('img');
    img.alt = '';
    img.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;'
      + 'filter:drop-shadow(0 1px 2px rgba(0,0,0,0.5));';
    el.appendChild(img);
    return el;
  },

  /* ---------- Sound ---------- */

  _playSound(def, xwin) {
    if (!this.pref('sound')) return;
    const vol = Math.min(1, Math.max(0, parseInt(this.pref('volume'), 10) / 100 || 0));
    if (!vol) return;
    const win = Zotero.getMainWindow() || xwin;
    const file = this._assets.sounds.get(def.sound);
    if (file) {
      try {
        const a = new win.Audio(file);
        a.volume = vol;
        const p = a.play();
        if (p && p.catch) p.catch(() => this._blip(win, def, vol));
        return;
      } catch (e) {}
    }
    this._blip(win, def, vol);
  },

  _blip(win, def, vol) {
    try {
      if (!this._audioCtx || this._audioCtx.state === 'closed') this._audioCtx = new win.AudioContext();
      const ctx = this._audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      const [f1, f2] = def.tone;
      for (const [type, mult, gainMul] of [['sine', 1, 1], ['triangle', 2, 0.25]]) {
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(f1 * mult, t);
        o.frequency.exponentialRampToValueAtTime(f2 * mult, t + 0.14);
        gn.gain.setValueAtTime(0.0001, t);
        gn.gain.exponentialRampToValueAtTime(0.28 * vol * gainMul, t + 0.012);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
        o.connect(gn);
        gn.connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.42);
      }
    } catch (e) {
      Zotero.debug('Ping Wheel: sound failed: ' + e);
    }
  },

  /* ---------- Textures and sounds ---------- */

  // The bundled files load once. Files in the assets folder setting replace them by name.
  async _ensureAssets() {
    const dir = String(this.pref('assetsDir') || '').trim();
    if (dir === this._assets.loadedFor) return;
    this._assets.loadedFor = dir;
    if (!this._bundled) this._bundled = this._loadBundled();
    const bundled = await this._bundled;
    const textures = new Map(bundled.textures), sounds = new Map(bundled.sounds);
    if (dir) {
      try {
        const win = Zotero.getMainWindow();
        const IO = typeof IOUtils !== 'undefined' ? IOUtils : win.IOUtils;
        const Path = typeof PathUtils !== 'undefined' ? PathUtils : win.PathUtils;
        let base = dir, nTex = 0, nSnd = 0;
        if (await IO.exists(Path.join(dir, 'assets', 'textures'))) base = Path.join(dir, 'assets');
        for (const name of pwTextureNames()) {
          const f = Path.join(base, 'textures', name + '.png');
          if (!(await IO.exists(f))) continue;
          textures.set(name, pwDataURI(await IO.read(f), 'image/png'));
          nTex++;
        }
        for (const p of PW_PINGS) {
          const f = Path.join(base, 'sounds', p.sound + '.wav');
          if (await IO.exists(f)) { sounds.set(p.sound, Path.toFileURI(f)); nSnd++; }
        }
        Zotero.debug(`Ping Wheel: loaded ${nTex} textures and ${nSnd} sounds from ${base}`);
      } catch (e) {
        Zotero.logError(e);
      }
    }
    if (this._assets.loadedFor === dir) {
      this._assets.textures = textures;
      this._assets.sounds = sounds;
      this._assets.gen++;
      this._queueAllArt();
    }
  },

  async _loadBundled() {
    const textures = new Map(), sounds = new Map();
    if (!PW_NetUtil) return { textures, sounds };
    const base = this.rootURI + 'assets/';
    // A missing file falls back to the emoji and the tone.
    for (const name of pwTextureNames()) {
      try { textures.set(name, pwDataURI(await pwReadURL(`${base}textures/${name}.png`), 'image/png')); }
      catch (e) {}
    }
    for (const sound of new Set(PW_PINGS.map(p => p.sound))) {
      try { sounds.set(sound, pwDataURI(await pwReadURL(`${base}sounds/${sound}.wav`), 'audio/wav')); }
      catch (e) {}
    }
    Zotero.debug(`Ping Wheel: loaded ${textures.size} bundled textures and ${sounds.size} bundled sounds`);
    return { textures, sounds };
  },
};
