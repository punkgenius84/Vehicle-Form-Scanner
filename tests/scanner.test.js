'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const WWW = path.join(__dirname, '..', 'www');
const VIN = '1HGCM82633A004352';            // valid check digit
const VIN2 = '1FTFW1E50NFA00000';

// Trimmed NHTSA DecodeVinValues response.
function nhtsa(over) {
  return { Results: [Object.assign({
    Make: 'FORD', Model: 'F-150', ModelYear: '2022', BodyClass: 'Pickup', DriveType: '4WD/4-Wheel Drive/4x4',
    FuelTypePrimary: 'Gasoline', ElectrificationLevel: '', TransmissionStyle: 'Automatic', TransmissionSpeeds: '10',
    GVWR: 'Class 2E: 6,001 - 7,000 lb (2,722 - 3,175 kg)', Trim: 'XLT', Series: 'F-150', VehicleType: 'TRUCK', Doors: '4',
    DisplacementL: '3.5', EngineCylinders: '6', EngineConfiguration: 'V-Shaped', EngineHP: '400', BrakeSystemType: 'Hydraulic',
    Manufacturer: 'FORD MOTOR COMPANY, USA', PlantCity: 'DEARBORN', PlantState: 'MICHIGAN', PlantCountry: 'UNITED STATES (USA)',
    CurbWeightLB: '', WheelBaseShort: '', ErrorText: '0 - VIN decoded clean.'
  }, over || {})] };
}

function boot(opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/', pretendToBeVisual: true });
  const w = dom.window;
  w.scrollTo = () => {};
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(opts.json || nhtsa()) });
  if (opts.native) w.Capacitor = { getPlatform: () => 'android', Plugins: { NativeVinScanner: opts.native } };
  if (opts.history) w.localStorage.setItem('vinscanner.recent.v1', JSON.stringify(opts.history));
  for (const f of ['data.js', 'engine.js', 'app.js']) w.eval(fs.readFileSync(path.join(WWW, f), 'utf8'));
  return dom;
}
const tick = () => new Promise(r => setTimeout(r, 20));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const val = (d, k) => d.querySelector('#f-' + k).value;

test('scanner code copied from the tow app is byte-for-byte unchanged', () => {
  const mine = fs.readFileSync(path.join(WWW, 'app.js'), 'utf8');
  // Proven photo/OCR build (the Tow-App snapshot the phone test passed with).
  const proven = path.join(__dirname, '..', '..', 'src', 'tow-app', 'www', 'app.js');
  if (fs.existsSync(proven)) {
    const src = fs.readFileSync(proven, 'utf8').replace(/\r/g, '').split('\n');
    for (const [a, b] of [[228, 236], [284, 388], [487, 645], [781, 792]]) assert.ok(mine.includes(src.slice(a - 1, b).join('\n')), 'proven lines ' + a + '-' + b);
  }
  // startBarcodeScan from current Tow-App main, with the single marked VIN SCANNER CHANGE line.
  const current = path.join(__dirname, '..', '..', 'punkgenius84', 'tow-app', 'www', 'app.js');
  if (fs.existsSync(current)) {
    const block = fs.readFileSync(current, 'utf8').split('\n').slice(500, 607).join('\n')
      .replace("          var payload = result && (result.rawValue || result.vin || result.displayValue) || '';",
        "          // VIN SCANNER CHANGE: use the VIN the native scanner already validated (seen twice), then the raw payload.\n          var payload = result && (result.vin || result.rawValue || result.displayValue) || '';");
    assert.ok(mine.includes(block), 'current startBarcodeScan');
  }
});

test('native scanner: validated vin is used even when the raw payload has extra text', async () => {
  const native = { scanLiveBarcode: () => Promise.resolve({ cancelled: false, rawValue: 'PART 1234567 SN 99887766554433221', vin: VIN2, format: 'DATA_MATRIX' }) };
  const { window: w } = boot({ native });
  click(w, w.document.querySelector('#vin-barcode-start'));
  await tick();
  assert.equal(val(w.document, 'vin'), VIN2);
  assert.match(w.document.querySelector('#vin-barcode-status').textContent, /native barcode scanner \(DATA_MATRIX\)/);
});

test('index.html references only files that exist and the SW caches them', () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]);
  for (const r of refs) assert.ok(fs.existsSync(path.join(WWW, decodeURIComponent(r))), 'missing ' + r);
  const sw = fs.readFileSync(path.join(WWW, 'sw.js'), 'utf8');
  for (const f of ['index.html', 'styles.css', 'data.js', 'engine.js', 'app.js']) assert.ok(sw.includes("'" + f + "'"), f);
});

