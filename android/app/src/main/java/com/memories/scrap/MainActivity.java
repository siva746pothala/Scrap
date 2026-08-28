package com.memories.scrap;

import android.os.Bundle;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import com.getcapacitor.BridgeActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import io.capawesome.capacitorjs.plugins.mlkit.barcodescanning.BarcodeScannerPlugin;
import app.capgo.audiorecorder.CapacitorAudioRecorderPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BarcodeScannerPlugin.class);
        registerPlugin(StickerPlugin.class);
        registerPlugin(CapacitorAudioRecorderPlugin.class);
        registerPlugin(DeviceLockPlugin.class);
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.LTGRAY);
        getWindow().setNavigationBarColor(Color.BLACK);

        addStatusBarScrim();

        // Keep the edge-to-edge system bar area black after the launch screen.
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().setHorizontalScrollBarEnabled(false);
            this.bridge.getWebView().setVerticalScrollBarEnabled(false);
            this.bridge.getWebView().setBackgroundColor(Color.BLACK);
        }
    }

    private void addStatusBarScrim() {
        View statusBarScrim = new View(this);
        statusBarScrim.setBackgroundColor(Color.LTGRAY);
        statusBarScrim.setClickable(false);

        FrameLayout content = findViewById(android.R.id.content);
        FrameLayout.LayoutParams layoutParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                Gravity.TOP);
        content.addView(statusBarScrim, layoutParams);

        ViewCompat.setOnApplyWindowInsetsListener(statusBarScrim, (view, insets) -> {
            int statusBarHeight = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top;
            ViewGroup.LayoutParams params = view.getLayoutParams();
            params.height = statusBarHeight;
            view.setLayoutParams(params);
            return insets;
        });
        ViewCompat.requestApplyInsets(statusBarScrim);
    }
}
