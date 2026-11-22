package com.vehicleform.scanner;

import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import com.google.mlkit.vision.common.InputImage;

@CapacitorPlugin(name = "NativeVinScanner")
public class NativeVinScannerPlugin extends Plugin {

    @PluginMethod
    public void scanLiveBarcode(PluginCall call) {
        Intent intent = new Intent(getContext(), NativeBarcodeScannerActivity.class);
        startActivityForResult(call, intent, "scanLiveBarcodeResult");
    }

    @ActivityCallback
    private void scanLiveBarcodeResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != android.app.Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            cancelled.put("permissionDenied", result.getData() != null && result.getData().getBooleanExtra("permissionDenied", false));
            call.resolve(cancelled);
            return;
        }
        Intent data = result.getData();
        JSObject payload = new JSObject();
        payload.put("cancelled", false);
        payload.put("rawValue", data.getStringExtra("rawValue"));
        payload.put("vin", data.getStringExtra("vin"));
        payload.put("format", data.getStringExtra("format"));
        call.resolve(payload);
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

            // JS normalizes EXIF orientation before exporting this JPEG.
            InputImage image = InputImage.fromBitmap(bitmap, 0);
            recognizer.process(image)
                .addOnSuccessListener(getActivity(), text -> {
                    JSObject response = new JSObject();
                    response.put("text", text.getText());
                    // Preserve ML Kit's spatial OCR data; flat text loses the relationship
                    // between a VIN label and a value printed beside it.
                    JSArray lines = new JSArray();
                    for (com.google.mlkit.vision.text.Text.TextBlock block : text.getTextBlocks()) {
                        for (com.google.mlkit.vision.text.Text.Line line : block.getLines()) {
                            JSObject item = new JSObject();
                            item.put("text", line.getText());
                            item.put("angle", line.getAngle());
                            item.put("confidence", line.getConfidence());
                            Rect bounds = line.getBoundingBox();
                            if (bounds != null) {
                                item.put("left", bounds.left);
                                item.put("top", bounds.top);
                                item.put("right", bounds.right);
                                item.put("bottom", bounds.bottom);
                                item.put("width", bounds.width());
                                item.put("height", bounds.height());
                            }
                            lines.put(item);
                        }
                    }
                    response.put("lines", lines);
                    call.resolve(response);
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
