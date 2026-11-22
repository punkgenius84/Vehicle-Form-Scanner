# Big Jay's VIN Scanner

A standalone Android vehicle intake and technician reference app.

## Features
- Native Google Play Services barcode scanner through the registered Capacitor plugin.
- On-device ML Kit photo OCR for VIN and driver-door certification label details.
- NHTSA vPIC VIN decoding; absent values remain blank and all decoded/OCR values remain editable.
- Tire size and cold tire pressure fields when the photographed label contains readable values.
- Optional plate-photo text capture only; no owner or registration lookup.
- Last six saved vehicles stored locally on the device only.

## Native Android identity
- Display name: Big Jay's VIN Scanner
- Application ID: `com.bigjaysstowing.vinscanner`
- Java namespace: `com.bigjaysstowing.towguide`
- Capacitor plugin: `NativeVinScanner`

The Google Play Services barcode scanning module may need to install on first use. Keep Google Play services updated. The app does not include the Tow-App vehicle database or towing rules engine.

## Build
GitHub Actions runs the source tests and creates a debug APK. Download the artifact named `big-jays-vin-scanner-debug-apk` from the successful workflow run.
