# Vehicle Form Scanner (Big Jay's VIN Scanner)

Scan a VIN barcode or snap a photo of the door sticker / VIN plate, and the app fills a vehicle info form on the phone. It keeps your last 6 scans.

## How it works

The scan panel is the tow app's VIN panel, unchanged: **Start barcode scan**, **Read VIN from photo** (take the photo, then tap the button), and **Enter VIN manually** with **Decode VIN**. What is new is the form below it:

1. When a scan, photo or Decode VIN produces a VIN, it is looked up with the free NHTSA service and the form fills in: year, make, model, trim, series, body, vehicle type, doors, GVWR class, engine, fuel, powertrain, drive, transmission, brakes, manufacturer and assembly plant.
2. If the photo was of a door sticker, the text the OCR already read is also checked for **GVWR, front and rear GAWR, build month/year, tire size and cold tire pressure**. If no VIN could be read in that photo, the values are still added but flagged "confirm same vehicle".
3. If NHTSA has no curb weight or wheelbase, typical values from the tow app's vehicle database are used when the model is listed, labelled "Typical for … - verify".
4. **Tire pressure label**: its own photo spot. Take a photo of the tire and loading label, tap **Read tire label**, and it fills front, rear and spare tire sizes and cold pressures, seating capacity and max occupants + cargo weight. Only those fields change; everything else on the form stays. It works before or after the VIN scan, and the values are saved with the vehicle once the VIN is on the form.
5. **Read VIN from photo** has a **Choose photo from gallery** button next to the camera. A gallery photo goes to the same photo reader as a camera photo; you still tap Read VIN from photo.
6. Every field is editable and saves automatically. **Copy all** / **Share** send the info.
6. **Last 6 scans** are stored on the phone. Tap one to reload it, ✕ to remove it, **Clear recent scans** twice to clear all.

The small note under each field says where the value came from.

## Data handling
- No account, server database, or cloud sync.
- The six-record history uses local device storage.
- Label photos are processed on-device and are not uploaded by the app.
- VIN decoding sends the VIN to NHTSA vPIC. Results may be incomplete; unknown values remain blank.
- The form is editable. Staff must verify values against the vehicle labels and source documents.

## Code reuse from the tow app

The scanner is copied **line-for-line, unchanged** from the current Tow-App on GitHub (`main` @ `ba33f3a`):
- `www/app.js`: `copyText` (lines 228-236), all VIN scanning and OCR code (lines 284-781) and the `vin-photo` change handler (lines 917-928), marked `COPIED UNCHANGED` in this app's `www/app.js`
- `NativeVinScannerPlugin.java`, `NativeBarcodeScannerActivity.java` (continuous CameraX + ML Kit barcode scanner), `MainActivity.java`, `AndroidManifest.xml`, `proguard-rules.pro`
- the CameraX / ML Kit dependencies in `android/app/build.gradle`

`engine.js` and `data.js` are also identical. The form code only reads what the scanner puts in `state.vinText` / `state.ocrRaw`.

The Android `namespace` stays `com.bigjaysstowing.towguide` so the Java files need no edits; the **applicationId** is `com.bigjaysstowing.vinscanner`, so this installs alongside the tow app.

## Build the APK (no npm needed on your PC)

Upload this folder to a GitHub repo. The workflow in `.github/workflows/build-apk.yml` builds it on GitHub: open the **Actions** tab, wait for the green check, and download **VinScanner-debug-apk** from the run. Every build is signed with the same key (`android/app/debug.keystore`), so a new APK installs over the old one and keeps your saved scans.

## Tests

`npm test` simulates a native barcode scan, a door-sticker photo, the NHTSA decode, manual entry, editing and the 6-scan limit.