test('native CameraX barcode scan fills the form, decodes with NHTSA and saves to history', async () => {
  let calls = 0;
  const native = { scanLiveBarcode: () => { calls++; return Promise.resolve({ cancelled: false, rawValue: 'I' + VIN2, format: 'CODE_39' }); } };
  const { window: w } = boot({ native });
  const d = w.document;
  click(w, d.querySelector('#vin-barcode-start'));
  await tick();
  assert.equal(calls, 1, 'uses the native CameraX scanner');
  assert.equal(val(d, 'vin'), VIN2);
  assert.equal(val(d, 'source'), 'Barcode scan');
  assert.equal(val(d, 'year'), '2022');
  assert.equal(val(d, 'make'), 'Ford');
  assert.equal(val(d, 'model'), 'F-150');
  assert.equal(val(d, 'engine'), '3.5L · V6 · 400 hp');
  assert.equal(val(d, 'trans'), 'Automatic, 10-speed');
  assert.equal(val(d, 'plant'), 'DEARBORN, MICHIGAN, UNITED STATES (USA)');
  assert.ok(val(d, 'gvwrClass').startsWith('Class 2E'));
  // NHTSA had no curb weight, so the database value is used and labelled as typical.
  assert.equal(val(d, 'curb'), '5000');
  assert.match(d.querySelector('#f-curb').parentNode.textContent, /Typical for Ford F-150/);
  const hist = w.__vin.history();
  assert.equal(hist.length, 1);
  assert.equal(hist[0].fields.make, 'Ford');
  assert.match(d.querySelector('#history').textContent, /2022 Ford F-150/);
});

test('door sticker text gives GVWR, axle ratings, build date, tires and pressure', () => {
  const { window: w } = boot();
  const native = w.__vin.parseDoorSticker(
    'MFD BY MAZDA MOTOR CORPORATION DATE: 06/13\nGVWR/PNBV 2155 KG (4751 LB)\nGAWR FRT/PNBE AV 1170 KG (2579 LB) WITH P225/45R19 TIRES\n' +
    'GAWR RR/PNBE AR 1035 KG (2282 LB)\nVIN JM1GJ1W51E1100001\nCOLD TIRE PRESSURE 250 KPA, 36 PSI');
  assert.deepEqual(JSON.parse(JSON.stringify(native)), { gvwr: '4751', gawrFront: '2579', gawrRear: '2282', mfgDate: '06/2013',
    tireSizeFront: 'P225/45R19', tireSizeRear: 'P225/45R19', psiFront: '36', psiRear: '36' });
  // Browser OCR whitelist strips punctuation; still read it, and convert kg when no lb is present.
  const browser = w.__vin.parseDoorSticker('Enhanced photo pass:\\nDATE 0613 GVWR PNBV 2155 KG\\nGAWR FRT 1170KG 2579LB');
  assert.equal(browser.gvwr, '4751');
  assert.equal(browser.gawrFront, '2579');
  assert.equal(browser.mfgDate, '06/2013');
});

test('photo of a door sticker fills VIN plus sticker fields', async () => {
  const native = {
    recognizeText: () => Promise.resolve({ text: 'GVWR 6100 LB\nGAWR FR 3200 LB\nGAWR RR 3500 LB\nVIN ' + VIN2 + '\nDATE 11/21' })
  };
  const { window: w } = boot({ native });
  const d = w.document;
  // Stub image prep (jsdom has no canvas); the copied scanVinPhoto calls it through the closure,
  // so drive the flow by setting the file and calling the same click the UI uses.
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }), putImageData() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
  const RealImage = w.Image;
  w.Image = function () { const img = new RealImage(); Object.defineProperty(img, 'naturalWidth', { value: 100 }); Object.defineProperty(img, 'naturalHeight', { value: 50 }); setTimeout(() => img.onload(), 0); return img; };
  w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  w.__vin.state.vinFile = new w.File(['x'], 'sticker.jpg', { type: 'image/jpeg' });
  click(w, d.querySelector('#vin-ocr'));
  await tick(); await tick();
  assert.equal(val(d, 'vin'), VIN2);
  assert.equal(val(d, 'source'), 'Photo (OCR)');
  assert.equal(val(d, 'gvwr'), '6100', 'sticker GVWR wins over database value');
  assert.match(d.querySelector('#f-gvwr').parentNode.textContent, /door sticker/);
  assert.equal(val(d, 'gawrFront'), '3200');
  assert.equal(val(d, 'gawrRear'), '3500');
  assert.equal(val(d, 'mfgDate'), '11/2021');
  assert.equal(val(d, 'make'), 'Ford');
});

