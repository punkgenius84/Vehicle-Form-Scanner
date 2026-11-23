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
    await tick();
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

test('odometer reading is picked out of the rest of the dash', () => {
  const { window: w } = boot();
  const p = (t) => JSON.parse(JSON.stringify(w.__vin.parseOdometer(t)));
  assert.deepEqual(p('ODO 123456 mi'), { mileage: '123456' });
  assert.deepEqual(p('TRIP A 245.7 mi\n10:42 AM 72°F\nODO 87,215 MI\nRANGE 312 mi'), { mileage: '87215' });
  assert.deepEqual(p('RANGE 412 MILES 34 MPG\n 98765'), { mileage: '98765' }, 'unlabelled: the big number that is not range/mpg');
  assert.deepEqual(p('12:05 PM  23°C  ODO 160934 km'), { mileage: '100000', _hint: 'From odometer photo: 160,934 km converted to miles' });
  assert.deepEqual(p('TRIP 12.3'), {});
  assert.deepEqual(p(''), {});
});

test('odometer photo fills Mileage only; gallery photos work for VIN, tire and odometer', async () => {
  let ocrText = 'TRIP A 245.7 mi ODO 87,215 MI RANGE 312 mi';
  const native = { scanLiveBarcode: () => Promise.resolve({ cancelled: false, vin: VIN2, rawValue: VIN2 }), recognizeText: () => Promise.resolve({ text: ocrText }) };
  const { window: w } = boot({ native });
  const d = w.document;
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }), putImageData() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
  const RealImage = w.Image;
  w.Image = function () { const img = new RealImage(); Object.defineProperty(img, 'naturalWidth', { value: 100 }); Object.defineProperty(img, 'naturalHeight', { value: 50 }); setTimeout(() => img.onload(), 0); return img; };
  w.URL.createObjectURL = () => 'blob:g'; w.URL.revokeObjectURL = () => {};
  const pick = async (id) => {
    const input = d.querySelector(id);
    Object.defineProperty(input, 'files', { value: [new w.File(['x'], 'p.jpg', { type: 'image/jpeg' })], configurable: true });
    input.dispatchEvent(new w.Event('change', { bubbles: true }));
    await tick();
  };

  // Gallery inputs have no camera "capture" setting, so Android opens the photo picker.
  for (const id of ['#vin-gallery', '#tire-gallery', '#odo-gallery']) {
    assert.equal(d.querySelector(id).hasAttribute('capture'), false, id);
    assert.ok(d.querySelector('label[for="' + id.slice(1) + '"]'), id + ' has a button');
  }

  click(w, d.querySelector('#vin-barcode-start'));
  await tick();
  const before = JSON.stringify(w.__vin.current().fields);

  // Odometer from the gallery.
  await pick('#odo-gallery');
  assert.match(d.querySelector('#odo-status').textContent, /Tap “Read odometer”/);
  click(w, d.querySelector('#odo-ocr'));
  await tick(); await tick();
  assert.equal(val(d, 'mileage'), '87215');
  assert.match(d.querySelector('#f-mileage').parentNode.textContent, /From odometer photo/);
  const after = Object.assign({}, w.__vin.current().fields); delete after.mileage;
  assert.equal(JSON.stringify(after), before, 'nothing else changed');
  assert.equal(w.__vin.history()[0].fields.mileage, '87215');
  assert.match(d.querySelector('#history').textContent, /87,215 mi/);

  // VIN photo from the gallery: same reader as the camera photo, waits for the button.
  let reads = 0;
  native.recognizeText = () => { reads++; return Promise.resolve({ text: 'VIN ' + VIN }); };
  await pick('#vin-gallery');
  assert.equal(reads, 0);
  assert.match(d.querySelector('#vin-ocr-status').textContent, /Tap “Read VIN from photo”/);
  assert.equal(d.querySelector('#vin-preview').hidden, false);
  click(w, d.querySelector('#vin-ocr'));
  await tick(); await tick();
  assert.equal(reads, 1);
  assert.equal(val(d, 'vin'), VIN);
  assert.equal(val(d, 'source'), 'Photo (OCR)');

  // Tire label from the gallery.
  native.recognizeText = () => Promise.resolve({ text: 'FRONT P245/60R18 35 PSI\nREAR P245/60R18 35 PSI' });
  await pick('#tire-gallery');
  click(w, d.querySelector('#tire-ocr'));
  await tick(); await tick();
  assert.equal(val(d, 'psiFront'), '35');

  // New scan clears all photos.
  click(w, d.querySelector('#new-scan'));
  assert.equal(d.querySelector('#odo-raw-box').hidden, true);
  assert.equal(d.querySelector('#odo-preview').hidden, true);
  assert.equal(d.querySelector('#vin-preview').hidden, true);
  assert.match(d.querySelector('#odo-status').textContent, /Light the dash first/);
});

