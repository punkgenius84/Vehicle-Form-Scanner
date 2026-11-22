# Vehicle Form Scanner

A simple Android-first vehicle intake form for office staff.

## Workflow
1. Scan a VIN barcode or take a photo of the VIN plate.
2. Decode the VIN with the public NHTSA vPIC API.
3. Optionally photograph the driver-door certification label and tire/loading label to fill additional fields with on-device OCR.
4. Optionally scan a license plate as a visual identifier only; no plate-owner or registration lookup is performed.
5. Review and edit one prefilled form. The app keeps only the six most recent vehicle records locally on that device.

## Data handling
- No account, server database, or cloud sync.
- The six-record history uses local device storage.
- Label photos are processed on-device and are not uploaded by the app.
- VIN decoding sends the VIN to NHTSA vPIC. Results may be incomplete; unknown values remain blank.
- The form is editable. Staff must verify values against the vehicle labels and source documents.

## Development
This project is a standalone Capacitor Android app. It intentionally does not depend on Tow-App at runtime. Scanner implementation is being ported from the working Tow-App native CameraX/ML Kit scanner without changing its scanning behavior.
