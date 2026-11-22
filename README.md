# Christina’s Way Scanner

A simple Android-first vehicle intake form for office staff.

## Workflow
1. Scan a VIN barcode or take a photo of the VIN plate.
2. Decode the VIN with the public NHTSA vPIC API.
3. Optionally photograph the driver-door certification label to fill build date, VIN, GVWR, and axle ratings with on-device OCR.
4. Optionally photograph a license plate to read its visible plate text. No plate-owner or registration lookup is performed.
5. Review and edit one prefilled form. The app keeps only the six most recent vehicle records locally on that device.

## Data handling
- No account, server database, or cloud sync.
- The six-record history uses local device storage.
- Door-label and plate photos are processed on-device and are not uploaded by the app.
- VIN decoding sends the VIN to NHTSA vPIC. Results may be incomplete; unknown values remain blank.
- The form is editable. Staff must verify values against the vehicle labels and source documents.

## Development
This project is a standalone Capacitor Android app. It intentionally does not depend on Tow-App at runtime. The The native CameraX/ML Kit barcode scanner and ML Kit OCR plugin are copied from Tow-App with only the Java package changed. The VIN extraction, OCR image enhancement, two-pass photo recognition, and spatial label-aware parsing are also restored from Tow-App.

Run npm install, then npx cap sync android. The Android debug build can be generated with Gradle from the android directory.