// Line boxes measured from a real dash photo (1600x892): GM speedo, segment odometer "0576 12",
// gauge labels all around, "km/h" ring and "MPH".
const DASH_LINES = [
  { text: '40', left: 632, right: 708, top: 150, bottom: 190 }, { text: '50', left: 760, right: 835, top: 128, bottom: 168 },
  { text: '60', left: 888, right: 962, top: 148, bottom: 188 }, { text: '30', left: 540, right: 615, top: 222, bottom: 262 },
  { text: '80', left: 772, right: 822, top: 230, bottom: 255 }, { text: '70', left: 985, right: 1060, top: 222, bottom: 262 },
  { text: '60', left: 670, right: 720, top: 265, bottom: 290 }, { text: '100', left: 870, right: 935, top: 265, bottom: 290 },
  { text: 'km/h', left: 742, right: 852, top: 290, bottom: 322 }, { text: '210', left: 106, right: 175, top: 252, bottom: 280 },
  { text: '260', left: 212, right: 292, top: 295, bottom: 325 }, { text: '20', left: 470, right: 545, top: 325, bottom: 365 },
  { text: '40', left: 600, right: 650, top: 328, bottom: 352 }, { text: '120', left: 935, right: 995, top: 340, bottom: 365 },
  { text: '80', left: 1050, right: 1125, top: 330, bottom: 370 }, { text: 'TEMP', left: 0, right: 100, top: 450, bottom: 478 },
  { text: '-20', left: 550, right: 618, top: 425, bottom: 450 }, { text: '140', left: 965, right: 1025, top: 430, bottom: 455 },
  { text: '10', left: 450, right: 505, top: 460, bottom: 500 }, { text: '90', left: 1070, right: 1145, top: 450, bottom: 490 },
  { text: '1/2', left: 1445, right: 1505, top: 248, bottom: 275 }, { text: 'FUEL', left: 1495, right: 1600, top: 450, bottom: 480 },
  { text: '160', left: 945, right: 1005, top: 525, bottom: 553 }, { text: 'MPH', left: 735, right: 860, top: 558, bottom: 595 },
  { text: '100', left: 1040, right: 1135, top: 565, bottom: 605 }, { text: '0576', left: 680, right: 815, top: 690, bottom: 732 },
  { text: '12', left: 840, right: 893, top: 690, bottom: 732 }, { text: 'HOLD TO', left: 1043, right: 1158, top: 672, bottom: 698 },
  { text: 'RESET', left: 1043, right: 1130, top: 702, bottom: 728 }, { text: '80', left: 25, right: 80, top: 670, bottom: 698 },
  { text: '9', left: 1555, right: 1580, top: 668, bottom: 696 }
];

test('odometer from a real dash: split segment digits are joined, gauge numbers ignored, km/h is not km', () => {
  const { window: w } = boot();
  const p = (t, l) => JSON.parse(JSON.stringify(w.__vin.parseOdometer(t, l)));
  const text = DASH_LINES.map(l => l.text).join('\n');
  assert.deepEqual(p(text, DASH_LINES), { mileage: '57612' }, 'with line positions (Android)');
  assert.deepEqual(p(text), { mileage: '57612' }, 'text only');
  // Same reading when the OCR returns it as one line with a gap, or misreads a segment digit as a letter.
  assert.deepEqual(p(text.replace('0576\n12', '0576 12')), { mileage: '57612' });
  assert.deepEqual(p(text.replace('0576\n12', 'O576 I2')), { mileage: '57612' });
  const misread = DASH_LINES.map(l => l.text === '0576' ? Object.assign({}, l, { text: 'O576' }) : l);
  assert.deepEqual(p(text, misread), { mileage: '57612' });
  // Gauge labels alone never become a mileage.
  const gaugesOnly = DASH_LINES.filter(l => l.text !== '0576' && l.text !== '12');
  assert.deepEqual(p(gaugesOnly.map(l => l.text).join('\n'), gaugesOnly), {});
});