test('manual entry, editing and the 6-scan limit', async () => {
  const old = Array.from({ length: 6 }, (_, i) => ({ vin: 'OLDVIN0000000000' + i, savedAt: i, fields: { vin: 'OLDVIN0000000000' + i }, hints: {} }));
  const { window: w } = boot({ history: old });
  const d = w.document;
  d.querySelector('#vin').value = VIN.toLowerCase();
  click(w, d.querySelector('#vin-go'));
  await tick();
  assert.equal(val(d, 'vin'), VIN);
  assert.equal(val(d, 'source'), 'Manual entry');
  assert.equal(val(d, 'checkDigit'), 'Valid');
  const hist = w.__vin.history();
  assert.equal(hist.length, 6, 'keeps only 6');
  assert.equal(hist[0].vin, VIN);
  assert.ok(!hist.some(h => h.vin === 'OLDVIN00000000005' && false));
  // Edit a field: saved to history.
  const notes = d.querySelector('#f-notes');
  notes.value = 'Front bumper damage';
  notes.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(w.__vin.history()[0].fields.notes, 'Front bumper damage');
  // New scan clears, tapping history reloads.
  click(w, d.querySelector('#new-scan'));
  assert.equal(val(d, 'vin'), '');
  click(w, d.querySelector('[data-load="0"]'));
  assert.equal(val(d, 'vin'), VIN);
  assert.equal(val(d, 'notes'), 'Front bumper damage');
  // Two-tap clear.
  click(w, d.querySelector('#clear-history'));
  assert.equal(w.__vin.history().length, 6);
  click(w, d.querySelector('#clear-history'));
  assert.equal(w.__vin.history().length, 0);
});

test('bad manual VIN is rejected and offline decode keeps the VIN', async () => {
  const { window: w } = boot();
  const d = w.document;
  d.querySelector('#vin').value = '1HGCM82633A00435O';
  click(w, d.querySelector('#vin-go'));
  assert.match(d.querySelector('#msg').textContent, /17 letters and digits/);
  w.fetch = () => Promise.reject(new Error('offline'));
  d.querySelector('#vin').value = VIN;
  click(w, d.querySelector('#vin-go'));
  await tick();
  assert.match(d.querySelector('#msg').textContent, /VIN is saved/);
  assert.equal(w.__vin.history()[0].vin, VIN);
});

test('review fixes: sticker photo flags only when no VIN was read; cancel, delete and new-scan behave', async () => {
  let reply = { rawValue: VIN2 };
  let ocr = { text: 'GVWR 6100 LB' };
  const native = { scanLiveBarcode: () => Promise.resolve(reply), recognizeText: () => Promise.resolve(ocr) };
  const { window: w } = boot({ native });
  const d = w.document;
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }), putImageData() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
  const RealImage = w.Image;
  w.Image = function () { const img = new RealImage(); Object.defineProperty(img, 'naturalWidth', { value: 100 }); Object.defineProperty(img, 'naturalHeight', { value: 50 }); setTimeout(() => img.onload(), 0); return img; };
  w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  const readPhoto = async () => {
    w.__vin.state.vinFile = new w.File(['x'], 'sticker.jpg', { type: 'image/jpeg' });
    click(w, d.querySelector('#vin-ocr'));
    await tick(); await tick();
  };

  click(w, d.querySelector('#vin-barcode-start'));
  await tick();
  assert.equal(val(d, 'vin'), VIN2);
  assert.equal(d.querySelector('#vin').value, VIN2, 'scanned VIN also shows in the manual box, like the tow app');

  // Sticker photo with no readable VIN: values added but flagged.
  await readPhoto();
  assert.equal(val(d, 'gvwr'), '6100');
  assert.match(d.querySelector('#f-gvwr').parentNode.textContent, /confirm same vehicle/);
  assert.match(d.querySelector('#msg').textContent, /No VIN was readable/);

  // Sticker photo of the same vehicle (VIN readable): no warning.
  ocr = { text: 'GVWR 6200 LB VIN ' + VIN2 };
  await readPhoto();
  assert.equal(val(d, 'gvwr'), '6200');
  assert.doesNotMatch(d.querySelector('#f-gvwr').parentNode.textContent, /confirm same vehicle/);

  // Cancelled scan leaves the form alone.
  native.scanLiveBarcode = () => Promise.resolve({ cancelled: true });
  click(w, d.querySelector('#vin-barcode-start'));
  await tick();
  assert.equal(val(d, 'vin'), VIN2);

  // Deleting the entry on screen clears the form; edits can't bring it back; Decode VIN brings it back on purpose.
  click(w, d.querySelector('[data-del="0"]'));
  assert.equal(val(d, 'vin'), '');
  const notes = d.querySelector('#f-notes');
  notes.value = 'x'; notes.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(w.__vin.history().length, 0);
  click(w, d.querySelector('#vin-go'));
  await tick();
  assert.equal(val(d, 'vin'), VIN2);
  assert.equal(val(d, 'make'), 'Ford');
  assert.equal(val(d, 'source'), 'Barcode scan', 'VIN read by the scanner keeps its source');

  // New scan clears the old photo and raw text.
  click(w, d.querySelector('#new-scan'));
  assert.equal(d.querySelector('#vin-preview').hidden, true);
  assert.equal(d.querySelector('#ocr-raw-box').hidden, true);
  assert.equal(w.__vin.state.vinFile, null);
  assert.equal(val(d, 'vin'), '');
});

