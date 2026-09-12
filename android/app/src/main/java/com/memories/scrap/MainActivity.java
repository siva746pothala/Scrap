package com.memories.scrap;

import android.os.Bundle;
import android.graphics.Color;
import com.getcapacitor.BridgeActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import io.capawesome.capacitorjs.plugins.mlkit.barcodescanning.BarcodeScannerPlugin;
import app.capgo.audiorecorder.CapacitorAudioRecorderPlugin;

import android.app.PictureInPictureParams;
import android.content.res.Configuration;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BarcodeScannerPlugin.class);
        registerPlugin(StickerPlugin.class);
        registerPlugin(CapacitorAudioRecorderPlugin.class);
        registerPlugin(DeviceLockPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        super.onCreate(savedInstanceState);

        // Override BridgeActivity's edge-to-edge to keep status bar visible
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);

        // Force white status bar at runtime (XML statusBarColor is ignored on Android 15+)
        getWindow().setStatusBarColor(Color.WHITE);
        WindowInsetsControllerCompat insetsController =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (insetsController != null) {
            insetsController.setAppearanceLightStatusBars(true); // dark icons on white bar
        }

        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().setHorizontalScrollBarEnabled(false);
            this.bridge.getWebView().setVerticalScrollBarEnabled(false);
            this.bridge.getWebView().setBackgroundColor(Color.BLACK);
        }
    }

    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            try {
                PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder();
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                    builder.setAutoEnterEnabled(true);
                }
                enterPictureInPictureMode(builder.build());
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
    }
}