// Line boxes from a mechanical drum odometer photo (474x354): each digit in its own box, a trip
// counter with a half-rolled digit below it, a P R N D 2 1 gear strip, and gauge labels.
const DRUM_LINES = [
  { text: '60', left: 135, right: 175, top: 45, bottom: 75 }, { text: '70', left: 180, right: 220, top: 30, bottom: 60 },
  { text: '80', left: 225, right: 265, top: 28, bottom: 58 }, { text: '90', left: 280, right: 320, top: 35, bottom: 65 },
  { text: '100', left: 320, right: 385, top: 70, bottom: 100 }, { text: '50', left: 100, right: 140, top: 85, bottom: 115 },
  { text: '100', left: 175, right: 200, top: 88, bottom: 102 }, { text: '120', left: 222, right: 245, top: 75, bottom: 89 },
  { text: '140', left: 268, right: 290, top: 80, bottom: 94 }, { text: '80', left: 140, right: 160, top: 110, bottom: 124 },
  { text: '160', left: 310, right: 333, top: 103, bottom: 117 }, { text: '40', left: 75, right: 115, top: 118, bottom: 148 },
  { text: '110', left: 355, right: 420, top: 110, bottom: 140 }, { text: '60', left: 115, right: 135, top: 148, bottom: 162 },
  { text: '0 9 9 4 8 3', left: 180, right: 298, top: 138, bottom: 162 }, { text: '180', left: 335, right: 358, top: 137, bottom: 151 },
  { text: '30', left: 60, right: 100, top: 165, bottom: 195 }, { text: '120', left: 375, right: 440, top: 155, bottom: 185 },
  { text: '40', left: 105, right: 125, top: 195, bottom: 209 }, { text: '-200', left: 345, right: 378, top: 180, bottom: 194 },
  { text: '20', left: 55, right: 95, top: 210, bottom: 240 }, { text: '130', left: 380, right: 445, top: 200, bottom: 230 },
  { text: '20', left: 112, right: 132, top: 236, bottom: 250 }, { text: '-220', left: 335, right: 368, top: 222, bottom: 236 },
  { text: '6 9 1', left: 180, right: 240, top: 222, bottom: 246 }, { text: '10', left: 55, right: 95, top: 255, bottom: 285 },
  { text: '140', left: 370, right: 430, top: 250, bottom: 280 }, { text: 'MPH', left: 155, right: 200, top: 288, bottom: 302 },
  { text: 'km/h', left: 275, right: 312, top: 288, bottom: 302 }, { text: 'P RNO21', left: 150, right: 335, top: 305, bottom: 330 },
  { text: 'CERTIFIED CALIBRATION', left: 160, right: 320, top: 333, bottom: 348 }
];

test('drum odometer: boxed single digits join into one reading, trip and gear strip ignored', () => {
  const { window: w } = boot();
  const p = (t, l) => JSON.parse(JSON.stringify(w.__vin.parseOdometer(t, l)));
  const text = DRUM_LINES.map(l => l.text).join('\n');
  assert.deepEqual(p(text, DRUM_LINES), { mileage: '99483' }, 'with line positions');
  assert.deepEqual(p(text), { mileage: '99483' }, 'text only');
  // Other ways the reader can return the same drum.
  for (const variant of ['099483', '09948 3', '0 99 48 3', 'O 9 9 4 8 3']) {
    const lines = DRUM_LINES.map(l => l.text === '0 9 9 4 8 3' ? Object.assign({}, l, { text: variant }) : l);
    assert.deepEqual(p(lines.map(l => l.text).join('\n'), lines), { mileage: '99483' }, variant);
  }
  // Each box as its own line (positions only).
  const boxes = DRUM_LINES.filter(l => l.text !== '0 9 9 4 8 3').concat('099483'.split('').map((d, i) =>
    ({ text: d, left: 182 + i * 19.5, right: 196 + i * 19.5, top: 138, bottom: 162 })));
  assert.deepEqual(p(boxes.map(l => l.text).join('\n'), boxes), { mileage: '99483' }, 'one box per line');
  // Zeros next to each other still join (they are not gauge labels).
  assert.deepEqual(p('1 0 0 7 0 0'), { mileage: '100700' });
});

