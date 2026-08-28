package com.memories.scrap;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "DeviceLock")
public class DeviceLockPlugin extends Plugin {

    @PluginMethod
    public void showLockScreen(PluginCall call) {
        Context context = getContext();
        KeyguardManager keyguardManager = (KeyguardManager) context.getSystemService(Context.KEYGUARD_SERVICE);
        
        if (keyguardManager == null) {
            JSObject ret = new JSObject();
            ret.put("status", "success");
            call.resolve(ret);
            return;
        }

        if (!keyguardManager.isDeviceSecure()) {
            JSObject ret = new JSObject();
            ret.put("status", "no_secure");
            call.resolve(ret);
            return;
        }

        Intent intent = keyguardManager.createConfirmDeviceCredentialIntent(
            "Scrap App",
            "Please confirm your credentials to unlock your Scrap Vault."
        );

        if (intent != null) {
            startActivityForResult(call, intent, "handleLockResult");
        } else {
            JSObject ret = new JSObject();
            ret.put("status", "success");
            call.resolve(ret);
        }
    }

    @ActivityCallback
    private void handleLockResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        
        JSObject ret = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK) {
            ret.put("status", "success");
        } else {
            ret.put("status", "failed");
        }
        call.resolve(ret);
    }
    @PluginMethod
    public void enableScreenshotProtection(PluginCall call) {
        getBridge().executeOnMainThread(new Runnable() {
            @Override
            public void run() {
                try {
                    getActivity().getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject(e.getMessage());
                }
            }
        });
    }

    @PluginMethod
    public void disableScreenshotProtection(PluginCall call) {
        getBridge().executeOnMainThread(new Runnable() {
            @Override
            public void run() {
                try {
                    getActivity().getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);
                    JSObject ret = new JSObject();
                    ret.put("success", true);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject(e.getMessage());
                }
            }
        });
    }
}