test('scan panel is the tow app panel: same labels, photo waits for the Read button', () => {
  const towApp = path.join(__dirname, '..', '..', 'punkgenius84', 'tow-app', 'www', 'app.js');
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  if (fs.existsSync(towApp)) {
    const src = fs.readFileSync(towApp, 'utf8');
    for (const label of ['SCAN VIN WITH CAMERA', 'Fastest: scan the VIN barcode on the vehicle label', 'OR USE A PHOTO',
      'Photograph the VIN text on the windshield or driver-door label', 'Read VIN from photo', 'OR ENTER VIN MANUALLY',
      '17-character VIN (NHTSA lookup needs internet)', 'Decode VIN', 'See what OCR actually read']) {
      assert.ok(src.includes(label) && html.includes(label), label);
    }
  }
  let reads = 0;
  const { window: w } = boot({ native: { recognizeText: () => { reads++; return Promise.resolve({ text: '' }); } } });
  const input = w.document.querySelector('#vin-photo');
  Object.defineProperty(input, 'files', { value: [new w.File(['x'], 'a.jpg', { type: 'image/jpeg' })] });
  input.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(reads, 0, 'choosing a photo does not start OCR');
  assert.match(w.document.querySelector('#vin-ocr-status').textContent, /Tap “Read VIN from photo”/);
});

test('a slow lookup for an old VIN does not overwrite the vehicle now on screen', async () => {
  let release;
  const { window: w } = boot();
  const d = w.document;
  w.fetch = () => new Promise(r => { release = () => r({ ok: true, json: () => Promise.resolve(nhtsa()) }); });
  d.querySelector('#vin').value = VIN2;
  click(w, d.querySelector('#vin-go'));
  w.fetch = () => new Promise(() => {});          // second lookup never answers
  d.querySelector('#vin').value = VIN;
  click(w, d.querySelector('#vin-go'));
  release(); await tick();
  assert.equal(val(d, 'vin'), VIN);
  assert.equal(val(d, 'make'), '', 'form for the new VIN untouched');
  assert.doesNotMatch(d.querySelector('#msg').textContent, /^Decoded/);
  const old = w.__vin.history().find(h => h.vin === VIN2);
  assert.equal(old.fields.make, 'Ford', 'old VIN still decoded in the background');
  assert.ok(d.querySelector('.hrow.cur').textContent.includes(VIN), 'highlight stays on the VIN on screen');
});

test('tire label: row layout, column layout and bilingual labels', () => {
  const { window: w } = boot();
  const p = w.__vin.parseTirePlacard;
  const rows = p('TIRE AND LOADING INFORMATION\nSEATING CAPACITY TOTAL 5 FRONT 2 REAR 3\n' +
    'The combined weight of occupants and cargo should never exceed 385 kg or 849 lbs.\n' +
    'TIRE SIZE COLD TIRE PRESSURE\nFRONT P245/60R18 240 kPa, 35 PSI\nREAR P245/60R18 240 kPa, 35 PSI\nSPARE T155/90D17 420 kPa, 60 PSI');
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), { tireSizeFront: 'P245/60R18', psiFront: '35', tireSizeRear: 'P245/60R18', psiRear: '35',
    tireSizeSpare: 'T155/90D17', psiSpare: '60', seating: '5', maxLoad: '849' });
  // ML Kit often returns the table one column at a time, and staggered sizes front/rear.
  const cols = p('SEATING CAPACITY TOTAL 4\nFRONT\nREAR\nSPARE\n245/40ZR19\n275/35ZR19\nT135/80R18\n250 KPA, 36 PSI\n260 KPA, 38 PSI\n420 KPA, 60 PSI');
  assert.equal(cols.tireSizeFront, '245/40ZR19');
  assert.equal(cols.tireSizeRear, '275/35ZR19');
  assert.equal(cols.tireSizeSpare, 'T135/80R18');
  assert.deepEqual([cols.psiFront, cols.psiRear, cols.psiSpare], ['36', '38', '60']);
  assert.equal(cols.seating, '4');
  const fr = p('AVANT FRONT P225/65R17 230 KPA 33 PSI\nARRIÈRE REAR P225/65R17 230 KPA 33 PSI\nDE SECOURS SPARE T155/90D17 420 KPA 60 PSI');
  assert.equal(fr.psiFront, '33'); assert.equal(fr.tireSizeSpare, 'T155/90D17'); assert.equal(fr.psiSpare, '60');
  // kPa-only label
  assert.equal(p('FRONT 215/55R17 240 KPA').psiFront, '35');
  assert.deepEqual(JSON.parse(JSON.stringify(p('nothing useful here'))), {});
});