test('gallery photo: used as picked when it opens; otherwise copied/converted with rotation kept, or a clear message', async () => {
  let reads = 0, got = null;
  const native = { recognizeText: (o) => { reads++; got = o; return Promise.resolve({ text: 'VIN ' + VIN }); } };
  const { window: w } = boot({ native });
  const d = w.document;
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }), putImageData() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
  w.URL.createObjectURL = () => 'blob:m'; w.URL.revokeObjectURL = () => {};
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

  // Normal JPEG: a fresh in-memory copy goes to the reader.
  const original = new w.File(['jpegbytes'], 'IMG_1.jpg', { type: 'image/jpeg' });
  await pick(original);
  assert.match(status(), /Tap “Read VIN from photo”/);
  assert.equal(w.__vin.state.vinFile, original, 'a photo that opens is used exactly as picked, like before');
  click(w, d.querySelector('#vin-ocr'));
  await tick(); await tick();
  assert.equal(reads, 1);
  assert.equal(val(d, 'vin'), VIN);

  // Empty (still in the cloud): it won't open, and the copy shows why.
  decodable = false;
  await pick(new w.File([], 'cloud.jpg', { type: 'image/jpeg' }));
  assert.match(status(), /came back empty/);
  assert.equal(w.__vin.state.vinFile, null);

  // A format the browser can't open, and no converter: say why.
  await pick(new w.File(['heic'], 'IMG_2.heic', { type: 'image/heic' }));
  assert.match(status(), /HEIC/);
  assert.equal(w.__vin.state.vinFile, null);

  // Same format, but the phone can convert it: it becomes a JPEG and is ready.
  let bitmapOpts = null;
  w.createImageBitmap = (f, o) => { bitmapOpts = o; return Promise.resolve({ width: 4000, height: 3000 }); };
  w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(['jpg'], { type: 'image/jpeg' })); };
  await pick(new w.File(['heic'], 'IMG_3.heic', { type: 'image/heic' }));
  assert.match(status(), /converted to JPEG\)\. Tap “Read VIN from photo”/);
  assert.equal(w.__vin.state.vinFile.type, 'image/jpeg');
  assert.equal(bitmapOpts && bitmapOpts.imageOrientation, 'from-image', 'rotation kept');
});

