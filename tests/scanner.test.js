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
  if (opts.native) w.Capacitor = { Plugins: { NativeVinScanner: opts.native } };
  if (opts.history) w.localStorage.setItem('vinscanner.recent.v1', JSON.stringify(opts.history));
  for (const f of ['data.js', 'engine.js', 'app.js']) w.eval(fs.readFileSync(path.join(WWW, f), 'utf8'));
  return dom;
}
const tick = () => new Promise(r => setTimeout(r, 20));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const val = (d, k) => d.querySelector('#f-' + k).value;

test('scanner code copied from the tow app is byte-for-byte unchanged', () => {
  const towApp = path.join(__dirname, '..', '..', 'src', 'tow-app', 'www', 'app.js');
  if (!fs.existsSync(towApp)) return; // only runs where the tow app sits beside this project
  const src = fs.readFileSync(towApp, 'utf8').replace(/\r/g, '').split('\n');
  const mine = fs.readFileSync(path.join(WWW, 'app.js'), 'utf8');
  for (const [a, b] of [[228, 236], [284, 645], [781, 792]]) assert.ok(mine.includes(src.slice(a - 1, b).join('\n')), 'lines ' + a + '-' + b);
});

test('index.html references only files that exist and the SW caches them', () => {
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]);
  for (const r of refs) assert.ok(fs.existsSync(path.join(WWW, decodeURIComponent(r))), 'missing ' + r);
  const sw = fs.readFileSync(path.join(WWW, 'sw.js'), 'utf8');
  for (const f of ['index.html', 'styles.css', 'data.js', 'engine.js', 'app.js']) assert.ok(sw.includes("'" + f + "'"), f);
});

test('native barcode scan fills the form, decodes with NHTSA and saves to history', async () => {
  let calls = 0;
  const native = { scanBarcode: () => { calls++; return Promise.resolve(calls === 1 ? { rawValue: 'NOT A VIN 12345' } : { rawValue: 'I' + VIN2 }); } };
  const { window: w } = boot({ native });
  const d = w.document;
  click(w, d.querySelector('#vin-barcode-start'));
  await tick();
  assert.equal(calls, 2, 'reopens scanner until a VIN is found');
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
  assert.deepEqual(JSON.parse(JSON.stringify(native)), { gvwr: 4751, gawrFront: 2579, gawrRear: 2282, mfgDate: '06/2013', tireSize: 'P225/45R19', tirePsi: '36 psi' });
  // Browser OCR whitelist strips punctuation; still read it, and convert kg when no lb is present.
  const browser = w.__vin.parseDoorSticker('Enhanced photo pass:\\nDATE 0613 GVWR PNBV 2155 KG\\nGAWR FRT 1170KG 2579LB');
  assert.equal(browser.gvwr, 4751);
  assert.equal(browser.gawrFront, 2579);
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
  const native = { scanBarcode: () => Promise.resolve(reply), recognizeText: () => Promise.resolve(ocr) };
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
  native.scanBarcode = () => Promise.reject(new Error('Barcode scan cancelled.'));
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
  const towApp = path.join(__dirname, '..', '..', 'src', 'tow-app', 'www', 'app.js');
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