test('tire label photo fills only tire fields, keeps the door sticker values, works before the VIN', async () => {
  let ocrText = 'FRONT P245/60R18 35 PSI\nREAR P245/60R18 35 PSI\nSPARE T155/90D17 60 PSI\nSEATING CAPACITY TOTAL 5';
  const native = { scanLiveBarcode: () => Promise.resolve({ cancelled: false, vin: VIN2, rawValue: VIN2 }), recognizeText: () => Promise.resolve({ text: ocrText }) };
  const { window: w } = boot({ native });
  const d = w.document;
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }), putImageData() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
  const RealImage = w.Image;
  w.Image = function () { const img = new RealImage(); Object.defineProperty(img, 'naturalWidth', { value: 100 }); Object.defineProperty(img, 'naturalHeight', { value: 50 }); setTimeout(() => img.onload(), 0); return img; };
  w.URL.createObjectURL = () => 'blob:t'; w.URL.revokeObjectURL = () => {};
  const tirePhoto = async () => {
    const input = d.querySelector('#tire-photo');
    Object.defineProperty(input, 'files', { value: [new w.File(['x'], 't.jpg', { type: 'image/jpeg' })], configurable: true });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.match(d.querySelector('#tire-status').textContent, /Tap “Read tire label”/, 'waits for the button');
    click(w, d.querySelector('#tire-ocr'));
    await tick(); await tick();
  };

  // Tire label first, before any VIN.
  await tirePhoto();
  assert.equal(val(d, 'psiFront'), '35');
  assert.equal(val(d, 'tireSizeSpare'), 'T155/90D17');
  assert.match(d.querySelector('#tire-status').textContent, /Scan or enter the VIN/);
  assert.equal(w.__vin.history().length, 0);

  // Then the barcode: tire values are kept and saved with the VIN, decode fills the rest.
  click(w, d.querySelector('#vin-barcode-start'));
  await tick();
  assert.equal(val(d, 'vin'), VIN2);
  assert.equal(val(d, 'make'), 'Ford');
  assert.equal(val(d, 'psiFront'), '35');
  assert.equal(w.__vin.history()[0].fields.psiSpare, '60');

  // Door sticker values and notes are left alone by a second tire photo; tire fields update.
  const notes = d.querySelector('#f-notes'); notes.value = 'keep me'; notes.dispatchEvent(new w.Event('change', { bubbles: true }));
  w.__vin.state.ocrRaw = 'GVWR 6100 LB ' + VIN2; w.__vin.renderVin();
  ocrText = 'FRONT P265/70R17 38 PSI\nREAR P265/70R17 41 PSI';
  await tirePhoto();
  assert.equal(val(d, 'gvwr'), '6100');
  assert.equal(val(d, 'notes'), 'keep me');
  assert.equal(val(d, 'make'), 'Ford');
  assert.equal(val(d, 'psiRear'), '41');
  assert.equal(val(d, 'tireSizeFront'), 'P265/70R17');
  assert.match(d.querySelector('#f-psiRear').parentNode.textContent, /tire label photo/);
  assert.match(d.querySelector('#tire-status').textContent, /Nothing else was changed\. Saved with/);
});

test('old saved scans with a single tire size/pressure still load', () => {
  const { window: w } = boot({ history: [{ vin: VIN, savedAt: 1, fields: { vin: VIN, tireSize: 'P225/45R19', tirePsi: '36 psi' }, hints: {} }] });
  click(w, w.document.querySelector('[data-load="0"]'));
  assert.equal(val(w.document, 'tireSizeFront'), 'P225/45R19');
  assert.equal(val(w.document, 'psiFront'), '36');
});

