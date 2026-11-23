/* VIN Scanner UI. Vanilla JS, no build step.
 *
 * The scanning code in the block marked "COPIED UNCHANGED" below comes line-for-line from the tow app:
 *  - photo/OCR and VIN helpers: the Tow-App build that is proven on the phone (www/app.js lines 228-236, 284-388,
 *    487-645, 781-792), left exactly as they were because photo VIN reading works;
 *  - startBarcodeScan: current Tow-App main @ ba33f3a (www/app.js lines 501-607), which opens the native CameraX
 *    scanner (scanLiveBarcode). One line differs, marked "VIN SCANNER CHANGE": the VIN the native scanner has
 *    already validated (result.vin) is used first.
 * Do not edit that block here; fix it in the tow app and copy it again.
 * Everything outside that block is new: it takes the VIN the scanner puts in state.vinText, decodes it
 * with NHTSA, reads extra data from a door-sticker photo, fills the form and keeps the last 6 scans.
 */
(function () {
  'use strict';

  var E = window.TowEngine;
  var D = window.TowData;
  var HISTORY_KEY = 'vinscanner.recent.v1';
  var HISTORY_MAX = 6;

  // Same state shape the copied scanner functions expect.
  var state = { vinText: '', ocrRaw: '', vinFile: null, vinPreviewUrl: '', ocrStatus: '', ocrLoader: null, ocrWorker: null, barcodeStatus: '', barcodeScanning: false, barcodeControls: null, barcodeLoader: null };

  /* ---------- helpers (same as tow app) ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ================= COPIED UNCHANGED FROM tow-app/www/app.js ================= */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    fallbackCopy(text);
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function normalizeVinCandidate(raw) {
    var value = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (value.length !== 17) return '';
    // OCR commonly confuses these characters. Apply only unambiguous VIN rules;
    // never guess between other letters and digits.
    value = value.replace(/O/g, '0').replace(/[IQ]/g, '1');
    return /^[A-HJ-NPR-Z0-9]{17}$/.test(value) ? value : '';
  }

  function vinCheckDigitValid(vin) {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
    var translit = { A:1, B:2, C:3, D:4, E:5, F:6, G:7, H:8, J:1, K:2, L:3, M:4, N:5, P:7, R:9,
      S:2, T:3, U:4, V:5, W:6, X:7, Y:8, Z:9 };
    var weights = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2], sum = 0;
    for (var i = 0; i < 17; i++) sum += (/[0-9]/.test(vin[i]) ? Number(vin[i]) : translit[vin[i]]) * weights[i];
    var check = sum % 11;
    return vin[8] === (check === 10 ? 'X' : String(check));
  }

  function extractVinCandidates(text) {
    var found = [], lines = String(text || '').toUpperCase().split(/\r?\n/);
    function addCandidate(raw) {
      var candidate = normalizeVinCandidate(raw);
      if (candidate && found.indexOf(candidate) === -1) found.push(candidate);
    }
    lines.forEach(function (line) {
      var labelled = line.match(/\bVIN\b\s*[:#-]?\s*([A-Z0-9][A-Z0-9\s-]{15,24})/);
      if (labelled) {
        var labelledCompact = labelled[1].replace(/[^A-Z0-9]/g, '');
        if (labelledCompact.length >= 17) {
          addCandidate(labelledCompact.slice(0, 17));
          return; // Do not create false candidates from the "VIN" label itself.
        }
      }
      var compact = line.replace(/[^A-Z0-9]/g, '');
      for (var i = 0; i <= compact.length - 17; i++) addCandidate(compact.slice(i, i + 17));
    });
    // Put candidates passing the North American check digit first, without
    // discarding valid international VINs that do not use that checksum.
    return found.sort(function (a, b) { return Number(vinCheckDigitValid(b)) - Number(vinCheckDigitValid(a)); });
  }

  // Barcode payloads are machine-exact, so no OCR-style character swaps here. A VIN never contains I, O or Q.
  function strictBarcodeVin(v) {
    return /^[A-HJ-NPR-Z0-9]{17}$/.test(v) && /[0-9]/.test(v) ? v : '';
  }

  function extractBarcodeVin(raw) {
    // Split on anything that is not A-Z/0-9 (spaces, GS/RS separators, punctuation, "*" start/stop) so a VIN is
    // never stitched together from two neighbouring fields of a Data Matrix or PDF417 payload.
    var tokens = String(raw || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    var exact = [], loose = [];
    function add(list, v) { if (v && list.indexOf(v) === -1) list.push(v); }
    tokens.forEach(function (t) {
      if (t.length === 17) add(exact, strictBarcodeVin(t));
      else if (t.length === 18 && t.charAt(0) === 'I') add(exact, strictBarcodeVin(t.slice(1)));   // leading "I" prefix on some door labels
      else if (t.length === 20 && t.indexOf('VIN') === 0) add(exact, strictBarcodeVin(t.slice(3))); // "VIN" label glued to the value
      else if (t.length > 17) for (var i = 0; i <= t.length - 17; i++) add(loose, strictBarcodeVin(t.slice(i, i + 17)));
    });
    var all = exact.concat(loose);
    for (var k = 0; k < all.length; k++) if (vinCheckDigitValid(all[k])) return all[k];
    return all[0] || '';
  }

  function loadBarcodeEngine() {
    if (window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader) return Promise.resolve(window.ZXingBrowser);
    if (state.barcodeLoader) return state.barcodeLoader;
    state.barcodeLoader = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js';
      script.async = true;
      script.onload = function () {
        if (window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader) resolve(window.ZXingBrowser);
        else reject(new Error('Barcode scanner loaded, but its reader API was unavailable. Reload the app and try again.'));
      };
      script.onerror = function () { reject(new Error('Could not download the barcode scanner. Check your internet connection and try again.')); };
      document.head.appendChild(script);
    }).catch(function (err) {
      state.barcodeLoader = null;
      throw err;
    });
    return state.barcodeLoader;
  }

  function stopBarcodeScanner() {
    if (state.barcodeControls && state.barcodeControls.stop) {
      try { state.barcodeControls.stop(); } catch (e) { /* camera may already be closed */ }
    }
    state.barcodeControls = null;
    state.barcodeScanning = false;
  }

  var nativeVinScannerProxy = null;
  function nativeVinScanner() {
    if (nativeVinScannerProxy) return nativeVinScannerProxy;
    var cap = window.Capacitor;
    if (!cap) return null;
    // On Android the bridge injects every registered plugin as Capacitor.Plugins.<Name>. Capacitor.registerPlugin()
    // only exists when the Capacitor core runtime is loaded, and this page is plain (unbundled) JavaScript, so it
    // must not be the only way in. Without this the app silently used the browser scanners instead of ML Kit.
    if (cap.Plugins && cap.Plugins.NativeVinScanner) nativeVinScannerProxy = cap.Plugins.NativeVinScanner;
    else if (typeof cap.registerPlugin === 'function') nativeVinScannerProxy = cap.registerPlugin('NativeVinScanner');
    return nativeVinScannerProxy;
  }

  function startBarcodeScan() {
    var video = $('#vin-barcode-video'), status = $('#vin-barcode-status'), button = $('#vin-barcode-start');
    if (!video) return;
    if (state.barcodeScanning) return;
    var cap = window.Capacitor;
    var nativeScanner = nativeVinScanner();

    // Android uses a dedicated CameraX activity with ML Kit. The browser ZXing
    // path remains as a fallback for non-Android browsers and older builds.
    if (cap && typeof cap.getPlatform === 'function' && cap.getPlatform() === 'android' &&
        nativeScanner && typeof nativeScanner.scanLiveBarcode === 'function') {
      state.barcodeScanning = true;
      if (button) button.disabled = true;
      if (status) status.textContent = 'Opening the native Android camera…';
      nativeScanner.scanLiveBarcode().then(function (result) {
        state.barcodeScanning = false;
        if (result && result.cancelled) {
          state.barcodeStatus = result.permissionDenied
            ? 'Camera permission was denied. Allow camera access in Android settings, then try again.'
            : 'Barcode scan cancelled. You can try again or use photo OCR.';
        } else {
          // VIN SCANNER CHANGE: use the VIN the native scanner already validated (seen twice), then the raw payload.
          var payload = result && (result.vin || result.rawValue || result.displayValue) || '';
          var vin = extractBarcodeVin(payload);
          if (vin) {
            state.vinText = vin;
            state.vin = null;
            state.vinMsg = '';
            var format = result && result.format ? ' (' + result.format + ')' : '';
            state.barcodeStatus = vinCheckDigitValid(vin)
              ? 'VIN captured from native barcode scanner' + format + '. Check digit is consistent; verify the number and tap Decode VIN.'
              : 'VIN captured from native barcode scanner' + format + '. Verify every character and tap Decode VIN.';
          } else {
            state.barcodeStatus = 'The camera read a barcode, but its contents did not contain a complete VIN. Try centering the VIN code or use photo OCR.';
          }
        }
        renderVin();
      }).catch(function (err) {
        state.barcodeScanning = false;
        state.barcodeStatus = err && err.message
          ? 'Native barcode scan failed: ' + err.message
          : 'Native barcode scan failed. Try again or use photo OCR.';
        renderVin();
      }).finally(function () {
        var current = $('#vin-barcode-start');
        if (current) current.disabled = false;
      });
      return;
    }

    if (state.barcodeScanning) {
      stopBarcodeScanner();
      state.barcodeStatus = 'Barcode scanner stopped. You can start it again or use the photo option.';
      return renderVin();
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (status) status.textContent = 'Camera access is unavailable. Open the app over HTTPS or use the photo scanner below.';
      return;
    }
    if (button) button.disabled = true;
    if (status) status.textContent = 'Loading barcode scanner…';
    loadBarcodeEngine().then(function (ZXing) {
      state.barcodeScanning = true;
      video.hidden = false;
      if (button) button.textContent = 'Stop barcode scan';
      if (status) status.textContent = 'Starting camera… allow camera access, then aim at the VIN barcode.';
      var hints = new Map();
      if (ZXing.DecodeHintType && ZXing.BarcodeFormat) {
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.CODE_128,
          ZXing.BarcodeFormat.DATA_MATRIX, ZXing.BarcodeFormat.PDF_417,
          ZXing.BarcodeFormat.QR_CODE, ZXing.BarcodeFormat.ITF
        ]);
      }
      var reader = new ZXing.BrowserMultiFormatReader(hints, 350);
      return reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } } }, video, function (result, err, controls) {
        if (controls && !state.barcodeControls) state.barcodeControls = controls;
        if (result) {
          var vin = extractBarcodeVin(result.getText ? result.getText() : result.text);
          if (vin) {
            state.vinText = vin;
            state.vin = null;
            state.vinMsg = '';
            state.barcodeStatus = vinCheckDigitValid(vin)
              ? 'VIN captured from barcode. It passed the North American check digit; verify it below and tap Decode VIN.'
              : 'VIN text captured from barcode. Verify every character before decoding.';
            stopBarcodeScanner();
            renderVin();
          } else if (status) {
            status.textContent = 'Barcode detected, but it did not contain a valid 17-character VIN. Keep scanning or use the photo/manual option.';
          }
        }
      });
    }).then(function (controls) {
      if (controls && state.barcodeScanning) {
        state.barcodeControls = controls;
        if (status) status.textContent = 'Camera is active. Hold the VIN barcode inside the frame and move slowly until it focuses.';
      }
    }).catch(function (err) {
      stopBarcodeScanner();
      state.barcodeStatus = err && err.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in Android settings, or use the photo/manual option.' : (err && err.message ? err.message : 'Could not start barcode camera.');
      renderVin();
    }).finally(function () {
      var current = $('#vin-barcode-start');
      if (current) current.disabled = false;
    });
  }

  function loadOcrEngine() {
    if (window.Tesseract && window.Tesseract.createWorker) return Promise.resolve(window.Tesseract);
    if (state.ocrLoader) return state.ocrLoader;
    state.ocrLoader = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.async = true;
      script.onload = function () {
        if (window.Tesseract && window.Tesseract.createWorker) resolve(window.Tesseract);
        else reject(new Error('OCR engine loaded, but its worker API is unavailable. Please reload the app.'));
      };
      script.onerror = function () { reject(new Error('Could not load the OCR engine. Check your internet connection.')); };
      document.head.appendChild(script);
    }).catch(function (err) {
      state.ocrLoader = null;
      throw err;
    });
    return state.ocrLoader;
  }

  function prepareVinImage(file) {
    return new Promise(function (resolve, reject) {
      var url = window.URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(3, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) throw new Error('Could not prepare the photo for text recognition.');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
          var data = pixels.data;
          for (var i = 0; i < data.length; i += 4) {
            var gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
            // Lift midtones and increase contrast so stamped/printed VIN characters stand out.
            var enhanced = Math.max(0, Math.min(255, (gray - 128) * 1.55 + 128));
            data[i] = data[i + 1] = data[i + 2] = enhanced;
          }
          ctx.putImageData(pixels, 0, 0);
          window.URL.revokeObjectURL(url);
          resolve(canvas);
        } catch (err) {
          window.URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = function () {
        window.URL.revokeObjectURL(url);
        reject(new Error('The photo could not be opened. Try taking it again.'));
      };
      img.src = url;
    });
  }

  function getOcrWorker(Tesseract, status) {
    if (state.ocrWorker) return Promise.resolve(state.ocrWorker);
    return Tesseract.createWorker('eng', 1, {
      logger: function (m) {
        if (!status) return;
        if (m.status === 'loading tesseract core') status.textContent = 'Preparing text recognition…';
        else if (m.status === 'loading language traineddata') status.textContent = 'Downloading English recognition data…';
        else if (m.status === 'recognizing text') status.textContent = 'Reading VIN… ' + Math.round((m.progress || 0) * 100) + '%';
      }
    }).then(function (worker) {
      state.ocrWorker = worker;
      return worker;
    });
  }

  function scanVinPhoto() {
    var file = state.vinFile;
    if (!file) { state.ocrStatus = 'Take or choose a VIN photo first.'; return renderVin(); }
    if (!/^image\//i.test(file.type)) { state.ocrStatus = 'Please choose an image file.'; return renderVin(); }
    var button = $('#vin-ocr');
    if (button) button.disabled = true;
    var status = $('#vin-ocr-status');
    var nativeScanner = nativeVinScanner();
    if (nativeScanner && nativeScanner.recognizeText) {
      if (status) status.textContent = 'Preparing photo for Android text recognition…';
      prepareVinImage(file).then(function (canvas) {
        var dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        return nativeScanner.recognizeText({ imageBase64: dataUrl.split(',')[1] || '' });
      }).then(function (result) {
        var text = result && result.text ? result.text : '';
        state.ocrRaw = text;
        var candidates = extractVinCandidates(text);
        candidates.sort(function (a, b) { return Number(vinCheckDigitValid(b)) - Number(vinCheckDigitValid(a)); });
        if (candidates.length) {
          state.vinText = candidates[0];
          state.ocrStatus = candidates.length > 1
            ? 'Android OCR found several possible VINs. The best check-digit match is shown first; verify every character.'
            : (vinCheckDigitValid(candidates[0])
              ? 'Android OCR found a VIN with a consistent check digit. Verify every character before decoding.'
              : 'Android OCR found a possible VIN. Verify every character against the photo before decoding.');
        } else {
          state.ocrStatus = 'Android OCR read the photo but could not isolate a complete 17-character VIN. Review the raw text below.';
        }
        renderVin();
      }).catch(function (err) {
        state.ocrStatus = err && err.message ? err.message : 'Android photo recognition failed. Try another photo or enter the VIN manually.';
        renderVin();
      }).finally(function () {
        var current = $('#vin-ocr');
        if (current) current.disabled = false;
      });
      return;
    }
    if (status) status.textContent = 'Loading on-device text recognition…';
    loadOcrEngine().then(function (Tesseract) {
      return Promise.all([getOcrWorker(Tesseract, status), prepareVinImage(file)]);
    }).then(function (items) {
      var worker = items[0], image = items[1];
      return worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        tessedit_pageseg_mode: '6'
      }).then(function () { return worker.recognize(image); });
    }).then(function (result) {
      var firstText = result && result.data ? result.data.text : '';
      var firstCandidates = extractVinCandidates(firstText);
      // Always make a second pass against the untouched original photo. This
      // catches cases where contrast enhancement makes a clear character look
      // like a different digit/letter.
      return state.ocrWorker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        tessedit_pageseg_mode: '11'
      }).then(function () { return state.ocrWorker.recognize(file); })
        .then(function (retry) {
          var secondText = retry && retry.data ? retry.data.text : '';
          var combined = firstCandidates.concat(extractVinCandidates(secondText));
          var candidates = combined.filter(function (item, index) { return combined.indexOf(item) === index; });
          candidates.sort(function (a, b) { return Number(vinCheckDigitValid(b)) - Number(vinCheckDigitValid(a)); });
          state.ocrRaw = 'Enhanced photo pass:\\n' + String(firstText || '').trim() +
            '\\n\\nOriginal photo pass:\\n' + String(secondText || '').trim();
          return candidates;
        });
    }).then(function (candidates) {
      if (candidates.length === 1) {
        state.vinText = candidates[0];
        state.ocrStatus = vinCheckDigitValid(candidates[0])
          ? 'VIN found; its check digit is consistent. Verify every character before decoding.'
          : 'Possible VIN found. Verify every character against the photo before decoding.';
      } else if (candidates.length > 1) {
        state.ocrStatus = 'Several possible VIN readings were found. The best checksum match is shown first; verify it against the photo.';
        state.vinText = candidates[0];
      } else {
        state.ocrStatus = 'OCR could not isolate a complete 17-character VIN. The raw readings are shown below so you can spot the characters it missed.';
      }
      renderVin();
    }).catch(function (err) {
      state.ocrStatus = err && err.message ? err.message : 'Photo reading failed. Please try again or enter the VIN manually.';
      renderVin();
    }).finally(function () {
      var current = $('#vin-ocr');
      if (current) current.disabled = false;
    });
  }

  document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'vin-photo') {
      var file = e.target.files && e.target.files[0];
      state.vinFile = file || null;
      if (state.vinPreviewUrl && window.URL && URL.revokeObjectURL) URL.revokeObjectURL(state.vinPreviewUrl);
      state.vinPreviewUrl = file && window.URL && URL.createObjectURL ? URL.createObjectURL(file) : '';
      state.ocrStatus = file ? 'Photo ready. Tap “Read VIN from photo”.' : '';
      var preview = $('#vin-preview'), status = $('#vin-ocr-status');
      if (preview) { preview.src = state.vinPreviewUrl; preview.hidden = !state.vinPreviewUrl; }
      if (status) status.textContent = state.ocrStatus;
    }
  });

  /* ================= END OF COPIED BLOCK ================= */

  /* ---------- form fields ---------- */
  var POWER = { ICE: 'Gas / diesel', HEV: 'Hybrid', PHEV: 'Plug-in hybrid', EV: 'Electric' };
  var GROUPS = [
    { title: 'VEHICLE', fields: [
      ['vin', 'VIN', 'full'], ['year', 'Year'], ['make', 'Make'], ['model', 'Model'], ['trim', 'Trim'],
      ['series', 'Series'], ['body', 'Body style'], ['vehicleType', 'Vehicle type'], ['doors', 'Doors'],
      ['mfgDate', 'Built (month/year)', 'full']] },
    { title: 'WEIGHT & SIZE', fields: [
      ['gvwr', 'GVWR (lb)', 'num'], ['curb', 'Curb weight (lb)', 'num'], ['gawrFront', 'GAWR front (lb)', 'num'],
      ['gawrRear', 'GAWR rear (lb)', 'num'], ['gvwrClass', 'GVWR class (NHTSA)', 'full'], ['wheelbase', 'Wheelbase (in)', 'num'],
      ['clearance', 'Ground clearance (in)', 'num']] },
    { title: 'POWERTRAIN', fields: [
      ['engine', 'Engine', 'full'], ['fuel', 'Fuel'], ['power', 'Powertrain'], ['drive', 'Drive type', 'full'],
      ['trans', 'Transmission', 'full'], ['brakes', 'Brake system', 'full']] },
    { title: 'TIRES & LOADING', fields: [
      ['tireSizeFront', 'Front tire size'], ['psiFront', 'Front cold psi', 'num'],
      ['tireSizeRear', 'Rear tire size'], ['psiRear', 'Rear cold psi', 'num'],
      ['tireSizeSpare', 'Spare tire size'], ['psiSpare', 'Spare cold psi', 'num'],
      ['seating', 'Seating capacity', 'num'], ['maxLoad', 'Max occupants + cargo (lb)', 'num']] },
    { title: 'ORIGIN', fields: [['manufacturer', 'Manufacturer', 'full'], ['plant', 'Assembly plant', 'full']] },
    { title: 'SCAN', fields: [
      ['source', 'Scanned from'], ['scannedAt', 'Scanned', 'full'], ['checkDigit', 'Check digit', 'full'], ['notes', 'Notes', 'area']] }
  ];

  var current = blankRecord();
  var history = loadHistory();
  var handledVin = '', handledOcr = '', pendingSource = '', clearArmed = false;

  function blankRecord() { return { fields: {}, hints: {} }; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function setField(k, v, hint) {
    if (v == null || v === '') return;
    current.fields[k] = String(v);
    if (hint) current.hints[k] = hint; else delete current.hints[k];
  }

  /* ---------- recent scans (last 6, stored on this phone) ---------- */
  function loadHistory() {
    try {
      var a = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      if (!Array.isArray(a)) return [];
      a.forEach(function (h) {   // scans saved before front/rear tire fields existed
        var f = h.fields || {}, hi = h.hints || {};
        if (f.tireSize && !f.tireSizeFront) { f.tireSizeFront = f.tireSize; hi.tireSizeFront = hi.tireSize; }
        if (f.tirePsi && !f.psiFront) { f.psiFront = String(parseInt(f.tirePsi, 10) || ''); hi.psiFront = hi.tirePsi; }
        delete f.tireSize; delete f.tirePsi; delete hi.tireSize; delete hi.tirePsi;
      });
      return a.slice(0, HISTORY_MAX);
    } catch (e) { return []; }
  }
  function storeHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); } catch (e) { /* storage blocked: ignore */ }
  }
  function findHistory(vin) {
    for (var i = 0; i < history.length; i++) if (history[i].vin === vin) return history[i];
    return null;
  }
  function saveRecord(rec) {
    var vin = rec.fields.vin;
    if (!vin) return;
    history = history.filter(function (h) { return h.vin !== vin; });
    history.unshift({ vin: vin, savedAt: Date.now(), fields: clone(rec.fields), hints: clone(rec.hints) });
    history = history.slice(0, HISTORY_MAX);
    storeHistory();
  }

  /* ---------- tire helpers ---------- */
  var TIRE_SIZE = /\b(P|LT|ST|T)?\s?(\d{3})\s?\/\s?(\d{2})\s?(ZR|R|D|B)\s?(\d{2})\b/;
  function tireSize(m) { return (m[1] || '') + m[2] + '/' + m[3] + m[4] + m[5]; }
  function allTireSizes(text) {
    var out = [], re = new RegExp(TIRE_SIZE.source, 'g'), m;
    while ((m = re.exec(text))) out.push(tireSize(m));
    return out;
  }
  function isSpareSize(size) { return /^T|\d{2}D\d{2}$/.test(size); }   // T-type temporary spares, bias-ply D
  function psiValues(text) {
    var out = [], re = /(\d{2,3})\s*PSI\b/g, m, v;
    while ((m = re.exec(text))) { v = parseInt(m[1], 10); if (v >= 15 && v <= 120) out.push(v); }
    if (!out.length) {   // kPa-only labels
      re = /(\d{3})\s*KPA\b/g;
      while ((m = re.exec(text))) { v = Math.round(parseInt(m[1], 10) / 6.895); if (v >= 15 && v <= 120) out.push(v); }
    }
    return out;
  }
  // Fill front/rear/spare tire sizes and pressures that are still missing, in label order.
  function fillTiresInOrder(out, text) {
    var sizes = allTireSizes(text), road = sizes.filter(function (z) { return !isSpareSize(z); });
    var spare = sizes.filter(isSpareSize)[0];
    if (!out.tireSizeFront && road[0]) out.tireSizeFront = road[0];
    if (!out.tireSizeRear && road.length) out.tireSizeRear = road[1] || road[0];
    if (!out.tireSizeSpare && spare) out.tireSizeSpare = spare;
    var psi = psiValues(text);
    if (!out.psiFront && psi[0]) out.psiFront = psi[0];
    if (!out.psiRear && psi.length) out.psiRear = psi[1] || psi[0];
    if (!out.psiSpare && psi[2] && (out.tireSizeSpare || spare)) out.psiSpare = psi[2];
  }

  /* ---------- tire & loading label (the separate tire pressure placard) ---------- */
  function parseTirePlacard(raw) {
    var text = String(raw || '').replace(/\\n/g, '\n').toUpperCase();
    var lines = text.split(/\r?\n/), out = {};
    var POS = [['Front', /\b(FRONT|FRT|AVANT)\b/], ['Rear', /\b(REAR|ARRI[EÈ]RE)\b/], ['Spare', /\b(SPARE|SECOURS)\b/]];
    // Rows like "FRONT  P225/45R19  250 kPa, 36 PSI"
    lines.forEach(function (line) {
      POS.forEach(function (p) {
        if (!p[1].test(line)) return;
        var m = TIRE_SIZE.exec(line), psi = psiValues(line);
        if (m && !out['tireSize' + p[0]]) out['tireSize' + p[0]] = tireSize(m);
        if (psi.length && !out['psi' + p[0]]) out['psi' + p[0]] = psi[0];
      });
    });
    // OCR often reads the table column by column instead; fall back to front, rear, spare order.
    var flat = lines.join(' ').replace(/\s+/g, ' ');
    fillTiresInOrder(out, flat);
    var seat = /SEATING CAPACITY\D{0,40}?TOTAL\s*(\d{1,2})\b/.exec(flat) || /SEATING CAPACITY\D{0,30}?(\d{1,2})\b/.exec(flat);
    if (seat) out.seating = parseInt(seat[1], 10);
    var load = /(COMBINED WEIGHT|NEVER EXCEED|NE DOIT JAMAIS)[\s\S]{0,140}?(\d[\d,]{2,5})\s*(LBS|LB)\b/.exec(flat);
    if (load) {
      var n = parseInt(load[2].replace(/,/g, ''), 10);
      if (n >= 300 && n <= 6000) out.maxLoad = n;
    }
    Object.keys(out).forEach(function (k) { out[k] = String(out[k]); });
    return out;
  }

  /* ---------- door sticker reading (from the OCR text) ---------- */
  function parseDoorSticker(raw) {
    // The browser OCR path joins its two passes with a literal "\n"; treat that as a line break too.
    var flat = String(raw || '').replace(/\\n/g, '\n').toUpperCase().replace(/\s+/g, ' ');
    var out = {};
    function weightAfter(re, min, max) {
      var m = re.exec(flat);
      if (!m) return null;
      var seg = flat.slice(m.index + m[0].length, m.index + m[0].length + 60);
      var stop = seg.search(/\b(GAWR|GVWR|PNBE|PNBV)\b/);
      if (stop > 0) seg = seg.slice(0, stop);
      var lb = /(\d[\d,.]{2,6})\s*\)?\s*LBS?\b/.exec(seg);
      var n = lb ? parseInt(lb[1].replace(/[,.]/g, ''), 10) : NaN;
      if (!(n >= min && n <= max)) {
        var kg = /(\d[\d,.]{2,5})\s*KG\b/.exec(seg);
        n = kg ? Math.round(parseInt(kg[1].replace(/[,.]/g, ''), 10) * 2.20462) : NaN;
      }
      return n >= min && n <= max ? n : null;
    }
    // Labels are often bilingual ("GVWR/PNBV", "GAWR FRT/PNBE AV"); swallow the French half too.
    var gvwr = weightAfter(/\b(GVWR|GVW|PNBV)\b(\s*\/?\s*PNBV\b)?/, 2000, 40000);
    // "GAWR FRT/PNBE AV" and Mazda's "GAWR/PNBE FRT" both name the front axle.
    // A stray symbol inside the word is tolerated: the phone read "GA\WR/PNBE FRT".
    var FRONT_H = /\bG[^A-Z0-9\s]?A[^A-Z0-9\s]?W[^A-Z0-9\s]?R\s*(\/\s*PNBE\s*)?(FRT|FR|FRONT|F)\b(\s*\/?\s*PNBE(\s*AV)?\b)?/;
    var REAR_H = /\bG[^A-Z0-9\s]?A[^A-Z0-9\s]?W[^A-Z0-9\s]?R\s*(\/\s*PNBE\s*)?(RR|REAR|R)\b(\s*\/?\s*PNBE(\s*AR)?\b)?/;
    var GVWR_H = /\b(G[^A-Z0-9\s]?V[^A-Z0-9\s]?W[^A-Z0-9\s]?R|GVW|PNBV)\b(\s*\/?\s*PNBV\b)?/;
    var front = weightAfter(FRONT_H, 1000, 25000);
    var rear = weightAfter(REAR_H, 1000, 25000);
    if (gvwr) out.gvwr = gvwr;
    if (front) out.gawrFront = front;
    if (rear) out.gawrRear = rear;
    // Headings printed side by side with the numbers in the row below (Mazda and others):
    //   GVWR/PNBV  GAWR/PNBE FRT  GAWR/PNBE RR
    //   4288LB     2269 LB        2030 LB
    // The numbers are matched to the headings in the same left-to-right order, then checked: GVWR is the
    // largest and no more than the two axle ratings added together. If that doesn't hold, nothing is guessed.
    var heads = [['gvwr', GVWR_H.exec(flat)], ['gawrFront', FRONT_H.exec(flat)], ['gawrRear', REAR_H.exec(flat)]]
      .filter(function (h) { return h[1]; })
      .map(function (h) { return { key: h[0], start: h[1].index, end: h[1].index + h[1][0].length }; })
      .sort(function (a, b) { return a.start - b.start; });
    if (heads.length === 3 && !/\d/.test(flat.slice(heads[0].start, heads[2].end).replace(/PNB[VE]/g, ''))) {
      var after = flat.slice(heads[2].end);
      function numbers(re, factor) {
        var list = [], m;
        while ((m = re.exec(after))) list.push(Math.round(parseInt(m[1].replace(/,/g, ''), 10) * factor));
        return list;
      }
      var vals = numbers(/(\d[\d,]{2,5})\s*LBS?\b/g, 1);
      if (vals.length < 3) vals = numbers(/(\d[\d,]{2,5})\s*KG\b/g, 2.20462);
      if (vals.length >= 3) {
        var byHead = {};
        heads.forEach(function (h, i) { byHead[h.key] = vals[i]; });
        var g = byHead.gvwr, fr = byHead.gawrFront, rr = byHead.gawrRear;
        var sane = g >= 2000 && g <= 40000 && fr >= 1000 && rr >= 1000 && g >= Math.max(fr, rr) && g <= (fr + rr) * 1.05;
        if (sane) { out.gvwr = g; out.gawrFront = fr; out.gawrRear = rr; }
        else { delete out.gvwr; delete out.gawrFront; delete out.gawrRear; }   // "next number" is meaningless here
      }
    }
    // GVWR missing (or not fitting) while both axle ratings were found: the phone can return GVWR's numbers
    // before its heading. Take the remaining LB value that fits: at least each axle, at most both together.
    if (out.gawrFront && out.gawrRear) {
      var fA = +out.gawrFront, rA = +out.gawrRear;
      var fits = function (g) { return g >= 2000 && g <= 40000 && g >= Math.max(fA, rA) && g <= (fA + rA) * 1.05; };
      if (!out.gvwr || !fits(+out.gvwr)) {
        var pool = [], pm, pre = /(\d[\d,]{2,5})\s*LBS?\b/g;
        while ((pm = pre.exec(flat))) pool.push(parseInt(pm[1].replace(/,/g, ''), 10));
        if (pool.length < 3) { pool = []; pre = /(\d[\d,]{2,5})\s*KG\b/g; while ((pm = pre.exec(flat))) pool.push(Math.round(parseInt(pm[1].replace(/,/g, ''), 10) * 2.20462)); }
        [fA, rA].forEach(function (v) { var k = pool.indexOf(v); if (k >= 0) pool.splice(k, 1); });   // the axle values themselves
        var gFit = pool.filter(fits).sort(function (a, b) { return b - a; })[0];
        if (gFit) out.gvwr = gFit; else delete out.gvwr;
      }
    }
    var date = /\b(MFD|MFG|DATE|MANUFACTURED)\b\D{0,25}?\b(0?[1-9]|1[0-2])\s*[\/\-.]?\s*(20\d{2}|\d{2})\b/.exec(flat);
    if (date) out.mfgDate = ('0' + date[2]).slice(-2) + '/' + (date[3].length === 2 ? '20' + date[3] : date[3]);
    else if (/\b(DATE|MFD|MFG)\b/.test(flat)) {
      // "DATE" heading in one row, "09/13" below it: a month/year written with a slash.
      var my = /(?:^|[^\d\/])(0[1-9]|1[0-2])\/(\d{2})(?![\d\/])/.exec(flat);
      if (my) out.mfgDate = my[1] + '/20' + my[2];
    }
    // Door stickers list tires on the axle lines: "GAWR FRT ... WITH P225/45R19 TIRES ... AT 250 KPA COLD"
    function axle(re) {
      var m = re.exec(flat);
      if (!m) return '';
      var rest = flat.slice(m.index + m[0].length), stop = rest.search(/\bGAWR\b|\bGVWR\b/);
      return stop > 0 ? rest.slice(0, stop) : rest.slice(0, 120);
    }
    [['Front', axle(/\bGAWR\s*(FRT|FR|FRONT|F)\b/)], ['Rear', axle(/\bGAWR\s*(RR|REAR|R)\b/)]].forEach(function (a) {
      if (!a[1]) return;
      var m = TIRE_SIZE.exec(a[1]), psi = psiValues(a[1]);
      if (m) out['tireSize' + a[0]] = tireSize(m);
      if (psi.length) out['psi' + a[0]] = psi[0];
    });
    fillTiresInOrder(out, flat);
    Object.keys(out).forEach(function (k) { out[k] = String(out[k]); });
    return out;
  }

  /* ---------- turning a scanned VIN into a filled form ---------- */
  function startRecord(vin, source) {
    var prior = findHistory(vin);
    var unsaved = current.fields.vin ? null : current;   // e.g. a tire label read before the VIN was scanned
    current = prior ? { fields: clone(prior.fields), hints: clone(prior.hints || {}) } : blankRecord();
    if (unsaved) Object.keys(unsaved.fields).forEach(function (k) {
      if (unsaved.fields[k]) { current.fields[k] = unsaved.fields[k]; if (unsaved.hints[k]) current.hints[k] = unsaved.hints[k]; }
    });
    current.fields.vin = vin;
    current.fields.source = source;
    current.fields.scannedAt = new Date().toLocaleString();
    current.fields.checkDigit = vinCheckDigitValid(vin)
      ? 'Valid'
      : 'Not valid - recheck VIN (OK on some imports)';
  }

  function applySticker(s, hint) {
    var keys = Object.keys(s);
    keys.forEach(function (k) { setField(k, s[k], hint || 'From door sticker photo'); });
    return keys.length;
  }

  /* ---------- picking the VIN out of a photo reading ---------- */
  // The tow-app reader ranks every 17-character stretch of text by the check digit, and plain words pass it by
  // chance about 1 time in 11 (a door sticker gave "NTHEDATE0FMANUFAC"). Every VIN also ends in 4 digits, so:
  // 1. a reading that ends in 4 digits AND passes the check digit;
  // 2. if none, the same photo turned a quarter turn each way (VINs often run vertically in the photo);
  // 3. if still none, a reading that ends in 4 digits, to verify (some foreign VINs don't use the check digit);
  // 4. otherwise no VIN rather than a word.
  // Photos whose reading already gives (1) are handled exactly as before.
  var sidewaysTried = '';
  function vinShape(v) { return /^[A-HJ-NPR-Z0-9]{13}[0-9]{4}$/.test(v || '') && !/[UZ0]/.test(v.charAt(9)); }
  function strongVin(v) { return vinShape(v) && vinCheckDigitValid(v); }
  function sidewaysReader() {
    var n = nativeVinScanner();
    return n && n.recognizeText ? n : null;
  }
  function turned(canvas, deg) {
    var c = document.createElement('canvas');
    c.width = canvas.height; c.height = canvas.width;
    var ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate(deg * Math.PI / 180);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return c;
  }
  function settlePhotoVin(best, cands, sideways) {
    var pick = best || cands.filter(vinShape)[0] || '';
    var box = $('#vin'), status = $('#vin-ocr-status');
    if (pick) {
      state.vinText = pick;
      if (sideways) state.ocrStatus = 'VIN found with the photo turned sideways; its check digit is consistent. Verify every character.';
      else if (!best) state.ocrStatus = 'Possible VIN found, but its check digit doesn’t match (normal for some non-US vehicles). Verify every character.';
    } else {
      state.vinText = handledVin || '';
      state.ocrStatus = 'No VIN found in this photo, even turned sideways. Try a closer, straight-on photo in good light, or type the VIN below. The raw text is shown below.';
    }
    if (box) box.value = state.vinText;
    if (status) status.textContent = state.ocrStatus;
  }
  // Every photo is read three ways: as taken (the tow-app reader's pass), turned 90 and turned 270 degrees.
  // Google's reader is told the photo is upright and handles horizontal text best, so a VIN running vertically
  // is read reliably by one of the turned passes. The VIN that passes the VIN rules in the most passes wins;
  // a tie goes to the photo as taken. Door-sticker values come from the pass that read the most of the sticker.
  function readAllWays(firstCands) {
    var reader = sidewaysReader(), status = $('#vin-ocr-status'), upright = state.ocrRaw;
    sidewaysTried = upright;
    if (status) status.textContent = 'Reading the photo turned sideways too…';
    prepareVinImage(state.vinFile).then(function (canvas) {
      var texts = [];
      function pass(deg) {
        var c = turned(canvas, deg);
        return reader.recognizeText({ imageBase64: c.toDataURL('image/jpeg', 0.9).split(',')[1] || '' })
          .then(function (r) { texts.push(r && r.text ? r.text : ''); }, function () { texts.push(''); });
      }
      return pass(90).then(function () { return pass(270); }).then(function () { return texts; });
    }).catch(function () { return []; }).then(function (turnedTexts) {
      var reads = [upright].concat(turnedTexts), tally = {}, order = [], all = [];
      reads.forEach(function (text, i) {
        var cands = extractVinCandidates(text);
        cands.forEach(function (v) { if (all.indexOf(v) === -1) all.push(v); });
        cands.filter(strongVin).filter(function (v, k, arr) { return arr.indexOf(v) === k; }).forEach(function (v) {
          if (!tally[v]) { tally[v] = { n: 0, first: i }; order.push(v); }
          tally[v].n++;
        });
      });
      order.sort(function (x, y) { return tally[y].n - tally[x].n || tally[x].first - tally[y].first; });
      var best = order[0] || null;
      // Door-sticker values: the pass that read the most of the sticker (the photo as taken wins a tie).
      var stickerText = upright, most = Object.keys(parseDoorSticker(upright)).length;
      turnedTexts.forEach(function (t) { var n = Object.keys(parseDoorSticker(t)).length; if (n > most) { most = n; stickerText = t; } });
      if (stickerText !== upright) { state.ocrRaw = stickerText; sidewaysTried = stickerText; }
      settlePhotoVin(best, all.length ? all : firstCands, !!best && tally[best].first > 0);
      renderVin();   // carries on exactly like a normal read; this photo is not read again
    });
  }

  function processCapture() {
    var vin = state.vinText;
    var newVin = !!vin && vin !== handledVin;
    var newOcr = !!state.ocrRaw && state.ocrRaw !== handledOcr;
    if (!newVin && !newOcr) return;
    if (newOcr && pendingSource === 'Photo (OCR)' && state.ocrRaw !== sidewaysTried) {
      var cands = extractVinCandidates(state.ocrRaw), best = cands.filter(strongVin)[0];
      if (state.vinFile && sidewaysReader()) return readAllWays(cands);
      sidewaysTried = state.ocrRaw;
      settlePhotoVin(best, cands, false);
      vin = state.vinText;
      newVin = !!vin && vin !== handledVin;
    }
    var sticker = newOcr ? parseDoorSticker(state.ocrRaw) : {};
    if (newOcr) handledOcr = state.ocrRaw;
    if (newVin) { handledVin = vin; startRecord(vin, pendingSource || 'Manual entry'); }
    // A sticker photo where no VIN could be read is added to the vehicle on screen, flagged so it gets checked.
    var noVinInPhoto = newOcr && !newVin && !extractVinCandidates(state.ocrRaw).length;
    var stickerCount = applySticker(sticker, noVinInPhoto ? 'From door sticker photo - no VIN read in photo, confirm same vehicle' : '');
    if (stickerCount && noVinInPhoto) {
      setMsg(current.fields.vin
        ? 'No VIN was readable in that photo. ' + stickerCount + ' sticker value' + (stickerCount === 1 ? ' was' : 's were') + ' added to ' + current.fields.vin + ' - make sure it is the same vehicle.'
        : 'Sticker values were read, but no VIN. Scan or type the VIN so this can be saved.', true);
    }
    saveRecord(current);
    renderForm();
    renderHistory();
    if (newVin) decodeVinFields(vin);
  }

  function decodeVinFields(vin) {
    setMsg('Looking up ' + vin + ' with NHTSA…');
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 10000);
    fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/' + encodeURIComponent(vin) + '?format=json', ctl ? { signal: ctl.signal } : {})
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (json) {
        clearTimeout(timer);
        var p = E.parseVinDecode(json);
        if (!p || !p.ok) return current.fields.vin === vin && setMsg('NHTSA could not identify this VIN. It is saved; check the characters and tap Decode VIN again.', true);
        // If the user moved on to another VIN while this was loading, update the saved entry, not the form.
        var keep = current, saved = findHistory(vin);
        if (current.fields.vin !== vin) {
          if (!saved) return;
          current = { fields: saved.fields, hints: saved.hints || {} };
        }
        fillFromNhtsa(json.Results[0], p);
        saveRecord(current);
        if (keep.fields.vin !== vin) { current = keep; return renderHistory(); }
        renderHistory();
        renderForm();
        setMsg('Decoded. Specs come from NHTSA, the door sticker and typical database values - verify on the vehicle.');
      })
      .catch(function () {
        clearTimeout(timer);
        if (current.fields.vin === vin) setMsg('Could not reach the VIN service. The VIN is saved; tap Decode VIN when you have signal.', true);
      });
  }

  function fillFromNhtsa(r, p) {
    function get(k) { var v = r[k] == null ? '' : String(r[k]).trim(); return /^(not applicable|0)$/i.test(v) ? '' : v; }
    function join(a, sep) { return a.filter(Boolean).join(sep || ' '); }
    var NHTSA = 'From NHTSA VIN decode';
    setField('year', p.year, NHTSA);
    setField('make', p.make, NHTSA);
    setField('model', p.model, NHTSA);
    setField('trim', join([get('Trim'), get('Trim2')], ' / '), NHTSA);
    setField('series', join([get('Series'), get('Series2')], ' / '), NHTSA);
    setField('body', p.body, NHTSA);
    setField('vehicleType', get('VehicleType'), NHTSA);
    setField('doors', get('Doors'), NHTSA);
    // NHTSA only gives a GVWR class range; the exact GVWR comes from the door sticker (or the database below).
    setField('gvwrClass', get('GVWR'), NHTSA);
    var curb = parseInt(get('CurbWeightLB'), 10);
    if (curb > 0) setField('curb', curb, NHTSA);
    var wb = parseFloat(get('WheelBaseShort'));
    if (wb > 0) setField('wheelbase', wb, NHTSA);
    var disp = parseFloat(get('DisplacementL'));
    var cyl = get('EngineCylinders'), conf = get('EngineConfiguration'), hp = parseFloat(get('EngineHP'));
    var layout = cyl ? (/^v/i.test(conf) ? 'V' + cyl : (/flat|horizontal/i.test(conf) ? 'Flat-' + cyl : cyl + '-cyl')) : '';
    setField('engine', join([disp > 0 ? disp.toFixed(1) + 'L' : '', layout, hp > 0 ? Math.round(hp) + ' hp' : '', get('EngineModel')], ' · '), NHTSA);
    setField('fuel', join([get('FuelTypePrimary'), get('FuelTypeSecondary')], ' / '), NHTSA);
    setField('power', POWER[p.power], NHTSA);
    setField('drive', get('DriveType'), NHTSA);
    var speeds = get('TransmissionSpeeds');
    setField('trans', join([get('TransmissionStyle'), speeds ? speeds + '-speed' : ''], ', '), NHTSA);
    setField('brakes', get('BrakeSystemType'), NHTSA);
    setField('manufacturer', get('Manufacturer'), NHTSA);
    setField('plant', join([get('PlantCity'), get('PlantState'), get('PlantCountry')], ', '), NHTSA);

    // Weight/size gaps: fall back to the tow app's typical values for the closest model range.
    var match = E.matchVehicles(D.vehicles, p)[0];
    if (match) {
      var tag = 'Typical for ' + match.make + ' ' + match.model + ' (' + match.yFrom + '-' + match.yTo + ', database) - verify';
      if (!current.fields.curb) setField('curb', match.curb, tag);
      if (!current.fields.wheelbase) setField('wheelbase', match.wb, tag);
      if (!current.fields.clearance) setField('clearance', match.gc, tag);
      if (!current.fields.gvwr && match.gvwr) setField('gvwr', match.gvwr, tag);
    }
  }

  /* ---------- tire label photo ---------- */
  var tire = { file: null, previewUrl: '', raw: '' };
  var TIRE_HELP = 'Fills front, rear and spare tire sizes and cold pressures, seating capacity and max load. Nothing else on the form is changed.';

  function tireText(file, status) {
    var nativeScanner = nativeVinScanner();
    if (nativeScanner && nativeScanner.recognizeText) {
      // Same Android text recognition the VIN photo uses.
      return prepareVinImage(file).then(function (canvas) {
        return nativeScanner.recognizeText({ imageBase64: canvas.toDataURL('image/jpeg', 0.9).split(',')[1] || '' });
      }).then(function (r) { return r && r.text ? r.text : ''; });
    }
    // Browser fallback: same Tesseract engine; allow the "/" and "," a tire label needs.
    return loadOcrEngine().then(function (Tesseract) { return getOcrWorker(Tesseract, status); })
      .then(function (worker) {
        return worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '6' })
          .then(function () { return worker.recognize(file); });
      }).then(function (r) { return r && r.data ? r.data.text : ''; });
  }

  function readTirePhoto() {
    var status = $('#tire-status'), btn = $('#tire-ocr');
    if (!tire.file) { if (status) status.textContent = 'Take a photo of the tire label first.'; return; }
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Reading tire label…';
    tireText(tire.file, status).then(function (text) {
      tire.raw = text;
      var found = parseTirePlacard(text), keys = Object.keys(found);
      if (!keys.length) {
        if (status) status.textContent = 'No tire sizes or pressures found. Retake the photo straight on, in good light, then tap Read tire label.';
        return;
      }
      keys.forEach(function (k) { setField(k, found[k], 'From tire label photo'); });
      var where = current.fields.vin ? ' Saved with ' + current.fields.vin + '.' : ' Scan or enter the VIN and they will be saved with it.';
      if (status) status.textContent = 'Filled ' + keys.length + ' tire/loading value' + (keys.length === 1 ? '' : 's') + '. Nothing else was changed.' + where;
      if (current.fields.vin) saveRecord(current);
      renderForm(); renderHistory();
    }).catch(function (err) {
      if (status) status.textContent = (err && err.message) || 'Could not read the tire label. Try another photo.';
    }).then(function () {
      if (btn) btn.disabled = false;
      var box = $('#tire-raw-box'), pre = $('#tire-raw');
      if (box) box.hidden = !tire.raw;
      if (pre) pre.textContent = tire.raw;
    });
  }

  /* ---------- VIN photo from the gallery ---------- */
  // A gallery photo that opens normally goes to the tow-app photo reader exactly as picked, like a camera photo.
  // Only one that won't open (cloud-only, or a format such as HEIC) is copied and converted to a JPEG, keeping
  // its rotation; the status says so when that happened.
  function opens(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img.naturalWidth > 0); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(false); };
      img.src = url;
    });
  }
  function readBytes(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('That photo could not be read. Pick it again, or use the camera.')); };
      r.readAsArrayBuffer(file);
    });
  }
  function toJpeg(file) {
    var unsupported = new Error('This photo’s format can’t be opened on this phone (often a HEIC "high efficiency" photo). Use the camera instead, or turn off high-efficiency photos in the camera settings.');
    if (typeof createImageBitmap !== 'function') return Promise.reject(unsupported);
    var decode;
    try { decode = createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { decode = createImageBitmap(file); }
    return decode.then(function (bmp) {
      var scale = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (resolve, reject) {
        c.toBlob(function (b) {
          if (!b) return reject(unsupported);
          var jpg = new File([b], 'photo.jpg', { type: 'image/jpeg' });
          jpg.converted = true;
          resolve(jpg);
        }, 'image/jpeg', 0.92);
      });
    }, function () { throw unsupported; });
  }
  function loadPicked(file) {
    return opens(file).then(function (ok) {
      if (ok) return file;
      return readBytes(file).then(function (buf) {
        if (!buf || !buf.byteLength) throw new Error('That photo came back empty. It may still be in the cloud: open it in your gallery so it downloads, then pick it again.');
        var copy = new File([buf], file.name || 'photo.jpg', { type: /^image\//.test(file.type) ? file.type : 'image/jpeg' });
        return opens(copy).then(function (ok2) { return ok2 ? copy : toJpeg(copy); });
      });
    });
  }

  // On the phone the gallery photo is fetched by Android itself (Capacitor Camera plugin: system photo picker,
  // rotation straightened, HEIC turned into JPEG) and handed over as an ordinary JPEG kept in memory. The app's
  // web view could not open files from the gallery picker on some phones ("The photo could not be opened").
  function galleryPlugin() {
    var cap = window.Capacitor;
    return cap && cap.Plugins && cap.Plugins.Camera && typeof cap.Plugins.Camera.getPhoto === 'function' ? cap.Plugins.Camera : null;
  }
  function dataUrlToFile(dataUrl) {
    var parts = String(dataUrl || '').split(','), bin = atob(parts[1] || ''), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], 'gallery.jpg', { type: 'image/jpeg' });
  }
  function setVinPhoto(file, note) {
    var status = $('#vin-ocr-status'), preview = $('#vin-preview');
    state.vinFile = file;
    if (state.vinPreviewUrl && window.URL && URL.revokeObjectURL) URL.revokeObjectURL(state.vinPreviewUrl);
    state.vinPreviewUrl = window.URL && URL.createObjectURL ? URL.createObjectURL(file) : '';
    state.ocrStatus = (note || 'Photo ready. ') + 'Tap “Read VIN from photo”.';
    if (preview) { preview.src = state.vinPreviewUrl; preview.hidden = !state.vinPreviewUrl; }
    if (status) status.textContent = state.ocrStatus;
  }
  function pickVinFromGallery() {
    var plugin = galleryPlugin(), status = $('#vin-ocr-status');
    if (!plugin) { var input = $('#vin-gallery'); if (input) input.click(); return; }   // plain browser: file picker
    // Full size and full quality: the tow-app reader then scales it exactly as it does a camera photo.
    plugin.getPhoto({ source: 'PHOTOS', resultType: 'dataUrl', quality: 100, correctOrientation: true })
      .then(function (photo) {
        if (!photo || !photo.dataUrl) throw new Error('No photo came back from the gallery. Try again.');
        setVinPhoto(dataUrlToFile(photo.dataUrl));
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : '';
        state.ocrStatus = /cancel/i.test(msg) ? 'No photo picked.' : (msg || 'Could not get the photo from the gallery.');
        if (status) status.textContent = state.ocrStatus;
      });
  }

  /* ---------- odometer photo (shown only; not read, not saved) ---------- */
  var odo = { previewUrl: '' };
  function showOdometer(file) {
    var preview = $('#odo-preview'), status = $('#odo-status');
    if (odo.previewUrl && window.URL && URL.revokeObjectURL) URL.revokeObjectURL(odo.previewUrl);
    odo.previewUrl = file && window.URL && URL.createObjectURL ? URL.createObjectURL(file) : '';
    if (preview) { preview.src = odo.previewUrl; preview.hidden = !odo.previewUrl; }
    if (status && file) status.textContent = 'Odometer photo added.';
  }
  function clearOdometer() {
    if (odo.previewUrl && window.URL && URL.revokeObjectURL) URL.revokeObjectURL(odo.previewUrl);
    odo.previewUrl = '';
    ['#odo-photo', '#odo-gallery'].forEach(function (id) { var i = $(id); if (i) i.value = ''; });
    var preview = $('#odo-preview'), status = $('#odo-status');
    if (preview) { preview.removeAttribute('src'); preview.hidden = true; }
    if (status) status.textContent = 'A photo of the odometer for your records. It stays on screen while you work on this vehicle; it is not read or saved.';
  }
  function pickOdometerFromGallery() {
    var plugin = galleryPlugin(), status = $('#odo-status');
    if (!plugin) { var input = $('#odo-gallery'); if (input) input.click(); return; }   // plain browser: file picker
    plugin.getPhoto({ source: 'PHOTOS', resultType: 'dataUrl', quality: 100, correctOrientation: true })
      .then(function (photo) {
        if (!photo || !photo.dataUrl) throw new Error('No photo came back from the gallery. Try again.');
        showOdometer(dataUrlToFile(photo.dataUrl));
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : '';
        if (status) status.textContent = /cancel/i.test(msg) ? 'No photo picked.' : (msg || 'Could not get the photo from the gallery.');
      });
  }
  document.addEventListener('change', function (e) {
    if (!e.target || (e.target.id !== 'odo-photo' && e.target.id !== 'odo-gallery')) return;
    var file = e.target.files && e.target.files[0];
    if (file) showOdometer(file);
  });

  /* ---------- rendering ---------- */
  function setMsg(text, isErr) {
    var m = $('#msg');
    if (!m) return;
    m.textContent = text || '';
    m.hidden = !text;
    m.classList.toggle('err-box', !!isErr);
  }

  // The copied scanner code calls renderVin() whenever a scan finishes, fails or is stopped.
  // Here it refreshes the scanner panel, then hands any new VIN or OCR text to the form.
  function renderVin() {
    var btn = $('#vin-barcode-start'), video = $('#vin-barcode-video');
    // Same text the tow app's renderVin puts in these spots.
    if (btn) btn.textContent = state.barcodeScanning ? 'Barcode scanner starting…' : 'Start barcode scan';
    if (video) video.hidden = !state.barcodeScanning;
    var bs = $('#vin-barcode-status');
    if (bs) bs.textContent = state.barcodeStatus || 'Point the camera at the VIN barcode and hold steady. Supports common 1D and 2D barcode formats.';
    var os = $('#vin-ocr-status');
    if (os) os.textContent = state.ocrStatus || 'Camera scan works best in good light with minimal glare.';
    var vinInput = $('#vin');
    if (vinInput) vinInput.value = state.vinText || '';
    var raw = $('#ocr-raw-box');
    if (raw) {
      raw.hidden = !state.ocrRaw;
      var pre = $('#ocr-raw');
      if (pre) pre.textContent = state.ocrRaw || '';
    }
    processCapture();
  }

  function renderForm() {
    var f = current.fields, hints = current.hints;
    var h = GROUPS.map(function (g) {
      return '<div class="fgroup"><div class="label">' + esc(g.title) + '</div><div class="fgrid">' + g.fields.map(function (fd) {
        var k = fd[0], kind = fd[2] || '';
        var input = kind === 'area'
          ? '<textarea id="f-' + k + '" data-field="' + k + '" rows="3">' + esc(f[k] || '') + '</textarea>'
          : '<input id="f-' + k + '" data-field="' + k + '" value="' + esc(f[k] || '') + '"' +
            (kind === 'num' ? ' inputmode="decimal"' : '') +
            (k === 'vin' ? ' class="mono" readonly placeholder="Filled in by the scan above"' : '') + '>';
        return '<div class="fcell' + (kind === 'full' || kind === 'area' ? ' full' : '') + '">' +
          '<label class="f" for="f-' + k + '">' + esc(fd[1]) + '</label>' + input +
          (hints[k] ? '<div class="hint">' + esc(hints[k]) + '</div>' : '') +
          '</div>';
      }).join('') + '</div></div>';
    }).join('');
    $('#form').innerHTML = h;
  }

  function renderHistory() {
    var box = $('#history');
    if (!box) return;
    if (!history.length) {
      box.innerHTML = '<div class="muted">No scans yet. Your last ' + HISTORY_MAX + ' VINs are kept on this phone.</div>';
      return;
    }
    box.innerHTML = '<div class="list">' + history.map(function (h, i) {
      var f = h.fields || {};
      var name = [f.year, f.make, f.model].filter(Boolean).join(' ') || 'Not decoded yet';
      var extra = [f.gvwr ? 'GVWR ' + f.gvwr + ' lb' : '', new Date(h.savedAt).toLocaleString()].filter(Boolean).join(' · ');
      return '<div class="hrow' + (h.vin === current.fields.vin ? ' cur' : '') + '">' +
        '<button class="item" data-load="' + i + '"><b>' + esc(name) + '</b><span class="mono">' + esc(h.vin) + '</span><span>' + esc(extra) + '</span></button>' +
        '<button class="xbtn" data-del="' + i + '" aria-label="Remove ' + esc(h.vin) + '">✕</button></div>';
    }).join('') + '</div>' +
      '<button class="btn ghost block" id="clear-history" type="button">' + (clearArmed ? 'Tap again to clear all' : 'Clear recent scans') + '</button>';
  }

  function summaryText() {
    var lines = [];
    GROUPS.forEach(function (g) {
      g.fields.forEach(function (fd) {
        var v = current.fields[fd[0]];
        if (v) lines.push(fd[1] + ': ' + v);
      });
    });
    return lines.join('\n');
  }

  /* ---------- events ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('button') : null;
    if (!t) return;
    if (t.id !== 'clear-history' && clearArmed) { clearArmed = false; renderHistory(); }
    // Same three buttons, same functions as the tow app. Only the source label for the form is noted here.
    if (t.id === 'vin-barcode-start') { pendingSource = 'Barcode scan'; return startBarcodeScan(); }
    if (t.id === 'vin-gallery-btn') return pickVinFromGallery();
    if (t.id === 'odo-gallery-btn') return pickOdometerFromGallery();
    if (t.id === 'vin-ocr') { pendingSource = 'Photo (OCR)'; return scanVinPhoto(); }
    if (t.id === 'tire-ocr') return readTirePhoto();
    if (t.id === 'vin-go') {
      var vin = ($('#vin').value || '').trim().toUpperCase();
      state.vinText = vin;
      if (!E.validVin(vin)) return setMsg('A VIN is 17 letters and digits (no I, O or Q).', true);
      // A VIN not on the form yet starts a new record; the one already on the form is just looked up again.
      if (vin !== current.fields.vin) {
        if (vin !== handledVin) pendingSource = 'Manual entry';   // a VIN the scanner just read keeps its scan source
        handledVin = '';
        return processCapture();
      }
      return decodeVinFields(vin);
    }
    if (t.id === 'new-scan') {
      stopBarcodeScanner();
      clearOdometer();
      current = blankRecord(); handledVin = ''; handledOcr = ''; state.vinText = ''; state.barcodeStatus = ''; state.ocrStatus = '';
      state.ocrRaw = ''; state.vinFile = null;
      if (state.vinPreviewUrl && window.URL && URL.revokeObjectURL) URL.revokeObjectURL(state.vinPreviewUrl);
      state.vinPreviewUrl = '';
      var photo = $('#vin-photo'), gallery = $('#vin-gallery'), preview = $('#vin-preview');
      if (photo) photo.value = '';
      if (gallery) gallery.value = '';
      if (preview) { preview.removeAttribute('src'); preview.hidden = true; }
      if (tire.previewUrl && window.URL && URL.revokeObjectURL) URL.revokeObjectURL(tire.previewUrl);
      tire = { file: null, previewUrl: '', raw: '' };
      var tp = $('#tire-photo'), tpv = $('#tire-preview'), trb = $('#tire-raw-box'), ts = $('#tire-status');
      if (tp) tp.value = '';
      if (tpv) { tpv.removeAttribute('src'); tpv.hidden = true; }
      if (trb) trb.hidden = true;
      if (ts) ts.textContent = TIRE_HELP;
      setMsg(''); renderVin(); renderForm(); renderHistory(); window.scrollTo(0, 0);
      return;
    }
    if (t.id === 'copy-all') {
      copyText(summaryText());
      t.textContent = 'Copied'; return setTimeout(function () { t.textContent = 'Copy all'; }, 1500);
    }
    if (t.id === 'share-all') {
      var text = summaryText();
      if (navigator.share) return navigator.share({ title: 'VIN ' + (current.fields.vin || ''), text: text }).catch(function () { /* user closed share */ });
      copyText(text); t.textContent = 'Copied (no share on this device)';
      return setTimeout(function () { t.textContent = 'Share'; }, 1800);
    }
    if (t.hasAttribute('data-load')) {
      var h = history[Number(t.getAttribute('data-load'))];
      if (!h) return;
      current = { fields: clone(h.fields), hints: clone(h.hints || {}) };
      handledVin = h.vin; state.vinText = h.vin;
      setMsg('Loaded saved scan for ' + h.vin + '.');
      renderForm(); renderHistory();
      var form = $('#form'); if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (t.hasAttribute('data-del')) {
      var gone = history.splice(Number(t.getAttribute('data-del')), 1)[0];
      storeHistory();
      if (gone && gone.vin === current.fields.vin) { current = blankRecord(); renderForm(); }
      return renderHistory();
    }
    if (t.id === 'clear-history') {
      if (!clearArmed) { clearArmed = true; return renderHistory(); }
      clearArmed = false; history = []; storeHistory(); return renderHistory();
    }
  });

  document.addEventListener('change', function (e) {
    if (!e.target || e.target.id !== 'tire-photo') return;
    var file = e.target.files && e.target.files[0];
    tire.file = file || null;
    if (tire.previewUrl && window.URL && URL.revokeObjectURL) URL.revokeObjectURL(tire.previewUrl);
    tire.previewUrl = file && window.URL && URL.createObjectURL ? URL.createObjectURL(file) : '';
    var preview = $('#tire-preview'), status = $('#tire-status');
    if (preview) { preview.src = tire.previewUrl; preview.hidden = !tire.previewUrl; }
    if (status && file) status.textContent = 'Photo ready. Tap “Read tire label”.';
  });

  // Gallery button for Read VIN from photo: sets the same photo the camera input would, then waits for the button.
  document.addEventListener('change', function (e) {
    if (!e.target || e.target.id !== 'vin-gallery') return;
    var picked = e.target.files && e.target.files[0], status = $('#vin-ocr-status');
    state.vinFile = null;
    if (!picked) return;
    state.ocrStatus = 'Loading photo…';
    if (status) status.textContent = state.ocrStatus;
    loadPicked(picked).then(function (file) {
      setVinPhoto(file, file.converted ? 'Photo ready (converted to JPEG). ' : '');
    }).catch(function (err) {
      state.ocrStatus = err.message;
      if (status) status.textContent = state.ocrStatus;
    });
  });

  // Edits to the form are saved to the recent-scans list as you go.
  document.addEventListener('change', function (e) {
    var el = e.target;
    if (el && el.hasAttribute && el.hasAttribute('data-field')) {
      var k = el.getAttribute('data-field');
      if (k === 'vin') return; // a new VIN goes through Decode VIN
      current.fields[k] = el.value.trim();
      delete current.hints[k];
      if (current.fields.vin) { saveRecord(current); renderHistory(); }
    }
  });

  function netBadge() {
    var n = $('#net'); if (!n) return;
    var on = navigator.onLine !== false;
    n.textContent = on ? 'Online' : 'Offline';
    n.classList.toggle('off', !on);
  }
  window.addEventListener('online', netBadge);
  window.addEventListener('offline', netBadge);

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ }); });
  }

  netBadge();
  renderVin();
  renderForm();
  renderHistory();

  // exposed for tests
  window.__vin = {
    state: state, current: function () { return current; }, history: function () { return history; },
    renderVin: renderVin, parseDoorSticker: parseDoorSticker, parseTirePlacard: parseTirePlacard, fillFromNhtsa: function (r) { fillFromNhtsa(r, E.parseVinDecode({ Results: [r] })); },
    extractBarcodeVin: extractBarcodeVin, extractVinCandidates: extractVinCandidates,
    nativeScannerAvailable: function () { var n = nativeVinScanner(); return !!(n && (n.scanBarcode || n.recognizeText)); }
  };
})();
