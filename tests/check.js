const fs = require('fs'), path = require('path'), vm = require('vm');
// Checks the plugin in the given folder, or this repo by default: node tests/check.js
const B = process.argv[2] || path.join(__dirname, '..');
const src = fs.readFileSync(path.join(B, 'pingwheel.js'), 'utf8');
const ctx = {
  Components: { utils: {}, interfaces: { nsILoadInfo: {}, nsIContentPolicy: {} }, isSuccessCode: s => s === 0 },
  ChromeUtils: {
    importESModule: () => { throw new Error('n/a'); },
    base64URLEncode: (bytes, { pad }) => { let s = Buffer.from(bytes).toString('base64url'); if (pad) while (s.length % 4) s += '='; return s; },
  },
  Zotero: {},
};
vm.createContext(ctx);
vm.runInContext(src + '\n;this.out = { PW_PINGS, pwArtName, pwTextureNames, pwDataURI, PingWheel };', ctx);
const { PW_PINGS, pwTextureNames, pwDataURI, PingWheel } = ctx.out;
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

// 1. Every texture and sound the code asks for is bundled, and nothing extra is.
const tex = [...pwTextureNames()].sort();
const bundledTex = fs.readdirSync(path.join(B, 'assets/textures')).map(f => f.replace(/\.png$/, '')).sort();
ok(JSON.stringify(tex) === JSON.stringify(bundledTex), `textures match bundle (${tex.length})`);
const snd = [...new Set(PW_PINGS.map(p => p.sound))].sort();
const bundledSnd = fs.readdirSync(path.join(B, 'assets/sounds')).map(f => f.replace(/\.wav$/, '')).sort();
ok(JSON.stringify(snd) === JSON.stringify(bundledSnd), `sounds match bundle (${snd.length})`);

// 2. Data URI base64 equals standard base64 of the real files.
for (const f of ['assets/textures/push.png', 'assets/sounds/Base.wav']) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(B, f)));
  const uri = pwDataURI(bytes, 'x/y');
  ok(uri === 'data:x/y;base64,' + Buffer.from(bytes).toString('base64'), `data URI is plain base64: ${f}`);
}

// 3. Art box: centred on the 24-pt note icon. With the hook it is a fixed 46 px like the pop-up;
//    without it, a circle 1.45x the icon that covers the whole sticky note at any zoom.
function viewport(scale, rotation, W = 612, H = 792) {
  // Minimal pdf.js PageViewport for rotation 0 and 90.
  const t = rotation === 0 ? [scale, 0, 0, -scale, 0, H * scale] : [0, scale, scale, 0, 0, 0];
  const apply = ([x, y]) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]];
  return {
    scale, width: (rotation === 0 ? W : H) * scale, height: (rotation === 0 ? H : W) * scale,
    // Like Zotero: page code can't read arrays from the plugin, so only numbers are accepted.
    convertToViewportPoint: (x, y) => {
      if (typeof x !== 'number' || typeof y !== 'number') throw new Error('Permission denied to access property 0');
      return apply([x, y]);
    },
  };
}
const w = { pageIndex: 0, rect: [289, 385, 311, 407] }; // a note centred on (300, 396)
for (const [scale, rot] of [[96 / 72, 0], [2.5, 0], [0.6, 0], [96 / 72, 90]]) {
  const vp = viewport(scale, rot);
  const app = { pdfViewer: { getPageView: () => ({ viewport: vp }) } };
  const a = vp.convertToViewportPoint(w.rect[0], w.rect[1]), c = vp.convertToViewportPoint(w.rect[2], w.rect[3]);
  const iconX = Math.min(a[0], c[0]) + 12 * scale, iconY = Math.min(a[1], c[1]) + 12 * scale;
  const tag = `(scale ${scale.toFixed(2)}, rot ${rot})`;
  for (const hooked of [true, false]) {
    const box = PingWheel._artBox(app, w, hooked);
    const cx = parseFloat(box.left) / 100 * vp.width, cy = parseFloat(box.top) / 100 * vp.height;
    ok(Math.abs(cx - iconX) < 0.05 && Math.abs(cy - iconY) < 0.05, `${hooked ? 'art' : 'circle'} centred on note icon ${tag}`);
    if (hooked) {
      ok(box.width === '46px' && box.height === '46px', `art is 46 px, same as the pop-up, at any zoom ${tag}`);
    } else {
      const wpx = parseFloat(box.width) / 100 * vp.width, hpx = parseFloat(box.height) / 100 * vp.height;
      ok(Math.abs(wpx - 24 * scale * 1.45) < 0.05 && Math.abs(hpx - wpx) < 0.05, `circle is square, 1.45x icon ${tag}`);
      ok(wpx / 2 >= Math.hypot(12, 12) * scale, `circle covers the icon's corners ${tag}`);
    }
  }
}