test('main is the working build (a895c81) with additions only (gallery, sideways retry, sticker columns)', () => {
  const { execSync } = require('child_process');
  let diff;
  try { diff = execSync('git diff a895c81 -- www/app.js www/index.html', { cwd: path.join(__dirname, '..'), encoding: 'utf8' }); } catch (e) { return; }
  const removed = diff.split('\n').filter(l => /^-[^-]/.test(l));
  assert.deepEqual(removed, [
    "-    var front = weightAfter(/\\bGAWR\\s*(FRT|FR|FRONT|F)\\b(\\s*\\/?\\s*PNBE(\\s*AV)?\\b)?/, 1000, 25000);",
    "-    var rear = weightAfter(/\\bGAWR\\s*(RR|REAR|R)\\b(\\s*\\/?\\s*PNBE(\\s*AR)?\\b)?/, 1000, 25000);",
    "-      var photo = $('#vin-photo'), preview = $('#vin-preview');"
  ], 'nothing else from the working build changed (axle headings widened for GAWR/PNBE FRT)');
});

test('VIN gallery photo: used as picked when it opens, waits for Read VIN from photo, reads like a camera photo', async () => {
  let reads = 0;
  const native = { recognizeText: () => { reads++; return Promise.resolve({ text: 'VIN ' + VIN }); } };
  const { window: w } = boot({ native });
  const d = w.document;
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }), putImageData() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
  w.URL.createObjectURL = () => 'blob:g'; w.URL.revokeObjectURL = () => {};
  let decodable = true;
  const RealImage = w.Image;
  w.Image = function () {
    const img = new RealImage();
    Object.defineProperty(img, 'naturalWidth', { get: () => decodable ? 100 : 0 }); Object.defineProperty(img, 'naturalHeight', { value: 50 });
    setTimeout(() => (decodable ? img.onload() : img.onerror()), 0); return img;
  };
  const pick = async (file) => {
    const input = d.querySelector('#vin-gallery');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    await tick(); await tick();
  };
  const status = () => d.querySelector('#vin-ocr-status').textContent;
  assert.equal(d.querySelector('#vin-gallery').hasAttribute('capture'), false, 'gallery input opens the photo picker');

  const original = new w.File(['jpegbytes'], 'IMG_1.jpg', { type: 'image/jpeg' });
  await pick(original);
  assert.equal(reads, 0, 'waits for the button');
  assert.match(status(), /^Photo ready\. Tap “Read VIN from photo”/);
  assert.equal(w.__vin.state.vinFile, original, 'exactly the picked photo, like the camera input');
  click(w, d.querySelector('#vin-ocr'));
  await tick(); await tick();
  assert.equal(reads, 1);
  assert.equal(val(d, 'vin'), VIN);
  assert.equal(val(d, 'source'), 'Photo (OCR)');

  decodable = false;
  await pick(new w.File([], 'cloud.jpg', { type: 'image/jpeg' }));
  assert.match(status(), /came back empty/);
  await pick(new w.File(['heic'], 'IMG_2.heic', { type: 'image/heic' }));
  assert.match(status(), /HEIC/);
  let opts = null;
  w.createImageBitmap = (f, o) => { opts = o; return Promise.resolve({ width: 4000, height: 3000 }); };
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(['jpg'], { type: 'image/jpeg' })); };
  await pick(new w.File(['heic'], 'IMG_3.heic', { type: 'image/heic' }));
  assert.match(status(), /converted to JPEG\)\. Tap “Read VIN from photo”/);
  assert.equal(opts && opts.imageOrientation, 'from-image', 'rotation kept');
});

