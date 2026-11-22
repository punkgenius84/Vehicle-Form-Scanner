package com.vehicleform.scanner;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.Bundle;
import android.util.Size;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.FocusMeteringAction;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanner;
import com.google.mlkit.vision.barcode.BarcodeScannerOptions;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.barcode.ZoomSuggestionOptions;
import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.common.InputImage;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Native continuous VIN barcode camera. CameraX owns the preview/lifecycle;
 * ML Kit analyzes the newest frame only. The same VIN must be seen in two
 * consecutive frames before it is returned to the Capacitor caller.
 */
public class NativeBarcodeScannerActivity extends AppCompatActivity {
    private static final int CAMERA_PERMISSION_REQUEST = 7314;
    private static final Pattern VIN_TOKEN = Pattern.compile("(?<![A-HJ-NPR-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-HJ-NPR-Z0-9])");

    private PreviewView previewView;
    private TextView statusView;
    private Button torchButton;
    private Button zoomButton;
    private Camera camera;
    private BarcodeScanner scanner;
    private ExecutorService cameraExecutor;
    private boolean torchEnabled = false;
    private volatile boolean finishedWithResult = false;
    private String previousCandidate = "";
    private int consecutiveMatches = 0;
    // Auto-zoom suggestions must never step backwards; ML Kit can issue multiple suggestions per scan.
    private float lastAutoZoomRatio = 1f;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        cameraExecutor = Executors.newSingleThreadExecutor();
        buildScannerUi();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera();
        } else {
            ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
        }
    }

    private void buildScannerUi() {
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF080B10);

        previewView = new PreviewView(this);
        previewView.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        previewView.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        root.addView(previewView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        root.addView(new AimOverlay(this), new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.VERTICAL);
        top.setPadding(dp(20), dp(18), dp(20), dp(12));
        top.setBackgroundColor(0x99000000);
        TextView title = new TextView(this);
        title.setText("SCAN VEHICLE VIN");
        title.setTextColor(0xFFFFFFFF);
        title.setTextSize(18);
        title.setGravity(Gravity.CENTER);
        top.addView(title);
        TextView hint = new TextView(this);
        hint.setText("Center the barcode in the guide. Move closer until it is sharp.");
        hint.setTextColor(0xFFE1E7EF);
        hint.setTextSize(13);
        hint.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams hintParams = new LinearLayout.LayoutParams(-1, -2);
        hintParams.topMargin = dp(6);
        top.addView(hint, hintParams);
        root.addView(top, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));

        LinearLayout bottom = new LinearLayout(this);
        bottom.setOrientation(LinearLayout.VERTICAL);
        bottom.setPadding(dp(16), dp(14), dp(16), dp(18));
        bottom.setBackgroundColor(0xDD080B10);

        statusView = new TextView(this);
        statusView.setText("Starting camera…");
        statusView.setTextColor(0xFFFFFFFF);
        statusView.setTextSize(14);
        statusView.setGravity(Gravity.CENTER);
        bottom.addView(statusView, new LinearLayout.LayoutParams(-1, -2));

        LinearLayout actions = new LinearLayout(this);
        actions.setGravity(Gravity.CENTER);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        torchButton = actionButton("Torch off");
        torchButton.setOnClickListener(v -> toggleTorch());
        actions.addView(torchButton, weightedButton());
        zoomButton = actionButton("Zoom +");
        zoomButton.setOnClickListener(v -> zoomIn());
        LinearLayout.LayoutParams zoomParams = weightedButton();
        zoomParams.leftMargin = dp(8);
        actions.addView(zoomButton, zoomParams);
        Button close = actionButton("Cancel");
        close.setOnClickListener(v -> finish());
        LinearLayout.LayoutParams closeParams = weightedButton();
        closeParams.leftMargin = dp(8);
        actions.addView(close, closeParams);
        LinearLayout.LayoutParams actionsParams = new LinearLayout.LayoutParams(-1, -2);
        actionsParams.topMargin = dp(12);
        bottom.addView(actions, actionsParams);

        FrameLayout.LayoutParams bottomParams = new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM);
        root.addView(bottom, bottomParams);
        previewView.setOnTouchListener((v, event) -> {
            if (event.getAction() == MotionEvent.ACTION_UP && camera != null) {
                try {
                    FocusMeteringAction action = new FocusMeteringAction.Builder(
                        previewView.getMeteringPointFactory().createPoint(event.getX(), event.getY()))
                        .setAutoCancelDuration(3, TimeUnit.SECONDS).build();
                    camera.getCameraControl().startFocusAndMetering(action);
                    statusView.setText("Focusing… hold steady");
                } catch (Exception ignored) { }
            }
            return true;
        });
        setContentView(root);
    }

    private Button actionButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(12);
        return button;
    }

    private LinearLayout.LayoutParams weightedButton() {
        return new LinearLayout.LayoutParams(0, dp(48), 1f);
    }

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void startCamera() {
        ListenableFuture<ProcessCameraProvider> providerFuture = ProcessCameraProvider.getInstance(this);
        providerFuture.addListener(() -> {
            try {
                ProcessCameraProvider provider = providerFuture.get();
                Preview preview = new Preview.Builder().build();
                preview.setSurfaceProvider(previewView.getSurfaceProvider());

                ImageAnalysis analysis = new ImageAnalysis.Builder()
                    .setTargetResolution(new Size(1920, 1080))
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build();

                provider.unbindAll();
                camera = provider.bindToLifecycle(
                    this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis);

                // ML Kit can detect a barcode region before it can decode its contents.
                // Give it the camera's real zoom limit so it can request closer frames
                // automatically instead of leaving the user stuck with an empty payload.
                float maxZoom = camera.getCameraInfo().getZoomState().getValue().getMaxZoomRatio();
                BarcodeScannerOptions options = new BarcodeScannerOptions.Builder()
                    .setBarcodeFormats(
                        Barcode.FORMAT_DATA_MATRIX,
                        Barcode.FORMAT_QR_CODE,
                        Barcode.FORMAT_PDF417,
                        Barcode.FORMAT_AZTEC,
                        Barcode.FORMAT_CODE_39,
                        Barcode.FORMAT_CODE_128,
                        Barcode.FORMAT_CODE_93,
                        Barcode.FORMAT_CODABAR,
                        Barcode.FORMAT_ITF
                    )
                    .enableAllPotentialBarcodes()
                    .setZoomSuggestionOptions(
                        new ZoomSuggestionOptions.Builder(zoomRatio -> {
                            if (camera == null || finishedWithResult) return false;
                            try {
                                float supportedMax = camera.getCameraInfo().getZoomState().getValue().getMaxZoomRatio();
                                float currentZoom = camera.getCameraInfo().getZoomState().getValue().getZoomRatio();
                                float targetZoom = Math.min(
                                    supportedMax,
                                    Math.max(currentZoom, Math.max(lastAutoZoomRatio, zoomRatio))
                                );
                                if (targetZoom > currentZoom + 0.05f) {
                                    lastAutoZoomRatio = targetZoom;
                                    camera.getCameraControl().setZoomRatio(targetZoom);
                                    runOnUiThread(() -> {
                                        if (!finishedWithResult) {
                                            statusView.setText("Barcode found. Zooming in to improve the read…");
                                        }
                                    });
                                }
                                return true;
                            } catch (Exception ignored) {
                                return false;
                            }
                        }).setMaxSupportedZoomRatio(maxZoom).build())
                    .build();
                scanner = BarcodeScanning.getClient(options);
                analysis.setAnalyzer(cameraExecutor, this::analyzeFrame);

                statusView.setText("Camera ready. Center the VIN barcode and hold steady.");
                if (!camera.getCameraInfo().hasFlashUnit()) {
                    torchButton.setEnabled(false);
                    torchButton.setText("No torch");
                }
                try {
                    FocusMeteringAction focus = new FocusMeteringAction.Builder(
                        previewView.getMeteringPointFactory().createPoint(0.5f, 0.5f))
                        .setAutoCancelDuration(5, TimeUnit.SECONDS).build();
                    camera.getCameraControl().startFocusAndMetering(focus);
                } catch (Exception ignored) { }
            } catch (Exception error) {
                statusView.setText("Could not start the Android camera: " + safeMessage(error));
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void analyzeFrame(@NonNull ImageProxy proxy) {
        if (finishedWithResult) {
            proxy.close();
            return;
        }
        android.media.Image mediaImage = proxy.getImage();
        if (mediaImage == null) {
            proxy.close();
            return;
        }
        InputImage input = InputImage.fromMediaImage(mediaImage, proxy.getImageInfo().getRotationDegrees());
        scanner.process(input)
            .addOnSuccessListener(barcodes -> handleBarcodes(barcodes))
            .addOnFailureListener(error -> runOnUiThread(() -> {
                if (!finishedWithResult) statusView.setText("Barcode reader issue: " + safeMessage(error));
            }))
            .addOnCompleteListener(task -> proxy.close());
    }

    private void handleBarcodes(List<Barcode> barcodes) {
        if (finishedWithResult || barcodes == null) return;
        for (Barcode barcode : barcodes) {
            String raw = barcode.getRawValue();
            if (raw == null || raw.isEmpty()) {
                byte[] rawBytes = barcode.getRawBytes();
                if (rawBytes != null && rawBytes.length > 0) {
                    raw = new String(rawBytes, java.nio.charset.StandardCharsets.UTF_8);
                }
            }
            String vin = findVin(raw);
            if (vin.isEmpty()) continue;
            if (vin.equals(previousCandidate)) consecutiveMatches++;
            else {
                previousCandidate = vin;
                consecutiveMatches = 1;
            }
            String format = formatName(barcode.getFormat());
            if (consecutiveMatches >= 2) {
                returnVin(raw, vin, format);
                return;
            }
            runOnUiThread(() -> {
                if (!finishedWithResult) statusView.setText("VIN candidate detected (" + format + "). Hold steady…");
            });
            return;
        }
        previousCandidate = "";
        consecutiveMatches = 0;
        if (!barcodes.isEmpty()) {
            Barcode detected = barcodes.get(0);
            String decoded = detected.getRawValue();
            if (decoded == null || decoded.isEmpty()) {
                byte[] bytes = detected.getRawBytes();
                if (bytes != null) decoded = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
            }
            String preview = decoded == null ? "" : decoded.replaceAll("[\\r\\n]+", " ").trim();
            if (preview.length() > 28) preview = preview.substring(0, 28) + "…";
            Rect bounds = detected.getBoundingBox();
            String symbolSize = bounds == null ? "size unknown" :
                bounds.width() + "×" + bounds.height() + " px";
            final String diagnostic = "Detected " + formatName(detected.getFormat()) + " (" + symbolSize +
                "), but no VIN payload was decoded. " +
                (preview.isEmpty() ? "Move closer, tap the barcode to focus, and hold steady." :
                    "Decoded data: " + preview);
            runOnUiThread(() -> {
                if (!finishedWithResult) statusView.setText(diagnostic);
            });
        }
    }

    private String findVin(String raw) {
        if (raw == null || raw.trim().isEmpty()) return "";
        String prepared = raw.toUpperCase(java.util.Locale.US)
            .replaceAll("^\\\\][A-Z][0-9]", " ")
            .replaceAll("[*]", " ");
        String[] tokens = prepared.split("[^A-Z0-9]+");
        String firstCandidate = "";
        String checksumCandidate = "";
        for (String original : tokens) {
            if (original.isEmpty()) continue;
            String token = original;
            if (token.startsWith("VIN") && token.length() > 3) token = token.substring(3);
            if (token.length() == 18 && token.charAt(0) == 'I') token = token.substring(1);
            if (token.length() == 17) {
                if (isStrictVin(token)) {
                    if (firstCandidate.isEmpty()) firstCandidate = token;
                    if (hasValidNorthAmericanCheckDigit(token)) checksumCandidate = token;
                }
                continue;
            }
            // Some manufacturer payloads append identifiers directly to the VIN.
            // Search within this decoded field only; never join adjacent fields.
            for (int i = 0; i <= token.length() - 17; i++) {
                String candidate = token.substring(i, i + 17);
                if (!isStrictVin(candidate)) continue;
                if (firstCandidate.isEmpty()) firstCandidate = candidate;
                if (hasValidNorthAmericanCheckDigit(candidate)) checksumCandidate = candidate;
            }
        }
        return !checksumCandidate.isEmpty() ? checksumCandidate : firstCandidate;
    }

    private boolean isStrictVin(String value) {
        return value != null && value.matches("[A-HJ-NPR-Z0-9]{17}") && value.matches(".*[0-9].*");
    }

    private boolean hasValidNorthAmericanCheckDigit(String vin) {
        if (!isStrictVin(vin)) return false;
        int[] weights = {8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2};
        int sum = 0;
        for (int i = 0; i < 17; i++) {
            char c = vin.charAt(i);
            int value;
            if (c >= '0' && c <= '9') value = c - '0';
            else {
                value = vinTransliterationValue(c);
                if (value < 0) return false;
            }
            sum += value * weights[i];
        }
        int remainder = sum % 11;
        return vin.charAt(8) == (remainder == 10 ? 'X' : (char)('0' + remainder));
    }

    private int vinTransliterationValue(char c) {
        switch (c) {
            case 'A': case 'J': return 1;
            case 'B': case 'K': case 'S': return 2;
            case 'C': case 'L': case 'T': return 3;
            case 'D': case 'M': case 'U': return 4;
            case 'E': case 'N': case 'V': return 5;
            case 'F': case 'W': return 6;
            case 'G': case 'P': case 'X': return 7;
            case 'H': case 'Y': return 8;
            case 'R': case 'Z': return 9;
            default: return -1;
        }
    }

    private String formatName(int format) {
        switch (format) {
            case Barcode.FORMAT_DATA_MATRIX: return "Data Matrix";
            case Barcode.FORMAT_QR_CODE: return "QR";
            case Barcode.FORMAT_PDF417: return "PDF417";
            case Barcode.FORMAT_AZTEC: return "Aztec";
            case Barcode.FORMAT_CODE_39: return "Code 39";
            case Barcode.FORMAT_CODE_128: return "Code 128";
            case Barcode.FORMAT_CODE_93: return "Code 93";
            case Barcode.FORMAT_CODABAR: return "Codabar";
            case Barcode.FORMAT_ITF: return "ITF";
            default: return "barcode";
        }
    }

    private void returnVin(String raw, String vin, String format) {
        if (finishedWithResult) return;
        finishedWithResult = true;
        Intent result = new Intent();
        result.putExtra("rawValue", raw);
        result.putExtra("vin", vin);
        result.putExtra("format", format);
        setResult(RESULT_OK, result);
        finish();
    }

    private void toggleTorch() {
        if (camera == null || !camera.getCameraInfo().hasFlashUnit()) return;
        torchEnabled = !torchEnabled;
        camera.getCameraControl().enableTorch(torchEnabled);
        torchButton.setText(torchEnabled ? "Torch on" : "Torch off");
    }

    private void zoomIn() {
        if (camera == null) return;
        try {
            float current = camera.getCameraInfo().getZoomState().getValue().getZoomRatio();
            float max = camera.getCameraInfo().getZoomState().getValue().getMaxZoomRatio();
            float next = Math.min(max, current * 1.35f);
            camera.getCameraControl().setZoomRatio(next);
            zoomButton.setText("Zoom " + String.format(java.util.Locale.US, "%.1fx", next));
        } catch (Exception ignored) { }
    }

    private String safeMessage(Throwable error) {
        String message = error == null ? null : error.getLocalizedMessage();
        return message == null || message.trim().isEmpty() ? "unknown error" : message;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_REQUEST) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) startCamera();
            else {
                setResult(RESULT_CANCELED, new Intent().putExtra("permissionDenied", true));
                finish();
            }
        }
    }

    @Override
    protected void onDestroy() {
        if (camera != null) {
            try { camera.getCameraControl().enableTorch(false); } catch (Exception ignored) { }
        }
        if (scanner != null) scanner.close();
        if (cameraExecutor != null) cameraExecutor.shutdown();
        super.onDestroy();
    }

    private static class AimOverlay extends View {
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        AimOverlay(AppCompatActivity context) {
            super(context);
            setLayerType(View.LAYER_TYPE_SOFTWARE, null);
            paint.setColor(0xEEFFFFFF);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(context.getResources().getDisplayMetrics().density * 2f);
        }
        @Override protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            float width = getWidth();
            float height = getHeight();
            float boxWidth = width * 0.72f;
            float boxHeight = Math.min(height * 0.24f, boxWidth * 0.55f);
            float left = (width - boxWidth) / 2f;
            float top = height * 0.47f - boxHeight / 2f;
            canvas.drawRoundRect(new RectF(left, top, left + boxWidth, top + boxHeight), 18f, 18f, paint);
        }
    }
}
