const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = fs.readFileSync('www/app.js','utf8');
const activity = fs.readFileSync('android/app/src/main/java/com/vehicleform/scanner/NativeBarcodeScannerActivity.java','utf8');
const plugin = fs.readFileSync('android/app/src/main/java/com/vehicleform/scanner/NativeVinScannerPlugin.java','utf8');
test('VIN decode uses NHTSA vPIC and leaves absent values blank',()=>{
 assert.match(app,/vpic\.nhtsa\.dot\.gov/);
 assert.match(app,/if\(v!==undefined&&v!==null&&String\(v\)\.trim\(\)!==''\)/);
});
test('local history is capped at six most recent vehicles',()=>{
 assert.match(app,/\.slice\(0,6\)/);
 assert.match(app,/vehicle-form-scanner\.history\.v1/);
});
test('native VIN scanner keeps CameraX and ML Kit implementation',()=>{
 assert.match(activity,/ProcessCameraProvider/);
 assert.match(activity,/BarcodeScanning\.getClient/);
 assert.match(activity,/consecutiveMatches >= 2/);
});
test('native OCR returns text and spatial line data',()=>{
 assert.match(plugin,/TextRecognition\.getClient/);
 assert.match(plugin,/response\.put\("lines", lines\)/);
});

test('restored Tow-App VIN extraction and two-pass OCR pipeline is present',()=>{
 assert.match(app,/extractVinCandidatesFromOcrResults/);
 assert.match(app,/prepareVinImage\(file,true\)/);
 assert.match(app,/recognizeCanvas/);
 assert.match(app,/extractBarcodeVin/);
});
test('tire and loading label scanning is not part of this app',()=>{
 const html=fs.readFileSync('www/index.html','utf8');
 assert.doesNotMatch(app,/tirePhoto|tireSize|tirePressure/);
 assert.doesNotMatch(html,/tire|loading label/i);
});
test('form contains VIN decoder and door label fields',()=>{
 for(const id of ['vin','year','make','model','gvwr','frontGawr','rearGawr']) assert.match(app,new RegExp("['\"]"+id+"['\"]"));
});

test('a different VIN clears prior vehicle values before decoding',()=>{
 assert.match(app,/function beginVin\(vin,src\)\{if\(record\.vin&&record\.vin!==vin\)\{record=\{\};sources=\{\}\}/);
});


test('application JavaScript parses before Android packaging',()=>{
 const { execFileSync } = require('node:child_process');
 execFileSync(process.execPath,['--check','www/app.js'],{stdio:'pipe'});
});
test('barcode button calls the registered native scanner and consumes its payload',()=>{
 const main=fs.readFileSync('android/app/src/main/java/com/vehicleform/scanner/MainActivity.java','utf8');
 assert.match(main,/registerPlugin\(NativeVinScannerPlugin\.class\)/);
 assert.match(app,/scanLiveBarcode\(\)/);
 assert.match(app,/r\.rawValue\|\|r\.vin\|\|r\.displayValue/);
 assert.match(plugin,/payload\.put\("rawValue", data\.getStringExtra\("rawValue"\)\)/);
});
test('photo OCR sends image data to the registered native ML Kit plugin',()=>{
 assert.match(app,/recognizeText\(\{imageBase64:/);
 assert.match(plugin,/call\.getString\("imageBase64"\)/);
 assert.match(plugin,/TextRecognition\.getClient/);
 assert.match(app,/prepareVinImage\(file,true\)/);
});
test('scanner Java files remain package-only copies of Tow-App implementation',()=>{
 const fs2=require('node:fs');
 const activityTow=fs2.readFileSync('tests/fixtures/TowApp-NativeBarcodeScannerActivity.java','utf8');
 const pluginTow=fs2.readFileSync('tests/fixtures/TowApp-NativeVinScannerPlugin.java','utf8');
 assert.equal(activity,activityTow.replaceAll('com.bigjaysstowing.towguide','com.vehicleform.scanner'));
 assert.equal(plugin,pluginTow.replaceAll('com.bigjaysstowing.towguide','com.vehicleform.scanner'));
});