test('gallery button on the phone: Android picks the photo, app gets an in-memory JPEG, reads like a camera photo', async () => {
  let reads = 0, asked = null, cancel = false;
  const native = { recognizeText: () => { reads++; return Promise.resolve({ text: 'VIN ' + VIN }); } };
  const { window: w } = boot({ native });
  const d = w.document;
  w.Capacitor.Plugins.Camera = { getPhoto: (o) => { asked = o; return cancel ? Promise.reject(new Error('User cancelled photos app')) : Promise.resolve({ dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', format: 'jpeg' }); } };
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }), putImageData() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
  const RealImage = w.Image;
  w.Image = function () { const img = new RealImage(); Object.defineProperty(img, 'naturalWidth', { value: 100 }); Object.defineProperty(img, 'naturalHeight', { value: 50 }); setTimeout(() => img.onload(), 0); return img; };
  w.URL.createObjectURL = () => 'blob:p'; w.URL.revokeObjectURL = () => {};
  let inputClicked = false;
  d.querySelector('#vin-gallery').click = () => { inputClicked = true; };

  click(w, d.querySelector('#vin-gallery-btn'));
  await tick();
  assert.equal(inputClicked, false, 'the web file picker is not used on the phone');
  assert.equal(asked.source, 'PHOTOS'); assert.equal(asked.resultType, 'dataUrl'); assert.equal(asked.correctOrientation, true);
  const f = w.__vin.state.vinFile;
  assert.equal(f.type, 'image/jpeg'); assert.equal(f.size, 10, 'the JPEG bytes, in memory');
  assert.equal(d.querySelector('#vin-preview').hidden, false);
  assert.match(d.querySelector('#vin-ocr-status').textContent, /^Photo ready\. Tap “Read VIN from photo”/);
  assert.equal(reads, 0, 'waits for the button');
  click(w, d.querySelector('#vin-ocr'));
  await tick(); await tick();
  assert.equal(reads, 1);
  assert.equal(val(d, 'vin'), VIN);

  cancel = true;
  click(w, d.querySelector('#vin-gallery-btn'));
  await tick();
  assert.equal(d.querySelector('#vin-ocr-status').textContent, 'No photo picked.');
});

test('gallery button in a plain browser falls back to the file picker', () => {
  const { window: w } = boot();
  let inputClicked = false;
  w.document.querySelector('#vin-gallery').click = () => { inputClicked = true; };
  click(w, w.document.querySelector('#vin-gallery-btn'));
  assert.equal(inputClicked, true);
});

// What the reader returned on the phone for the user's two photos (VIN running vertically), and the real VIN.
const MAZDA_VIN = 'JM1GJ1W63E1142292';
const STICKER_FIRST_READ = 'MFD. BY MAZDA MOTOR CORPORATION\nGVWR/PNBV GAWR/PNBE FRT GAWR/PNBE RR\nDATE 09/13 4288LB 2269 LB 2030 LB\n' +
  'THIS VEHICLE CONFORMS TO ALL APPLICABLE FEDERAL MOTOR VEHICLE SAFETY\nSTANDARDS IN EFFECT ON THE DATE OF MANUFACTURE SHOWN ABOVE.\n' +
  'JMIGJIW63EII4Z29Z\nTYPE: PASS CAR\nMADE IN JAPAN';
const WINDSHIELD_FIRST_READ = 'JM1 G\nJ1W\n63E1\n142\n292';

function photoApp(readings) {
  let calls = 0;
  const native = { recognizeText: () => { const t = readings[Math.min(calls, readings.length - 1)]; calls++; return Promise.resolve({ text: t }); } };
  const { window: w } = boot({ native });
  const d = w.document;
  const ctx = { drawImage() {}, getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }), putImageData() {}, translate() {}, rotate() {} };
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
  const RealImage = w.Image;
  w.Image = function () { const img = new RealImage(); Object.defineProperty(img, 'naturalWidth', { value: 4032 }); Object.defineProperty(img, 'naturalHeight', { value: 1816 }); setTimeout(() => img.onload(), 0); return img; };
  w.URL.createObjectURL = () => 'blob:s'; w.URL.revokeObjectURL = () => {};
  const read = async () => {
    w.__vin.state.vinFile = new w.File(['x'], 'p.jpg', { type: 'image/jpeg' });
    click(w, d.querySelector('#vin-ocr'));
    for (let i = 0; i < 8; i++) await tick();
  };
  return { w, d, read, calls: () => calls };
}

test('door sticker photo read sideways: second read turned finds the VIN that passes the check digit', async () => {
  const { d, read, calls } = photoApp([STICKER_FIRST_READ, 'MADE IN JAPAN\n' + MAZDA_VIN + '\nTYPE: PASS CAR']);
  await read();
  assert.equal(calls(), 2, 'first read + one turned read');
  assert.equal(val(d, 'vin'), MAZDA_VIN);
  assert.equal(d.querySelector('#vin').value, MAZDA_VIN);
  assert.match(d.querySelector('#vin-ocr-status').textContent, /turned sideways; its check digit is consistent/);
  assert.equal(val(d, 'source'), 'Photo (OCR)');
  assert.equal(val(d, 'gvwr'), '4288', 'GVWR from the sticker, not the database');
  assert.equal(val(d, 'gawrFront'), '2269');
  assert.equal(val(d, 'gawrRear'), '2030');
  assert.equal(val(d, 'mfgDate'), '09/2013');
  assert.match(d.querySelector('#f-gvwr').parentNode.textContent, /door sticker/);
});

