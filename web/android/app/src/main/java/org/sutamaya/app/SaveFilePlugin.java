package org.sutamaya.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * SaveFilePlugin saves a file from the app's own storage wherever the reader picks in the system's
 * "Save as" picker: the device, Drive, or any other storage app.
 */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    /**
     * saveAs opens the picker for `file`, a file:// URI, suggesting its name; `type` is its MIME
     * type.
     */
    @PluginMethod
    public void saveAs(PluginCall call) {
        String file = call.getString("file");
        String type = call.getString("type");
        if (file == null || type == null) {
            call.reject("saveAs needs a file and a type");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(type)
            .putExtra(Intent.EXTRA_TITLE, new File(Uri.parse(file).getPath()).getName());
        startActivityForResult(call, intent, "saveAsResult");
    }

    /**
     * saveAsResult copies the file into the document the reader created, or resolves at once if
     * they dismissed the picker.
     */
    @ActivityCallback
    private void saveAsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Uri target = result.getData() == null ? null : result.getData().getData();
        if (result.getResultCode() != Activity.RESULT_OK || target == null) {
            call.resolve();
            return;
        }
        File source = new File(Uri.parse(call.getString("file")).getPath());
        execute(() -> {
            try (
                InputStream in = new FileInputStream(source);
                OutputStream out = getContext().getContentResolver().openOutputStream(target)
            ) {
                if (out == null) throw new FileNotFoundException("No stream for " + target);
                byte[] buffer = new byte[8192];
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not save the file", e);
            }
        });
    }
}
