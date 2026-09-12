package com.memories.scrap;

import android.os.Bundle;
import android.graphics.Color;
import com.getcapacitor.BridgeActivity;
import androidx.core.view.WindowCompat;
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
        super.onCreate(savedInstanceState);

        // Standard Android 15 / Jetpack Edge-to-Edge API
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

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