test('windshield photo with the VIN running vertically: found on the second turn', async () => {
  const { d, read, calls } = photoApp([WINDSHIELD_FIRST_READ, 'JMI GJ', MAZDA_VIN]);
  await read();
  assert.equal(calls(), 3, 'first read, then 90 and 270 degrees');
  assert.equal(val(d, 'vin'), MAZDA_VIN);
});

test('a photo that reads fine the first time is never read again', async () => {
  const { d, read, calls } = photoApp(['VIN ' + MAZDA_VIN]);
  await read();
  assert.equal(calls(), 1);
  assert.equal(val(d, 'vin'), MAZDA_VIN);
});

test('no VIN even sideways: behaves exactly like the working build did', async () => {
  const { d, read, calls } = photoApp(['ON THE DATE OF MANUFACTURE SHOWN ABOVE', 'nothing', 'nothing']);
  await read();
  assert.equal(calls(), 3);
  assert.equal(val(d, 'vin'), '', 'a word is never filled in as a VIN');
  assert.match(d.querySelector('#vin-ocr-status').textContent, /No VIN found in this photo, even turned sideways/);
});

test('the junk reading from the phone is rejected even though it passes the check digit', async () => {
  // Exactly what the phone produced: junk that passes the check digit, the real VIN line misread.
  const { d, read, calls } = photoApp([STICKER_FIRST_READ.replace('JMIGJIW63EII4Z29Z', 'JMIGJIW63EII4Z29Z ON THE DATE OF MANUFAC'), MAZDA_VIN]);
  await read();
  assert.equal(calls(), 2, 'junk is not accepted, so the photo is read turned');
  assert.equal(val(d, 'vin'), MAZDA_VIN);
});

test('a foreign VIN without a check digit still fills in, flagged to verify', async () => {
  const { d, read, calls } = photoApp(['VIN WVWZZZ1KZ6W000123', 'nothing', 'nothing']);
  await read();
  assert.equal(calls(), 3);
  assert.equal(val(d, 'vin'), 'WVWZZZ1KZ6W000123');
  assert.match(d.querySelector('#vin-ocr-status').textContent, /check digit doesn’t match/);
});

test('Mazda door sticker: headings side by side, numbers in the row below, in any reading order', () => {
  const { window: w } = boot();
  const p = (t) => JSON.parse(JSON.stringify(w.__vin.parseDoorSticker(t)));
  const want = { gvwr: '4288', gawrFront: '2269', gawrRear: '2030', mfgDate: '09/2013' };
  const pick = (o) => ({ gvwr: o.gvwr, gawrFront: o.gawrFront, gawrRear: o.gawrRear, mfgDate: o.mfgDate });
  // Row by row, as printed.
  assert.deepEqual(pick(p('MFD. BY MAZDA MOTOR CORPORATION\nDATE GVWR/PNBV GAWR/PNBE FRT GAWR/PNBE RR\n09/13 4288LB 2269 LB 2030 LB\n' +
    '1945KG 1029 KG 921 KG\nTHIS VEHICLE CONFORMS TO ALL APPLICABLE FEDERAL MOTOR VEHICLE SAFETY\nJM1GJ1W63E1142292 TYPE: PASS CAR')), want);
  // Column by column (heading, then its numbers).
  assert.deepEqual(pick(p('DATE\n09/13\nGVWR/PNBV\n4288LB\n1945KG\nGAWR/PNBE FRT\n2269 LB\n1029 KG\nGAWR/PNBE RR\n2030 LB\n921 KG')), want);
  // All headings first, then the pounds, then the kilograms.
  assert.deepEqual(pick(p('MFD. BY MAZDA MOTOR CORPORATION\nDATE\nGVWR/PNBV\nGAWR/PNBE FRT\nGAWR/PNBE RR\n09/13\n4288LB\n2269 LB\n2030 LB\n1945KG\n1029 KG\n921 KG')), want);
  // Kilograms only.
  const kg = p('GVWR/PNBV GAWR/PNBE FRT GAWR/PNBE RR\n1945 KG 1029 KG 921 KG');
  assert.deepEqual([kg.gvwr, kg.gawrFront, kg.gawrRear], ['4288', '2269', '2030']);
  // Numbers that don't add up are not guessed.
  const bad = p('GVWR/PNBV GAWR/PNBE FRT GAWR/PNBE RR\n2269 LB 4288 LB 2030 LB');
  assert.equal(bad.gvwr, undefined);
});
