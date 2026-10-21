package de.dmperformance.obd;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DiagSocketPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
