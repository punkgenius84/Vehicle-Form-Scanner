(function(){
'use strict';
var $=function(s){return document.querySelector(s)},status=$('#status');
var fields=[['vin','VIN'],['year','Model year'],['make','Make'],['model','Model'],['trim','Trim / series'],['engine','Engine displacement (L)'],['cylinders','Cylinders'],['fuel','Fuel type'],['drive','Drive type'],['transmission','Transmission'],['body','Body class'],['doors','Doors'],['manufacturer','Manufacturer'],['built','Build date'],['gvwr','GVWR'],['frontGawr','Front GAWR'],['rearGawr','Rear GAWR'],['tireSize','Tire size'],['tirePsi','Cold tire pressure (PSI)'],['plate','License plate'],['plateState','Plate state']];
var record={},sources={},HISTORY='vehicle-form-scanner.history.v1',nativeProxy=null;
function setStatus(s){status.textContent=s}
function put(k,v,src){if(v!==undefined&&v!==null&&String(v).trim()!==''){record[k]=String(v).trim();sources[k]=src}}
function render(){$('#fields').innerHTML=fields.map(function(f){return (f[0]==='tireSize'?'<div class="field-section">Tire details for technicians</div>':'')+'<div class="field"><label for="'+f[0]+'">'+f[1]+'</label><input id="'+f[0]+'" name="'+f[0]+'" autocomplete="off"><small>'+(sources[f[0]]||'Not provided')+'</small></div>'}).join('');fields.forEach(function(f){var el=$('#'+f[0]);el.value=record[f[0]]||'';el.addEventListener('input',function(){record[f[0]]=el.value})})}
function nativeVinScanner(){if(nativeProxy)return nativeProxy;var c=window.Capacitor;if(!c)return null;if(c.Plugins&&c.Plugins.NativeVinScanner)nativeProxy=c.Plugins.NativeVinScanner;else if(typeof c.registerPlugin==='function')nativeProxy=c.registerPlugin('NativeVinScanner');return nativeProxy}
async function decodeVin(vin){vin=String(vin||'').trim().toUpperCase();if(!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin))throw Error('VIN must be 17 valid characters (no I, O or Q).');setStatus('Decoding VIN with NHTSA…');var res=await fetch('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/'+encodeURIComponent(vin)+'?format=json');if(!res.ok)throw Error('NHTSA lookup failed ('+res.status+').');var d=((await res.json()).Results||[])[0]||{},map={year:d.ModelYear,make:d.Make,model:d.Model,trim:d.Trim||d.Series,engine:d.DisplacementL,cylinders:d.EngineCylinders,fuel:d.FuelTypePrimary,drive:d.DriveType,transmission:d.TransmissionStyle,body:d.BodyClass,doors:d.Doors,manufacturer:d.Manufacturer};Object.keys(map).forEach(function(k){put(k,map[k],'NHTSA VIN decoder')});put('vin',vin,'VIN scan');render();var n=Object.keys(map).filter(function(k){return !!record[k]}).length;setStatus('VIN decoded. NHTSA returned '+n+' of '+Object.keys(map).length+' vehicle fields. Verify all values; unreported fields remain blank.')}
function beginVin(vin,src){if(record.vin&&record.vin!==vin){record={};sources={}}put('vin',vin,src);render()}
function scanBarcode(){var p=nativeVinScanner();if(!p||typeof p.scanBarcode!=='function'){setStatus("Big Jay's native barcode scanner plugin is unavailable.");return}setStatus('Opening the original Big Jay’s Towing barcode scanner…');p.scanBarcode().then(function(r){if(!r||r.cancelled){setStatus(r&&r.permissionDenied?'Camera permission denied. Allow camera access and retry.':'Scan cancelled.');return}var raw=r.rawValue||r.vin||r.displayValue||'',vin=extractBarcodeVin(raw)||String(r.vin||'').toUpperCase();if(!vin){setStatus('Barcode detected, but no complete VIN was decoded. Center the barcode and hold steady.');return}beginVin(vin,'VIN barcode');return decodeVin(vin)}).catch(function(e){setStatus(e.message||'Barcode scan failed.')})}
function recognizeCanvas(canvas){var p=nativeVinScanner();if(!p||typeof p.recognizeText!=='function')return Promise.reject(Error('Original on-device OCR plugin is unavailable.'));return p.recognizeText({imageBase64:canvas.toDataURL('image/jpeg',.94).split(',')[1]||''})}
async function capturePhoto(source,processPhoto){var cam=window.NativeCamera;if(!cam||typeof cam.getPhoto!=='function'){setStatus('Android camera/gallery plugin is unavailable in this build.');return}try{setStatus(source==='PHOTOS'?'Opening device photo gallery…':'Opening device camera…');var p=await cam.getPhoto(source,{allowEditing:false,saveToGallery:false});if(!p||!p.base64String)throw Error('Android returned no image data.');var mime=p.format==='png'?'image/png':'image/jpeg',raw=atob(p.base64String),bytes=new Uint8Array(raw.length);for(var i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);var f=new File([bytes],'vehicle-photo.'+(p.format==='png'?'png':'jpg'),{type:mime,lastModified:Date.now()});await processPhoto(f)}catch(e){setStatus((e&&e.message)||'Could not capture or select the photo.')}}
async function readPhoto(file){if(!file||!/^image\//i.test(file.type))throw Error('Choose a valid image photo.');setStatus('Preparing photo for the original on-device OCR…');var enhanced=await prepareVinImage(file),a=await recognizeCanvas(enhanced),original=await prepareVinImage(file,true),b=await recognizeCanvas(original);return [a||{text:''},b||{text:''}]}
function parseDoor(readings){var all=readings.map(function(r){return r.text||''}).join('\n'),lines=all.toUpperCase().split(/\r?\n/),candidates=extractVinCandidatesFromOcrResults(readings);if(candidates.length)put('vin',candidates[0],'Door label OCR (verify)');function value(re){for(var i=0;i<lines.length;i++){if(re.test(lines[i])){var v=lines[i].replace(re,'').replace(/^\s*[:#-]?\s*/,'').trim();if(v)return v;if(lines[i+1])return lines[i+1].trim()}}return ''}function weight(v){var m=String(v||'').match(/[0-9][0-9,]*(?:\s*(?:LB|KG))?/i);return m?m[0]:''}put('built',value(/(?:DATE\s+OF\s+MFR|MFD|MANUFACTURED)/i),'Door certification label OCR');put('gvwr',weight(value(/\bGVWR\b/i)),'Door certification label OCR');put('frontGawr',weight(value(/(?:FRONT\s+GAWR|GAWR\s+F(?:RONT)?)/i)),'Door certification label OCR');put('rearGawr',weight(value(/(?:REAR\s+GAWR|GAWR\s+R(?:EAR)?)/i)),'Door certification label OCR');var flat=all.toUpperCase().replace(/\s+/g,' '),tire=flat.match(/\b(P|LT)?\s?(\d{3})\s*\/?\s*(\d{2})\s*Z?R\s*(\d{2})\b/);if(tire)put('tireSize',(tire[1]||'')+tire[2]+'/'+tire[3]+'R'+tire[4],'Door label OCR (verify)');var psi=[],psiRe=/\b(\d{2,3})\s*PSI\b/g,pm;while((pm=psiRe.exec(flat))!==null){var n=Number(pm[1]);if(n>=15&&n<=100&&psi.indexOf(n)===-1)psi.push(n)}if(psi.length)put('tirePsi',psi.join(' / '),'Door label OCR (verify)');return candidates}
async function photoVin(file,door){var readings=await readPhoto(file),candidates=extractVinCandidatesFromOcrResults(readings);if(door){if(candidates.length&&record.vin&&record.vin!==candidates[0]){record={};sources={}}var labelCandidates=parseDoor(readings);if(!candidates.length)candidates=labelCandidates}if(candidates.length){var vin=candidates[0];beginVin(vin,door?'Door label OCR':'VIN photo OCR');setStatus('VIN found by original OCR. Decoding vehicle information…');await decodeVin(vin)}else{render();setStatus('Original OCR read the photo but could not isolate a complete 17-character VIN. Retake closer, in focus, with the full VIN visible. No values were guessed.')}}
function history(){try{return JSON.parse(localStorage.getItem(HISTORY)||'[]').slice(0,6)}catch(e){return[]}}
function drawHistory(){var h=history();$('#history').innerHTML=h.length?h.map(function(x,i){var title=[x.year,x.make,x.model].filter(Boolean).join(' ')||'Saved vehicle';var details=fields.filter(function(f){return x[f[0]]}).map(function(f){var v=String(x[f[0]]).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]});return '<div class="saved-field"><b>'+f[1]+'</b><span>'+v+'</span></div>'}).join('');return '<details class="saved-record"><summary><span><b>'+title+'</b><br><small>'+String(x.vin||'No VIN')+'</small></span><small>'+new Date(x.savedAt).toLocaleDateString()+'</small></summary><div class="saved-details">'+details+'<button type="button" data-load="'+i+'">Load into form</button></div></details>'}).join(''):'No saved vehicles yet.';$('#history').querySelectorAll('[data-load]').forEach(function(b){b.addEventListener('click',function(){var x=h[+b.dataset.load];record={};sources={};fields.forEach(function(f){if(x[f[0]])record[f[0]]=x[f[0]]});render();setStatus('Loaded saved vehicle into editable form.')})})}
function save(){var item={};fields.forEach(function(f){item[f[0]]=$('#'+f[0]).value});if(!item.vin){setStatus('Add a VIN before saving.');return}var next=[Object.assign({},item,{savedAt:new Date().toISOString()})].concat(history().filter(function(x){return x.vin!==item.vin})).slice(0,6);localStorage.setItem(HISTORY,JSON.stringify(next));drawHistory();setStatus('Vehicle saved on this phone.')}
$('#barcode').addEventListener('click',scanBarcode);
$('#vinCamera').addEventListener('click',function(){capturePhoto('CAMERA',function(f){return photoVin(f,false).catch(function(e){setStatus(e.message||'VIN photo failed')})})});
$('#doorCamera').addEventListener('click',function(){capturePhoto('CAMERA',function(f){return photoVin(f,true).catch(function(e){setStatus(e.message||'Door label photo failed')})})});
$('#plateCamera').addEventListener('click',function(){capturePhoto('CAMERA',function(f){return processPlatePhoto(f).catch(function(e){setStatus(e.message||'Plate photo failed')})})});
$('#vinGallery').addEventListener('click',function(){capturePhoto('PHOTOS',function(f){return photoVin(f,false).catch(function(e){setStatus(e.message||'VIN photo failed')})})});
$('#doorGallery').addEventListener('click',function(){capturePhoto('PHOTOS',function(f){return photoVin(f,true).catch(function(e){setStatus(e.message||'Door label photo failed')})})});
$('#plateGallery').addEventListener('click',function(){capturePhoto('PHOTOS',function(f){return processPlatePhoto(f).catch(function(e){setStatus(e.message||'Plate photo failed')})})});
$('#vehicleForm').addEventListener('submit',function(e){e.preventDefault();save()});
$('#clear').addEventListener('click',function(){record={};sources={};render();setStatus('Form cleared.')});
render();drawHistory();if('serviceWorker'in navigator)window.addEventListener('load',function(){navigator.serviceWorker.register('./sw.js').catch(function(){})});
window.__bigJaysVinScanner={extractBarcodeVin:extractBarcodeVin,extractVinCandidates:extractVinCandidates,extractVinCandidatesFromOcrResults:extractVinCandidatesFromOcrResults,decodeVin:decodeVin};
function normalizeVinCandidate(raw) {
    var value = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (value.length !== 17) return '';
    // VINs cannot contain I, O or Q. OCR most often confuses O/Q with zero
    // and I with one; apply those substitutions only to OCR text, never barcodes.
    value = value.replace(/[OQ]/g, '0').replace(/I/g, '1');
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

function vinCandidateScore(vin, labelled) {
    var score = 0;
    // An explicit VIN label outweighs an incidental 17-character number elsewhere on the sticker.
    // Check-digit evidence ranks candidates only within the same evidence class.
    if (labelled) score += 10000;
    if (vinCheckDigitValid(vin)) score += 1000;
    // Position 9 is the North American check digit; position 10 is a model-year code.
    if (/^[0-9X]$/.test(vin.charAt(8))) score += 45;
    if (/^[ABCDEFGHJKLMNPRSTVWXY123456789]$/.test(vin.charAt(9))) score += 35;
    if (/^[A-HJ-NPR-Z0-9]{3}$/.test(vin.slice(0, 3)) && /[A-Z]/.test(vin.slice(0, 3))) score += 20;
    if (/\d/.test(vin.slice(11))) score += 10;
    return score;
  }

function extractVinCandidates(text) {
    var found = [], metadata = {}, lines = String(text || '').toUpperCase().split(/\r?\n/);
    function addCandidate(raw, labelled) {
      var candidate = normalizeVinCandidate(raw);
      if (!candidate) return;
      if (!metadata[candidate]) metadata[candidate] = { labelled: !!labelled };
      else if (labelled) metadata[candidate].labelled = true;
      if (found.indexOf(candidate) === -1) found.push(candidate);
    }
    function addLabelledWindows(raw) {
      var compact = String(raw || '').replace(/[^A-Z0-9]/g, '');
      for (var i = 0; i <= compact.length - 17; i++) addCandidate(compact.slice(i, i + 17), true);
    }
    lines.forEach(function (line, lineIndex) {
      // Capture exactly 17 OCR characters after a VIN label, allowing spaces
      // or hyphens between characters. Do not consume the rest of the sticker.
      var vinLabel = /\b(?:VIN(?:\s+(?:NO\.?|NUMBER))?|V1N|VEHICLE\s+IDENTIFICATION(?:\s+NUMBER|\s+NO\.?)?)(?=\s|[:#-]|$)/;
      var labelled = line.match(/\b(?:VIN(?:\s+(?:NO\.?|NUMBER))?|V1N|VEHICLE\s+IDENTIFICATION(?:\s+NUMBER|\s+NO\.?)?)\s*[:#-]?\s*((?:[A-Z0-9][\s-]?){17})/);
      if (labelled) addLabelledWindows(labelled[1]);
      else if (vinLabel.test(line)) {
        // Some OCR engines put the VIN label on one line and the number on
        // the next. Join at most the next two lines, and only accept exactly
        // 17 characters so weight/tire/manufacturing fields cannot bleed in.
        var nextLines = [lines[lineIndex + 1] || '', lines[lineIndex + 2] || ''];
        for (var count = 1; count <= 2; count++) {
          var followingText = nextLines.slice(0, count).join(' ');
          if (/\b(?:GVWR|GAWR|MFD|MFG|TIRE|PRESSURE|FRONT|REAR|PLANT|ASSEMBLED|KPA|PSI)\b/.test(followingText)) continue;
          var following = followingText.replace(/[^A-Z0-9]/g, '');
          if (following.length === 17) addCandidate(following, true);
        }
      }

      // Without a VIN label, accept only a standalone 17-character token
      // (or the known 18-character leading-I label prefix). Never slide a
      // 17-character window across an entire door-sticker line: that creates
      // convincing-looking VINs out of GVWR, tire and manufacturing fields.
      line.split(/[^A-Z0-9]+/).filter(Boolean).forEach(function (token) {
        if (token.length === 17) addCandidate(token, false);
        else if (token.length === 18 && token.charAt(0) === 'I') addCandidate(token.slice(1), false);
      });
    });
    return found.sort(function (a, b) {
      return vinCandidateScore(b, metadata[b].labelled) - vinCandidateScore(a, metadata[a].labelled);
    });
  }

function extractStructuredVinCandidates(reading) {
    var lines = reading && Array.isArray(reading.lines) ? reading.lines.slice() : [];
    lines = lines.filter(function (line) {
      return line && typeof line.text === 'string' &&
        isFinite(Number(line.left)) && isFinite(Number(line.top)) &&
        isFinite(Number(line.right)) && isFinite(Number(line.bottom));
    }).sort(function (a, b) {
      return Number(a.top) - Number(b.top) || Number(a.left) - Number(b.left);
    });
    var found = [];
    var labelPattern = /\b(?:VIN(?:\s+(?:NO\.?|NUMBER))?|V1N|VEHICLE\s+IDENTIFICATION(?:\s+NUMBER|\s+NO\.?)?)\b/i;
    lines.forEach(function (label, index) {
      if (!labelPattern.test(label.text)) return;
      var h = Math.max(1, Number(label.height) || Number(label.bottom) - Number(label.top));
      var pairs = [];
      lines.forEach(function (value, valueIndex) {
        if (valueIndex === index) return;
        var vh = Math.max(1, Number(value.height) || Number(value.bottom) - Number(value.top));
        var overlap = Math.max(0, Math.min(Number(label.bottom), Number(value.bottom)) -
          Math.max(Number(label.top), Number(value.top)));
        var overlapRatio = overlap / Math.max(1, Math.min(h, vh));
        var rightGap = Number(value.left) - Number(label.right);
        var sameRow = overlapRatio >= 0.30 && rightGap >= -h * 0.25 && rightGap <= h * 5;
        var belowGap = Number(value.top) - Number(label.bottom);
        var below = belowGap >= -h * 0.25 && belowGap <= h * 3.5 &&
          Math.abs(Number(value.left) - Number(label.left)) <= h * 4;
        if (sameRow || below) pairs.push({
          line: value, index: valueIndex,
          distance: sameRow ? Math.max(0, rightGap) : h * 5 + Math.max(0, belowGap)
        });
      });
      pairs.sort(function (x, y) { return x.distance - y.distance; });
      pairs.slice(0, 3).forEach(function (pair) {
        var pairedText = 'VIN: ' + pair.line.text;
        var next = lines[pair.index + 1];
        if (next) {
          var gap = Number(next.top) - Number(pair.line.bottom);
          var ph = Math.max(1, Number(pair.line.height) || Number(pair.line.bottom) - Number(pair.line.top));
          if (gap >= -ph * 0.2 && gap <= ph * 1.8 &&
              Math.abs(Number(next.left) - Number(pair.line.left)) <= ph * 3) {
            pairedText += '\n' + next.text;
          }
        }
        extractVinCandidates(pairedText).forEach(function (vin) {
          if (found.indexOf(vin) === -1) found.push(vin);
        });
      });
    });
    return found;
  }

function extractVinCandidatesFromOcrResults(readings) {
    var found = [], labelled = {};
    function add(vin, hasLabel) {
      if (found.indexOf(vin) === -1) found.push(vin);
      if (hasLabel) labelled[vin] = true;
    }
    (readings || []).forEach(function (reading) {
      var rawText = String(reading && reading.text || '');
      extractVinCandidates(rawText).forEach(function (vin) {
        var appearsBesideLabel = rawText.toUpperCase().split(/\r?\n/).some(function (line) {
          return /\b(?:VIN(?:\s+(?:NO\.?|NUMBER))?|V1N|VEHICLE\s+IDENTIFICATION(?:\s+NUMBER|\s+NO\.?)?)\b/.test(line) &&
            extractVinCandidates(line).indexOf(vin) !== -1;
        });
        add(vin, appearsBesideLabel);
      });
      extractStructuredVinCandidates(reading).forEach(function (vin) { add(vin, true); });
    });
    return found.sort(function (x, y) {
      return vinCandidateScore(y, !!labelled[y]) - vinCandidateScore(x, !!labelled[x]);
    });
  }

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

function prepareVinImage(file, preserveOriginal) {
    return new Promise(function (resolve, reject) {
      var url = window.URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(2, 3200 / Math.max(img.naturalWidth, img.naturalHeight));
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          var ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) throw new Error('Could not prepare the photo for text recognition.');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          if (!preserveOriginal) {
            var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
            var data = pixels.data;
            for (var i = 0; i < data.length; i += 4) {
              var gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
              // Lift midtones and increase contrast so stamped/printed VIN characters stand out.
              var enhanced = Math.max(0, Math.min(255, (gray - 128) * 1.55 + 128));
              data[i] = data[i + 1] = data[i + 2] = enhanced;
            }
            ctx.putImageData(pixels, 0, 0);
          }
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
})();