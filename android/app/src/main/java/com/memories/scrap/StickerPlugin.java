package com.memories.scrap;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmentation;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenter;
import com.google.mlkit.vision.segmentation.subject.SubjectSegmenterOptions;
import java.io.ByteArrayOutputStream;

@CapacitorPlugin(name = "StickerPlugin")
public class StickerPlugin extends Plugin {

    @PluginMethod
    public void createSticker(PluginCall call) {
        String base64Image = call.getString("base64Image");
        if (base64Image == null || base64Image.isEmpty()) {
            call.reject("base64Image is required");
            return;
        }

        try {
            // Strip data URL scheme prefix if present
            if (base64Image.contains(",")) {
                base64Image = base64Image.substring(base64Image.indexOf(",") + 1);
            }

            byte[] decodedString = Base64.decode(base64Image, Base64.DEFAULT);
            Bitmap inputBitmap = BitmapFactory.decodeByteArray(decodedString, 0, decodedString.length);
            
            if (inputBitmap == null) {
                call.reject("Invalid image data");
                return;
            }

            // Downscale to max 500px in native memory for optimal latency and safety bounds
            int maxDim = 500;
            int w = inputBitmap.getWidth();
            int h = inputBitmap.getHeight();
            if (w > maxDim || h > maxDim) {
                if (w > h) {
                    h = Math.round(((float) h * maxDim) / w);
                    w = maxDim;
                } else {
                    w = Math.round(((float) w * maxDim) / h);
                    h = maxDim;
                }
                inputBitmap = Bitmap.createScaledBitmap(inputBitmap, w, h, true);
            }

            InputImage image = InputImage.fromBitmap(inputBitmap, 0);

            SubjectSegmenterOptions options = new SubjectSegmenterOptions.Builder()
                    .enableForegroundBitmap()
                    .build();

            SubjectSegmenter segmenter = SubjectSegmentation.getClient(options);

            segmenter.process(image)
                .addOnSuccessListener(result -> {
                    Bitmap foregroundBitmap = result.getForegroundBitmap();
                    if (foregroundBitmap != null) {
                        ByteArrayOutputStream byteArrayOutputStream = new ByteArrayOutputStream();
                        // Compress to transparent PNG
                        foregroundBitmap.compress(Bitmap.CompressFormat.PNG, 90, byteArrayOutputStream);
                        byte[] byteArray = byteArrayOutputStream.toByteArray();
                        String encoded = Base64.encodeToString(byteArray, Base64.NO_WRAP);
                        
                        JSObject ret = new JSObject();
                        ret.put("stickerBase64", "data:image/png;base64," + encoded);
                        call.resolve(ret);
                    } else {
                        call.reject("Could not isolate subject from background");
                    }
                    segmenter.close();
                })
                .addOnFailureListener(e -> {
                    call.reject("Segmentation failed: " + e.getMessage(), e);
                    segmenter.close();
                });

        } catch (Exception e) {
            call.reject("Error running segmentation: " + e.getMessage(), e);
        }
    }
}
