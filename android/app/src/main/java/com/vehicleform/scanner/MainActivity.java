package com.vehicleform.scanner;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle savedInstanceState) {
  registerPlugin(NativeVinScannerPlugin.class);
  super.onCreate(savedInstanceState);
 }
}