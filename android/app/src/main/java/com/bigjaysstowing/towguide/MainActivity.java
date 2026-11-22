package com.bigjaysstowing.towguide;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.capacitorjs.plugins.camera.CameraPlugin;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle savedInstanceState) {
  registerPlugin(NativeVinScannerPlugin.class);
  registerPlugin(CameraPlugin.class);
  super.onCreate(savedInstanceState);
 }
}