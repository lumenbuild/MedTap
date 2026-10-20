package app.medtap.nativeplugin;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.UriPermission;
import android.net.Uri;
import android.nfc.FormatException;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.TagLostException;
import android.nfc.tech.Ndef;
import android.nfc.tech.NdefFormatable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcelable;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.Settings;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import androidx.documentfile.provider.DocumentFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;

/**
 * NFC for MedTap on Android, using reader mode while the app is open:
 * - tag taps while the app is open are sent to JavaScript as "tag" events (after nfcListen);
 * - a tag that launches the app (NDEF_DISCOVERED intent, see AndroidManifest) is sent the same way;
 * - nfcWrite / nfcRead wait for the next tag and use it instead.
 * Error codes match NfcErrorKind in src/nfc/write.ts.
 * Also printing, sharing, and a folder for automatic backups (Android's storage access framework).
 */
@CapacitorPlugin(name = "MedTapNative")
public class MedTapNativePlugin extends Plugin implements NfcAdapter.ReaderCallback {

    private NfcAdapter adapter;
    private boolean listening = false;
    private boolean resumed = true;
    private PluginCall pending;
    private String writeUrl;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Runnable timeout;

    @Override
    public void load() {
        adapter = NfcAdapter.getDefaultAdapter(getContext());
        handleLaunchIntent(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handleLaunchIntent(intent);
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        resumed = true;
        updateReaderMode();
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        resumed = false;
        if (adapter != null) adapter.disableReaderMode(getActivity());
    }

    /** A tag tapped while the app was closed or in the background. */
    private void handleLaunchIntent(Intent intent) {
        if (intent == null || !NfcAdapter.ACTION_NDEF_DISCOVERED.equals(intent.getAction())) return;
        String url = intent.getDataString();
        if (url == null) {
            Parcelable[] raw = Build.VERSION.SDK_INT >= 33
                ? intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES, NdefMessage.class)
                : intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES);
            if (raw != null && raw.length > 0) url = urlFrom((NdefMessage) raw[0]);
        }
        intent.setAction(Intent.ACTION_MAIN); // handled; don't repeat if the activity is recreated
        emitTag(url);
    }

    private void emitTag(String url) {
        JSObject o = new JSObject();
        o.put("url", url);
        notifyListeners("tag", o, true);
    }

    private static String urlFrom(NdefMessage msg) {
        if (msg == null) return null;
        for (NdefRecord r : msg.getRecords()) {
            Uri u = r.toUri();
            if (u != null) return u.toString();
        }
        return null;
    }

    private void updateReaderMode() {
        main.post(() -> {
            if (adapter == null || getActivity() == null) return;
            if (resumed && (listening || pending != null)) {
                int flags = NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_NFC_B | NfcAdapter.FLAG_READER_NFC_F | NfcAdapter.FLAG_READER_NFC_V;
                adapter.enableReaderMode(getActivity(), this, flags, null);
            } else {
                adapter.disableReaderMode(getActivity());
            }
        });
    }

    // ---- JavaScript API ----

    @PluginMethod
    public void nfcStatus(PluginCall call) {
        JSObject o = new JSObject();
        o.put("supported", adapter != null);
        o.put("enabled", adapter != null && adapter.isEnabled());
        call.resolve(o);
    }

    @PluginMethod
    public void nfcListen(PluginCall call) {
        listening = true;
        updateReaderMode();
        call.resolve();
    }

    @PluginMethod
    public void nfcWrite(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("No link to write", "io"); return; }
        begin(call, url);
    }

    @PluginMethod
    public void nfcRead(PluginCall call) {
        begin(call, null);
    }

    @PluginMethod
    public void nfcCancel(PluginCall call) {
        finishError("Cancelled", "cancelled");
        call.resolve();
    }

    @PluginMethod
    public void openNfcSettings(PluginCall call) {
        getActivity().startActivity(new Intent(Settings.ACTION_NFC_SETTINGS));
        call.resolve();
    }

    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "MedTap");
        main.post(() -> {
            PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            PrintDocumentAdapter doc = getBridge().getWebView().createPrintDocumentAdapter(name);
            pm.print(name, doc, new PrintAttributes.Builder().build());
            call.resolve();
        });
    }

    /** Share a file (backup, report, family update) through the Android share sheet. */
    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("name", "MedTap");
        String data = call.getString("base64");
        if (data == null) { call.reject("No file", "io"); return; }
        try {
            File dir = new File(getContext().getCacheDir(), "shared");
            if (!dir.exists() && !dir.mkdirs()) throw new IOException("Couldn't make a folder");
            File f = new File(dir, name.replaceAll("[^A-Za-z0-9._ -]", "_"));
            try (FileOutputStream out = new FileOutputStream(f)) {
                out.write(Base64.decode(data, Base64.DEFAULT));
            }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", f);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(call.getString("mime", "application/octet-stream"));
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, call.getString("title", name)));
            call.resolve();
        } catch (IOException | RuntimeException e) {
            call.reject(String.valueOf(e.getMessage()), "io");
        }
    }

    // ---- Backup folder ----

    private static final int FOLDER_FLAGS = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    /** Android's folder picker. Access is kept across restarts until the folder is changed. */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(FOLDER_FLAGS | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        try {
            startActivityForResult(call, i, "folderPicked");
        } catch (RuntimeException e) {
            call.reject("This phone has no folder picker", "unavailable");
        }
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri tree = data != null ? data.getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || tree == null) { call.reject("No folder chosen", "cancelled"); return; }
        ContentResolver cr = getContext().getContentResolver();
        try {
            cr.takePersistableUriPermission(tree, FOLDER_FLAGS);
        } catch (SecurityException e) {
            call.reject("Couldn't keep access to that folder", "io");
            return;
        }
        // Only one backup folder at a time; let go of any earlier one (Android limits how many an app holds).
        for (UriPermission p : cr.getPersistedUriPermissions()) {
            if (!p.getUri().equals(tree)) {
                try { cr.releasePersistableUriPermission(p.getUri(), FOLDER_FLAGS); } catch (SecurityException ignored) { }
            }
        }
        DocumentFile dir = DocumentFile.fromTreeUri(getContext(), tree);
        String name = dir != null ? dir.getName() : null;
        JSObject o = new JSObject();
        o.put("uri", tree.toString());
        o.put("name", name != null ? name : "your folder");
        call.resolve(o);
    }

    /** The chosen folder, or null (and the call rejected) if it's gone or access was removed. */
    private DocumentFile folder(PluginCall call, boolean reject) {
        String uri = call.getString("uri");
        DocumentFile d = null;
        try {
            if (uri != null) d = DocumentFile.fromTreeUri(getContext(), Uri.parse(uri));
            if (d != null && !(d.isDirectory() && d.canWrite())) d = null;
        } catch (RuntimeException e) {
            d = null;
        }
        if (d == null && reject) call.reject("Can't reach the backup folder", "gone");
        return d;
    }

    @PluginMethod
    public void folderAccess(PluginCall call) {
        JSObject o = new JSObject();
        o.put("ok", folder(call, false) != null);
        call.resolve(o);
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        DocumentFile dir = folder(call, true);
        if (dir == null) return;
        String name = call.getString("name");
        String text = call.getString("text");
        if (name == null || text == null) { call.reject("Nothing to save", "io"); return; }
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        try {
            DocumentFile f = dir.findFile(name);
            if (f != null && !f.isFile()) throw new IOException(name + " is a folder");
            // octet-stream so the name is kept exactly (no extra ".json" added).
            if (f == null) f = dir.createFile("application/octet-stream", name);
            if (f == null) throw new IOException("Couldn't make the file");
            ContentResolver cr = getContext().getContentResolver();
            OutputStream out;
            try {
                out = cr.openOutputStream(f.getUri(), "wt");
            } catch (IllegalArgumentException | UnsupportedOperationException e) {
                // Some providers don't know "wt" (and "w" may not shorten the file), so start a fresh file.
                if (!f.delete()) throw new IOException("Couldn't replace " + name);
                f = dir.createFile("application/octet-stream", name);
                if (f == null) throw new IOException("Couldn't make the file");
                out = cr.openOutputStream(f.getUri(), "w");
            }
            if (out == null) throw new IOException("Couldn't open the file");
            try (OutputStream o = out) {
                o.write(bytes);
            }
            call.resolve();
        } catch (IOException | RuntimeException e) {
            call.reject(String.valueOf(e.getMessage()), "io");
        }
    }

    @PluginMethod
    public void listFiles(PluginCall call) {
        DocumentFile dir = folder(call, true);
        if (dir == null) return;
        JSArray names = new JSArray();
        for (DocumentFile f : dir.listFiles()) {
            if (f.isFile() && f.getName() != null) names.put(f.getName());
        }
        JSObject o = new JSObject();
        o.put("names", names);
        call.resolve(o);
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        DocumentFile dir = folder(call, true);
        if (dir == null) return;
        String name = call.getString("name");
        DocumentFile f = name != null ? dir.findFile(name) : null;
        if (f != null && f.isFile() && !f.delete()) { call.reject("Couldn't remove " + name, "io"); return; }
        call.resolve();
    }

    // ---- One write or read at a time ----

    private synchronized void begin(PluginCall call, String url) {
        if (adapter == null) { call.reject("This phone has no NFC", "unavailable"); return; }
        if (!adapter.isEnabled()) { call.reject("NFC is turned off", "disabled"); return; }
        finishError("Replaced by a new request", "cancelled");
        pending = call;
        writeUrl = url;
        long ms = call.getLong("timeoutMs", 30000L);
        timeout = () -> finishError("No tag found", "timeout");
        main.postDelayed(timeout, ms);
        updateReaderMode();
    }

    private synchronized PluginCall take() {
        PluginCall c = pending;
        pending = null;
        writeUrl = null;
        if (timeout != null) main.removeCallbacks(timeout);
        timeout = null;
        updateReaderMode();
        return c;
    }

    private void finishError(String message, String code) {
        PluginCall c = take();
        if (c != null) c.reject(message, code);
    }

    @Override
    public void onTagDiscovered(Tag tag) {
        String url;
        PluginCall call;
        synchronized (this) {
            url = writeUrl;
            call = pending;
        }
        if (call != null && url != null) {
            write(tag, url);
            return;
        }
        Ndef ndef = Ndef.get(tag);
        String found = ndef != null ? urlFrom(ndef.getCachedNdefMessage()) : null;
        if (call != null) {
            PluginCall c = take();
            if (c != null) {
                JSObject o = new JSObject();
                o.put("url", found);
                c.resolve(o);
            }
        } else if (listening) {
            emitTag(found);
        }
    }

    private void write(Tag tag, String url) {
        NdefMessage msg = new NdefMessage(NdefRecord.createUri(url));
        Ndef ndef = Ndef.get(tag);
        try {
            if (ndef != null) {
                ndef.connect();
                try {
                    if (!ndef.isWritable()) { finishError("The tag is locked", "read-only"); return; }
                    if (ndef.getMaxSize() < msg.getByteArrayLength()) { finishError("The tag is too small", "too-small"); return; }
                    ndef.writeNdefMessage(msg);
                } finally {
                    ndef.close();
                }
            } else {
                NdefFormatable f = NdefFormatable.get(tag);
                if (f == null) { finishError("This kind of tag can't hold a link", "unsupported-tag"); return; }
                f.connect();
                try { f.format(msg); } finally { f.close(); }
            }
            PluginCall c = take();
            if (c != null) c.resolve();
        } catch (TagLostException e) {
            finishError("The tag moved away", "io");
        } catch (FormatException e) {
            finishError("This kind of tag can't hold a link", "unsupported-tag");
        } catch (IOException | RuntimeException e) {
            finishError(String.valueOf(e.getMessage()), "io");
        }
    }
}
