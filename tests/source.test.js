const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const app=fs.readFileSync('www/app.js','utf8');
const html=fs.readFileSync('www/index.html','utf8');
const gradle=fs.readFileSync('android/app/build.gradle','utf8');
const manifest=fs.readFileSync('android/app/src/main/AndroidManifest.xml','utf8');
const plugin=fs.readFileSync('android/app/src/main/java/com/bigjaysstowing/towguide/NativeVinScannerPlugin.java','utf8');
const main=fs.readFileSync('android/app/src/main/java/com/bigjaysstowing/towguide/MainActivity.java','utf8');
const camera=fs.readFileSync('camera-entry.js','utf8');
const barcodeActivity=fs.readFileSync('android/app/src/main/java/com/bigjaysstowing/towguide/NativeBarcodeScannerActivity.java','utf8');
test('Big Jay identity and Java namespace stay consistent',()=>{
 assert.ok(html.includes("BIG JAY'S VIN SCANNER"));
 assert.ok(gradle.includes('com.bigjaysstowing.towguide'));
 assert.ok(gradle.includes('com.bigjaysstowing.vinscanner'));
 assert.ok(plugin.includes('package com.bigjaysstowing.towguide'));
 assert.ok(main.includes('registerPlugin(NativeVinScannerPlugin.class)'));
 assert.ok(!main.includes('CameraPlugin.class'));
 assert.ok(fs.readFileSync('android/settings.gradle','utf8').includes("apply from: 'capacitor.settings.gradle'"));
 assert.ok(!html.includes('christina.jpg'));
 assert.ok(html.includes('icons/icon.svg'));
 assert.ok(manifest.includes("Big Jay's VIN Scanner"));
 assert.ok(manifest.includes('androidx.core.content.FileProvider'));
 assert.ok(manifest.includes('${applicationId}.fileprovider'));
 const filePaths=fs.readFileSync('android/app/src/main/res/xml/file_paths.xml','utf8');
 assert.ok(filePaths.includes('<cache-path'));
 assert.ok(filePaths.includes('<external-path'));
});
test('Google Play barcode scanner and ML Kit OCR are connected',()=>{
 assert.ok(plugin.includes('public void scanLiveBarcode'));
 assert.ok(plugin.includes('startActivityForResult(call, intent, "scanLiveBarcodeResult")'));
 assert.ok(plugin.includes('public void recognizeText'));
 assert.ok(plugin.includes('response.put("lines", lines)'));
 assert.ok(barcodeActivity.includes('CameraSelector.DEFAULT_BACK_CAMERA'));
 assert.ok(barcodeActivity.includes('BarcodeScanning.getClient(options)'));
 assert.ok(barcodeActivity.includes('consecutiveMatches >= 2'));
 assert.ok(app.includes('p.scanLiveBarcode()'));
 assert.ok(app.includes('r.vin'));
 assert.ok(app.includes('recognizeText({imageBase64:'));
});
test('tire size and cold pressure fields are captured',()=>{
 assert.ok(app.includes('tireSize'));
 assert.ok(app.includes('tirePsi'));
 assert.ok(app.includes('Cold tire pressure'));
 assert.ok(html.includes('recommended cold tire pressure'));
});
test('vehicle database is not loaded',()=>{
 assert.ok(!html.includes('data.js'));
 assert.ok(!html.includes('engine.js'));
 assert.ok(!app.includes('TowEngine'));
 assert.ok(!app.includes('TowData'));
});
test('recent vehicle history remains local and capped at six',()=>{
 assert.ok(app.includes('localStorage'));
 assert.ok(app.includes('.slice(0,6)'));
});
test('app JavaScript parses before Android packaging',()=>{
 require('node:child_process').execFileSync(process.execPath,['--check','www/app.js']);
});

test('camera buttons use the native Camera plugin separately from gallery selection',()=>{
 assert.ok(html.includes('id="vinCamera"'));
 assert.ok(html.includes('id="doorCamera"'));
 assert.ok(html.includes('id="plateCamera"'));
 assert.ok(html.includes('camera.bundle.js'));
 assert.ok(camera.includes("@capacitor/camera"));
 assert.ok(camera.includes('CameraSource.Photos'));
 assert.ok(app.includes("capturePhoto('PHOTOS'"));
 assert.ok(app.includes('rawBytesBase64'));
 assert.ok(plugin.includes('response.put("lines", lines)'));
 assert.ok(gradle.includes('androidx.camera:camera-camera2'));
 assert.ok(gradle.includes("apply from: 'capacitor.build.gradle'"));
 assert.ok(manifest.includes('.NativeBarcodeScannerActivity'));
 assert.ok(fs.readFileSync('www/sw.js','utf8').includes('big-jays-vin-scanner-v2'));
 assert.ok(app.includes('window.NativeCamera'));
 assert.ok(app.includes("$('#plateCamera').addEventListener"));
 assert.ok(app.includes("$('#vinGallery').addEventListener"));
 assert.ok(app.includes("$('#doorGallery').addEventListener"));
 assert.ok(app.includes("$('#plateGallery').addEventListener"));
});
test('saved vehicle cards expand and load every saved field',()=>{
 assert.ok(app.includes('<details class="saved-record">'));
 assert.ok(app.includes('data-load='));
 assert.ok(app.includes('Loaded saved vehicle into editable form.'));
});
