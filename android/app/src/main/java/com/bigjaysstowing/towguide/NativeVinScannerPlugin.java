package com.bigjaysstowing.towguide;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.moduleinstall.ModuleInstall;
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest;
import com.google.android.gms.common.moduleinstall.ModuleInstallClient;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

@CapacitorPlugin(name = "NativeVinScanner")
public class NativeVinScannerPlugin extends Plugin {

    private static final long MODULE_CHECK_INTERVAL_MS = 750L;
    private static final int MAX_MODULE_CHECKS = 80;

    @PluginMethod
    public void scanBarcode(PluginCall call) {
        // Ask ML Kit to accept every standard format. VIN labels vary by
        // manufacturer and may use formats beyond the common Code 39/PDF417.
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(Barcode.FORMAT_ALL_FORMATS)
            .enableAutoZoom()
            .build();

        GmsBarcodeScanner scanner = GmsBarcodeScanning.getClient(getContext(), options);
        ModuleInstallClient moduleInstallClient = ModuleInstall.getClient(getContext());

        // A sideloaded APK may not have received the Play-services scanner UI
        // module at install time. Explicitly request it and wait until ready
        // before opening the camera; otherwise the first scan can be a no-op.
        moduleInstallClient.areModulesAvailable(scanner)
            .addOnSuccessListener(getActivity(), availability -> {
                if (availability.areModulesAvailable()) {
                    launchScanner(scanner, call);
                    return;
                }

                ModuleInstallRequest request = ModuleInstallRequest.newBuilder()
                    .addApi(scanner)
                    .build();

                moduleInstallClient.installModules(request)
                    .addOnSuccessListener(getActivity(), response -> {
                        if (response.areModulesAlreadyInstalled()) {
                            launchScanner(scanner, call);
                        } else {
                            waitForScannerModule(moduleInstallClient, scanner, call, 0);
                        }
                    })
                    .addOnFailureListener(getActivity(), error ->
                        call.reject("Could not install Google's barcode scanner module: "
                            + error.getMessage(), error));
            })
            .addOnFailureListener(getActivity(), error ->
                call.reject("Could not check barcode scanner availability: "
                    + error.getMessage(), error));
    }

    private void waitForScannerModule(
        ModuleInstallClient client,
        GmsBarcodeScanner scanner,
        PluginCall call,
        int attempt
    ) {
        if (attempt >= MAX_MODULE_CHECKS) {
            call.reject("Google's barcode scanner module did not finish installing. "
                + "Check that Google Play services is updated and try again.");
            return;
        }

        new Handler(Looper.getMainLooper()).postDelayed(() ->
            client.areModulesAvailable(scanner)
                .addOnSuccessListener(getActivity(), availability -> {
                    if (availability.areModulesAvailable()) {
                        launchScanner(scanner, call);
                    } else {
                        waitForScannerModule(client, scanner, call, attempt + 1);
                    }
                })
                .addOnFailureListener(getActivity(), error ->
                    call.reject("Could not verify barcode scanner installation: "
                        + error.getMessage(), error)),
            MODULE_CHECK_INTERVAL_MS);
    }

    private void launchScanner(GmsBarcodeScanner scanner, PluginCall call) {
        scanner.startScan()
            .addOnSuccessListener(getActivity(), barcode -> {
                JSObject result = new JSObject();
                result.put("rawValue", barcode.getRawValue());
                result.put("format", barcode.getFormat());
                call.resolve(result);
            })
            .addOnCanceledListener(getActivity(), () ->
                call.reject("Barcode scan cancelled."))
            .addOnFailureListener(getActivity(), error ->
                call.reject("Barcode scanner failed: " + error.getMessage(), error));
    }

    @PluginMethod
    public void recognizeText(PluginCall call) {
        String encoded = call.getString("imageBase64");
        if (encoded == null || encoded.trim().isEmpty()) {
            call.reject("No image was supplied for VIN recognition.");
            return;
        }

        TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        try {
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bitmap == null) {
                recognizer.close();
                call.reject("The selected photo could not be decoded.");
                return;
            }

            InputImage image = InputImage.fromBitmap(bitmap, 0);
            recognizer.process(image)
                .addOnSuccessListener(getActivity(), text -> {
                    JSObject result = new JSObject();
                    result.put("text", text.getText());
                    call.resolve(result);
                })
                .addOnFailureListener(getActivity(), error ->
                    call.reject("Android text recognition failed: " + error.getMessage(), error))
                .addOnCompleteListener(task -> {
                    recognizer.close();
                    bitmap.recycle();
                });
        } catch (Exception error) {
            recognizer.close();
            call.reject("Could not prepare the photo for recognition: " + error.getMessage(), error);
        }
    }
}
