# Vehicle Form Scanner (Big Jay's VIN Scanner)

Scan a VIN barcode or snap a photo of the door sticker / VIN plate, and the app fills a vehicle info form on the phone. It keeps your last 6 scans.

## How it works

The scan panel is the tow app's VIN panel, unchanged: **Start barcode scan**, **Read VIN from photo** (take the photo, then tap the button), and **Enter VIN manually** with **Decode VIN**. What is new is the form below it:

1. When a scan, photo or Decode VIN produces a VIN, it is looked up with the free NHTSA service and the form fills in: year, make, model, trim, series, body, vehicle type, doors, GVWR class, engine, fuel, powertrain, drive, transmission, brakes, manufacturer and assembly plant.
2. If the photo was of a door sticker, the text the OCR already read is also checked for **GVWR, front and rear GAWR, build month/year, tire size and cold tire pressure**. If no VIN could be read in that photo, the values are still added but flagged "confirm same vehicle".
3. If NHTSA has no curb weight or wheelbase, typical values from the tow app's vehicle database are used when the model is listed, labelled "Typical for … - verify".
4. Every field is editable and saves automatically. **Copy all** / **Share** send the info.
5. **Last 6 scans** are stored on the phone. Tap one to reload it, ✕ to remove it, **Clear recent scans** twice to clear all.

The small note under each field says where the value came from.

## Data handling
- No account, server database, or cloud sync.
- The six-record history uses local device storage.
- Label photos are processed on-device and are not uploaded by the app.
- VIN decoding sends the VIN to NHTSA vPIC. Results may be incomplete; unknown values remain blank.
- The form is editable. Staff must verify values against the vehicle labels and source documents.

## Code reuse from the tow app

The scanning code is copied **line-for-line, unchanged** from `tow-app/www/app.js`:
- `copyText` / `fallbackCopy` (lines 228-236)
- VIN extraction, check digit, barcode engine, native scanner bridge, `startBarcodeScan`, OCR engine and `scanVinPhoto` (lines 284-645)
- the `vin-photo` change handler (lines 781-792)

It is marked `COPIED UNCHANGED` in `www/app.js`. `NativeVinScannerPlugin.java` and `MainActivity.java` are byte-identical to the tow app, and so are `engine.js` and `data.js`. The new code only reads what the scanner puts into `state.vinText` / `state.ocrRaw`.

The Android `namespace` stays `com.bigjaysstowing.towguide` so the Java files did not need to change. The **applicationId** is `com.bigjaysstowing.vinscanner`, so this installs alongside the tow app instead of replacing it.

## Build the APK (no npm needed on your PC)

Upload this folder to a GitHub repo. The workflow in `.github/workflows/build-apk.yml` builds it on GitHub: open the **Actions** tab, wait for the green check, and download **VinScanner-debug-apk** from the run. Every build is signed with the same key (`android/app/debug.keystore`), so a new APK installs over the old one and keeps your saved scans.

## Tests

`npm test` simulates a native barcode scan, a door-sticker photo, the NHTSA decode, manual entry, editing and the 6-scan limit.