// 4. Ping detection by tag, by comment, and not for other notes.
const ann = (type, tags, comment) => ({ annotationType: type, getTags: () => tags.map(tag => ({ tag })), annotationComment: comment });
ok(PingWheel._pingOf(ann('note', ['ping:danger'], 'my words')).id === 'danger', 'tagged note found by tag');
ok(PingWheel._pingOf(ann('note', [], '❓ Enemy Missing — check this')).id === 'missing', 'untagged note found by comment');
ok(PingWheel._pingOf(ann('note', [], '¿ Upside-down Missing')).id === 'missingflip', 'upside-down missing not confused with missing');
ok(PingWheel._pingOf(ann('note', ['ping:nope'], 'hello')) === null, 'unknown tag and plain note ignored');
ok(PingWheel._pingOf(ann('highlight', ['ping:danger'], '')) === null, 'non-note annotation ignored');

// 5. Trigger key: G by default, any case, not while typing, released on keyup.
const prefs = { trigger: 'key', triggerKey: 'g' };
PingWheel.pref = k => prefs[k];
const kev = (key, target = { localName: 'div' }) => ({ key, target });
const mods = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
PingWheel._keyHeld = false;
PingWheel._onKeyDown(kev('g'));
ok(PingWheel._keyHeld && PingWheel._triggerHeld(mods), 'holding G arms the wheel');
ok(!PingWheel._triggerHeld({ ...mods, ctrlKey: true }), 'G with Ctrl does not');
PingWheel._onKeyUp(kev('g'));
ok(!PingWheel._keyHeld && !PingWheel._triggerHeld(mods), 'letting go of G disarms it');
PingWheel._onKeyDown(kev('G'));
ok(PingWheel._keyHeld, 'Shift+G (key "G") also counts');
PingWheel._onKeyUp(kev('G'));
PingWheel._onKeyDown(kev('g', { localName: 'textarea' }));
ok(!PingWheel._keyHeld, 'typing g in a text box does not arm it');
PingWheel._onKeyDown(kev('h'));
ok(!PingWheel._keyHeld, 'other keys do not arm it');
prefs.triggerKey = 'Q';
PingWheel._onKeyDown(kev('q'));
ok(PingWheel._keyHeld, 'a custom key (Q) works');
PingWheel._onKeyUp(kev('q'));
prefs.triggerKey = '';
PingWheel._onKeyDown(kev('g'));
ok(PingWheel._keyHeld, 'an empty key setting falls back to G');
PingWheel._onKeyUp(kev('g'));
prefs.trigger = 'alt';
PingWheel._onKeyDown(kev('g'));
ok(!PingWheel._keyHeld && PingWheel._triggerHeld({ ...mods, altKey: true }), 'with the Alt trigger, G does nothing and Alt works');

// 6. Double ping: only the same ping again, close by, within 3 s, saves; then it starts over.
prefs.saveMode = 'double';
const W1 = {}, W2 = {};
const gp = (x, y, extra = {}) => ({ xwin: W1, spot: { pageIndex: 0, x, y, scale: 96 / 72, ...extra } });
const danger = PW_PINGS[0], push = PW_PINGS[1];
const seq = (steps) => { PingWheel._lastPing = null; return steps.map(([g, def, t]) => PingWheel._shouldSave(g, def, t)); };
ok(JSON.stringify(seq([[gp(100, 100), danger, 0]])) === '[false]', 'a single ping is not saved');
ok(JSON.stringify(seq([[gp(100, 100), danger, 0], [gp(110, 105), danger, 2500]])) === '[false,true]', 'same ping, close, within 3 s saves');
ok(JSON.stringify(seq([[gp(100, 100), danger, 0], [gp(100, 100), danger, 1000], [gp(100, 100), danger, 1500]])) === '[false,true,false]', 'a third ping starts over');
ok(JSON.stringify(seq([[gp(100, 100), danger, 0], [gp(100, 100), push, 1000]])) === '[false,false]', 'a different ping does not save');
ok(JSON.stringify(seq([[gp(100, 100), danger, 0], [gp(100, 100), danger, 3001]])) === '[false,false]', 'too late does not save');
ok(JSON.stringify(seq([[gp(100, 100), danger, 0], [gp(135, 100), danger, 1000]])) === '[false,false]', 'too far (35 pt = 47 px at 100%) does not save');
ok(JSON.stringify(seq([[gp(100, 100, { scale: 4 }), danger, 0], [gp(115, 100, { scale: 4 }), danger, 1000]])) === '[false,false]', 'distance is measured on screen, so 15 pt at 300% zoom is too far');
ok(JSON.stringify(seq([[gp(100, 100), danger, 0], [gp(100, 100, { pageIndex: 1 }), danger, 1000]])) === '[false,false]', 'another page does not save');
ok(JSON.stringify(seq([[gp(100, 100), danger, 0], [{ ...gp(100, 100), xwin: W2 }, danger, 1000]])) === '[false,false]', 'another PDF view does not save');
ok(JSON.stringify(seq([[gp(100, 100), danger, 0], [gp(100, 100), push, 500], [gp(100, 100), push, 1000]])) === '[false,false,true]', 'a different ping becomes the new first ping');
prefs.saveMode = 'single';
ok(JSON.stringify(seq([[gp(100, 100), danger, 0], [gp(300, 300), push, 9000]])) === '[true,true]', 'on-every-ping mode saves every ping');
process.exit(fail ? 1 : 0);