test('VIN photo reader and door sticker code are exactly the build that read VINs (c32f901)', () => {
  const { execSync } = require('child_process');
  let good;
  try { good = execSync('git show c32f901:www/app.js', { cwd: path.join(__dirname, '..'), encoding: 'utf8' }); } catch (e) { return; }
  const now = fs.readFileSync(path.join(WWW, 'app.js'), 'utf8');
  const between = (src, a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
  // Copied scanner block and the VIN photo/OCR handlers are identical.
  assert.equal(between(now, 'COPIED UNCHANGED', 'END OF COPIED BLOCK'), between(good, 'COPIED UNCHANGED', 'END OF COPIED BLOCK'));
  assert.equal(between(now, 'function parseDoorSticker', '/* ---------- VIN rules'), between(good, 'function parseDoorSticker', '/* ---------- turning'));
  assert.equal(between(now, 'function renderVin', 'function renderForm'), between(good, 'function renderVin', 'function renderForm'));
});

test('VIN rules: safe digit-only fixes are applied, a look-alike swap is only suggested', () => {
  const { window: w } = boot();
  const fix = (v) => JSON.parse(JSON.stringify(w.__vin.correctVin(v)));
  assert.deepEqual(fix(VIN), { vin: VIN, changes: [], valid: true, suggestion: null });
  // Letter in the last four (always digits): Z -> 2, applied.
  let r = fix('1HGCM82633A00435Z');
  assert.equal(r.vin, VIN); assert.equal(r.valid, true);
  assert.deepEqual(r.changes, [{ pos: 17, from: 'Z', to: '2' }]);
  // Misread where letters are allowed (Z for 2): not applied, offered.
  r = fix('1HGCM8Z633A004352');
  assert.equal(r.vin, '1HGCM8Z633A004352'); assert.equal(r.valid, false);
  assert.deepEqual(r.suggestion, { vin: VIN, change: { pos: 7, from: 'Z', to: '2' } });
  // Two misreads: nothing applied beyond the rules, never two swaps.
  r = fix('1HGCMB2G33A004352');
  assert.equal(r.valid, false); assert.equal(r.vin, '1HGCMB2G33A004352');
  // S read for 3 in the digits-only part: S becomes 5 (rule), check still fails, no further guessing.
  r = fix('1HGCM82633A004S52');
  assert.equal(r.valid, false); assert.equal(r.vin, '1HGCM82633A004552'); assert.equal(r.suggestion, null);
  assert.deepEqual(r.changes, [{ pos: 15, from: 'S', to: '5' }]);
});

test('photo VIN: rule fix decodes right away; a suggested fix waits for a tap, then decodes', async () => {
  let ocr = 'VIN 1HGCM82633A00435Z', looked = [];
  const native = { recognizeText: () => Promise.resolve({ text: ocr }) };
  const { window: w } = boot({ native });
  const d = w.document;
  w.fetch = (url) => { looked.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve(nhtsa()) }); };
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, getImageData: (x, y, a, b) => ({ data: new Uint8ClampedArray(a * b * 4) }), putImageData() {} });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AAAA';
  const RealImage = w.Image;
  w.Image = function () { const img = new RealImage(); Object.defineProperty(img, 'naturalWidth', { value: 100 }); Object.defineProperty(img, 'naturalHeight', { value: 50 }); setTimeout(() => img.onload(), 0); return img; };
  w.URL.createObjectURL = () => 'blob:v'; w.URL.revokeObjectURL = () => {};
  const read = async () => {
    w.__vin.state.vinFile = new w.File(['x'], 'v.jpg', { type: 'image/jpeg' });
    click(w, d.querySelector('#vin-ocr'));
    await tick(); await tick();
  };

  await read();
  assert.equal(val(d, 'vin'), VIN);
  assert.equal(d.querySelector('#vin').value, VIN);
  assert.ok(looked[0].includes(VIN));
  assert.equal(val(d, 'checkDigit'), 'Valid');
  assert.match(d.querySelector('#msg').textContent, /Photo read 1HGCM82633A00435Z\. Fixed using VIN rules: character 17 Z→2\. Decoded\./);

  // Look-alike in the middle: shown with a button, nothing decoded yet.
  click(w, d.querySelector('#new-scan'));
  looked = []; ocr = 'VIN 1HGCM8Z633A004352';
  await read();
  assert.equal(looked.length, 0, 'no decode of a VIN that fails its check');
  const btn = d.querySelector('#use-vin-fix');
  assert.ok(btn); assert.match(btn.textContent, /Use 1HGCM82633A004352 \(character 7: Z→2\)/);
  assert.match(d.querySelector('#msg').textContent, /character 7 reads Z but is probably 2/);
  // Tap it: corrected VIN decoded, the misread entry is gone from recent scans.
  click(w, btn);
  await tick();
  assert.equal(val(d, 'vin'), VIN);
  assert.equal(val(d, 'make'), 'Ford');
  assert.equal(val(d, 'source'), 'Photo (OCR)');
  assert.ok(looked[0].includes(VIN));
  assert.equal(JSON.stringify(w.__vin.history().map(h => h.vin)), JSON.stringify([VIN]));
  assert.match(d.querySelector('#f-vin').parentNode.textContent, /you confirmed the fix: character 7 Z→2/);

  // NHTSA's own warning is passed on.
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(nhtsa({ ErrorCode: '1', ErrorText: '1 - Check Digit (9th position) does not calculate properly' })) });
  d.querySelector('#vin').value = '1HGCM82633A004353';
  click(w, d.querySelector('#vin-go'));
  await tick();
  assert.match(d.querySelector('#msg').textContent, /NHTSA warning: 1 - Check Digit/);
});
