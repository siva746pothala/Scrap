package com.memories.scrap;

import android.content.IntentSender;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private AppUpdateManager appUpdateManager;
    private static final int MY_REQUEST_CODE = 9001;
    private InstallStateUpdatedListener installStateUpdatedListener;

    @Override
    public void load() {
        super.load();
        appUpdateManager = AppUpdateManagerFactory.create(getContext());
    }

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        if (appUpdateManager == null) {
            appUpdateManager = AppUpdateManagerFactory.create(getContext());
        }

        appUpdateManager.getAppUpdateInfo().addOnSuccessListener(appUpdateInfo -> {
            JSObject ret = new JSObject();
            boolean updateAvailable = appUpdateInfo.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE;
            boolean flexibleAllowed = appUpdateInfo.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE);
            boolean immediateAllowed = appUpdateInfo.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE);

            ret.put("updateAvailable", updateAvailable);
            ret.put("availableVersionCode", appUpdateInfo.availableVersionCode());
            ret.put("flexibleAllowed", flexibleAllowed);
            ret.put("immediateAllowed", immediateAllowed);
            ret.put("installStatus", appUpdateInfo.installStatus());

            call.resolve(ret);
        }).addOnFailureListener(e -> {
            JSObject ret = new JSObject();
            ret.put("updateAvailable", false);
            ret.put("error", e.getMessage());
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void startFlexibleUpdate(PluginCall call) {
        if (appUpdateManager == null) {
            call.reject("AppUpdateManager not initialized");
            return;
        }

        // Register listener for download status
        if (installStateUpdatedListener != null) {
            appUpdateManager.unregisterListener(installStateUpdatedListener);
        }

        installStateUpdatedListener = state -> {
            JSObject statusObj = new JSObject();
            statusObj.put("bytesDownloaded", state.bytesDownloaded());
            statusObj.put("totalBytesToDownload", state.totalBytesToDownload());
            statusObj.put("installStatus", state.installStatus());

            if (state.installStatus() == InstallStatus.DOWNLOADED) {
                notifyListeners("onUpdateDownloaded", statusObj);
            } else {
                notifyListeners("onUpdateProgress", statusObj);
            }
        };

        appUpdateManager.registerListener(installStateUpdatedListener);

        appUpdateManager.getAppUpdateInfo().addOnSuccessListener(appUpdateInfo -> {
            if (appUpdateInfo.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                    && appUpdateInfo.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)) {
                try {
                    appUpdateManager.startUpdateFlowForResult(
                            appUpdateInfo,
                            AppUpdateType.FLEXIBLE,
                            getActivity(),
                            MY_REQUEST_CODE
                    );
                    JSObject ret = new JSObject();
                    ret.put("started", true);
                    call.resolve(ret);
                } catch (IntentSender.SendIntentException e) {
                    call.reject("Failed to start update flow: " + e.getMessage());
                }
            } else {
                call.reject("Flexible update not available");
            }
        }).addOnFailureListener(e -> call.reject(e.getMessage()));
    }

    @PluginMethod
    public void completeUpdate(PluginCall call) {
        if (appUpdateManager != null) {
            appUpdateManager.completeUpdate();
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } else {
            call.reject("AppUpdateManager null");
        }
    }
}
