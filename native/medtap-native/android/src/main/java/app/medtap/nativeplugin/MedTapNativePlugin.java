package app.medtap.nativeplugin;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.PowerManager;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import org.json.JSONArray;
import org.json.JSONException;
import java.util.ArrayList;
import java.util.List;
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

    /** As the link to write: erase the tag instead. */
    private static final String ERASE = "";
    private NfcAdapter adapter;
    private boolean listening = false;
    private boolean resumed = true;
    private PluginCall pending;
    private String writeUrl;
    private boolean writeAar;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Runnable timeout;

    @Override
    public void load() {
        adapter = NfcAdapter.getDefaultAdapter(getContext());
        // A tap on the watch while the app is open: tell the app to log it now.
        WidgetStore.listener = () -> main.post(() -> notifyListeners("widgetAction", new JSObject(), true));
        WearBridge.setListener((queue) -> {
            String event = WearBridge.SETS.equals(queue) ? "watchSet" : "watchLog";
            main.post(() -> notifyListeners(event, new JSObject(), true));
            return kotlin.Unit.INSTANCE;
        });
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

    /** A shortcut or the widget asking to log a medication (extra "medtap.logMed"). */
    private static final String LOG_EXTRA = "medtap.logMed";

    /** A tag tapped while the app was closed or in the background, or a shortcut/widget log request. */
    private void handleLaunchIntent(Intent intent) {
        if (intent != null && intent.hasExtra(LOG_EXTRA)) {
            JSObject o = new JSObject();
            o.put("medId", intent.getStringExtra(LOG_EXTRA));
            intent.removeExtra(LOG_EXTRA); // handled; don't repeat if the activity is recreated
            notifyListeners("logRequest", o, true);
            return;
        }
        if (intent != null && intent.hasExtra("medtap.route")) {
            // A widget opened the app on a page (e.g. a check-in).
            JSObject o = new JSObject();
            o.put("path", intent.getStringExtra("medtap.route"));
            intent.removeExtra("medtap.route");
            notifyListeners("route", o, true);
            return;
        }
        if (intent != null && ("androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE".equals(intent.getAction()) || "android.intent.action.VIEW_PERMISSION_USAGE".equals(intent.getAction()))) {
            JSObject o = new JSObject();
            o.put("path", "/help/privacy");
            intent.setAction(Intent.ACTION_MAIN);
            notifyListeners("route", o, true);
            return;
        }
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

    /** True if the tag carries an Android Application Record for this app, so Android opens the app rather than
     *  offering the link to a browser (Chrome also claims every web link read from a tag). */
    private boolean opensThisApp(NdefMessage msg) {
        if (msg == null) return false;
        for (NdefRecord r : msg.getRecords()) {
            if (r.getTnf() == NdefRecord.TNF_EXTERNAL_TYPE && "android.com:pkg".equals(new String(r.getType(), java.nio.charset.StandardCharsets.US_ASCII))
                && getContext().getPackageName().equals(new String(r.getPayload(), java.nio.charset.StandardCharsets.US_ASCII))) return true;
        }
        return false;
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
        begin(call, url, Boolean.TRUE.equals(call.getBoolean("openInApp", false)));
    }

    /** Waits for a tag and wipes it (one empty record), so it can be written again for something else. Resolves with
     *  `previous`: the link that was on it. */
    @PluginMethod
    public void nfcErase(PluginCall call) {
        begin(call, ERASE, false);
    }

    @PluginMethod
    public void nfcRead(PluginCall call) {
        begin(call, null, false);
    }

    @PluginMethod
    public void nfcCancel(PluginCall call) {
        finishError("Cancelled", "cancelled");
        call.resolve();
    }

    @PluginMethod
    public void openNfcSettings(PluginCall call) {
        try { getActivity().startActivity(new Intent(Settings.ACTION_NFC_SETTINGS)); }
        catch (Exception e) { try { getActivity().startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS)); } catch (Exception ignored) { /* nothing to open */ } }
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

    // ---- App updates ----

    /** Download a newer build of this app and open Android's installer for it (the person confirms there). Rejects
     *  with 'permission' after opening the "install unknown apps" setting when this app isn't allowed to install yet,
     *  and with 'mismatch' when the file isn't a newer build of this same app. Sends 'updateProgress' {pct}. */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://github.com/lumenbuild/MedTap/releases/download/")) { call.reject("Not an update link", "io"); return; }
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
            Intent allow = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
            allow.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(allow);
            call.reject("Allow installs from this app first", "permission");
            return;
        }
        new Thread(() -> {
            try {
                File dir = new File(ctx.getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new IOException("Couldn't make a folder");
                File f = new File(dir, "update.apk");
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(20000);
                c.setReadTimeout(30000);
                if (c.getResponseCode() != 200) throw new IOException("Download failed (" + c.getResponseCode() + ")");
                long total = c.getContentLengthLong();
                try (java.io.InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(f)) {
                    byte[] buf = new byte[65536];
                    long got = 0; int lastPct = -1, n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        got += n;
                        int pct = total > 0 ? (int) (got * 100 / total) : -1;
                        if (pct != lastPct && pct % 5 == 0) { lastPct = pct; JSObject e = new JSObject(); e.put("pct", pct); notifyListeners("updateProgress", e); }
                    }
                } finally { c.disconnect(); }
                // Same app and a newer build, before handing it to the installer (which also checks the signing key).
                android.content.pm.PackageManager pm = ctx.getPackageManager();
                android.content.pm.PackageInfo apk = pm.getPackageArchiveInfo(f.getPath(), 0);
                android.content.pm.PackageInfo self = pm.getPackageInfo(ctx.getPackageName(), 0);
                long apkVer = apk == null ? -1 : (Build.VERSION.SDK_INT >= 28 ? apk.getLongVersionCode() : apk.versionCode);
                long selfVer = Build.VERSION.SDK_INT >= 28 ? self.getLongVersionCode() : self.versionCode;
                if (apk == null || !ctx.getPackageName().equals(apk.packageName) || apkVer <= selfVer) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                    call.reject("That file isn't a newer build of this app", "mismatch");
                    return;
                }
                Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", f);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().startActivity(install);
                call.resolve();
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()), "io");
            }
        }).start();
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

    private synchronized void begin(PluginCall call, String url, boolean aar) {
        if (adapter == null) { call.reject("This phone has no NFC", "unavailable"); return; }
        if (!adapter.isEnabled()) { call.reject("NFC is turned off", "disabled"); return; }
        finishError("Replaced by a new request", "cancelled");
        pending = call;
        writeUrl = url;
        writeAar = aar;
        long ms = call.getLong("timeoutMs", 30000L);
        timeout = () -> finishError("No tag found", "timeout");
        main.postDelayed(timeout, ms);
        updateReaderMode();
    }

    private synchronized PluginCall take() {
        PluginCall c = pending;
        pending = null;
        writeUrl = null;
        writeAar = false;
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
        boolean aar;
        PluginCall call;
        synchronized (this) {
            url = writeUrl;
            aar = writeAar;
            call = pending;
        }
        if (call != null && url != null) {
            write(tag, url, aar);
            return;
        }
        Ndef ndef = Ndef.get(tag);
        NdefMessage cached = ndef != null ? ndef.getCachedNdefMessage() : null;
        String found = urlFrom(cached);
        if (call != null) {
            PluginCall c = take();
            if (c != null) {
                JSObject o = new JSObject();
                o.put("url", found);
                o.put("opensApp", opensThisApp(cached));
                c.resolve(o);
            }
        } else if (listening) {
            emitTag(found);
        }
    }

    private void write(Tag tag, String url, boolean aar) {
        // Erasing: one empty record. Writing: the link comes first (iPhones and browsers use it); the app record after it
        // makes Android open this app.
        NdefMessage msg = ERASE.equals(url)
            ? new NdefMessage(new NdefRecord(NdefRecord.TNF_EMPTY, null, null, null))
            : aar
            ? new NdefMessage(NdefRecord.createUri(url), NdefRecord.createApplicationRecord(getContext().getPackageName()))
            : new NdefMessage(NdefRecord.createUri(url));
        Ndef ndef = Ndef.get(tag);
        // What was on it before, so the app can drop that tag's old link.
        String previous = ndef != null ? urlFrom(ndef.getCachedNdefMessage()) : null;
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
            if (c != null) { JSObject o = new JSObject(); o.put("previous", previous); c.resolve(o); }
        } catch (TagLostException e) {
            finishError("The tag moved away", "io");
        } catch (FormatException e) {
            finishError("This kind of tag can't hold a link", "unsupported-tag");
        } catch (IOException | RuntimeException e) {
            finishError(String.valueOf(e.getMessage()), "io");
        }
    }

    // ---- Health Connect (read only; see HealthBridge.kt) ----

    @PluginMethod
    public void healthStatus(PluginCall call) {
        String status = HealthBridge.status(getContext());
        JSObject o = new JSObject();
        o.put("status", status);
        if (!"available".equals(status)) { o.put("granted", new JSArray()); call.resolve(o); return; }
        HealthBridge.granted(getContext(), (json, err) -> {
            try { o.put("granted", json != null ? new JSArray(json) : new JSArray()); } catch (JSONException e) { o.put("granted", new JSArray()); }
            call.resolve(o);
        });
    }

    @PluginMethod
    public void healthRequest(PluginCall call) {
        if (!"available".equals(HealthBridge.status(getContext()))) { call.reject("Health Connect isn't available", "unavailable"); return; }
        startActivityForResult(call, HealthBridge.requestIntent(getContext()), "healthAnswered");
    }

    @ActivityCallback
    private void healthAnswered(PluginCall call, ActivityResult result) {
        if (call == null) return;
        healthStatus(call);
    }

    @PluginMethod
    public void healthRead(PluginCall call) {
        Long from = call.getLong("from");
        Long to = call.getLong("to");
        String zone = call.getString("zone", java.util.TimeZone.getDefault().getID());
        if (from == null || to == null) { call.reject("Missing dates", "io"); return; }
        HealthBridge.read(getContext(), from, to, zone, (json, err) -> {
            if (json == null) { call.reject(err != null ? err : "Couldn't read Health Connect", "io"); return; }
            try { call.resolve(new JSObject(json)); } catch (JSONException e) { call.reject("Bad data", "io"); }
        });
    }

    /** Health Connect's settings, or its Play Store page when it needs installing or updating. */
    @PluginMethod
    public void openHealthConnect(PluginCall call) {
        java.util.List<Intent> tries = new java.util.ArrayList<>();
        if ("available".equals(HealthBridge.status(getContext()))) tries.addAll(HealthBridge.settingsIntents(getContext()));
        tries.add(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding")));
        tries.add(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata")));
        for (Intent i : tries) {
            try { getActivity().startActivity(i); call.resolve(); return; } catch (Exception ignored) { /* try the next one */ }
        }
        call.reject("Couldn't open Health Connect", "io");
    }

    // ---- Shortcuts: "Log <medicine>" on a long press of the app icon (can be pinned to the home screen) ----

    @PluginMethod
    public void setShortcuts(PluginCall call) {
        JSArray items = call.getArray("items", new JSArray());
        Context ctx = getContext();
        List<ShortcutInfoCompat> list = new ArrayList<>();
        try {
            int max = Math.min(items.length(), ShortcutManagerCompat.getMaxShortcutCountPerActivity(ctx));
            for (int k = 0; k < max; k++) {
                org.json.JSONObject it = items.getJSONObject(k);
                Intent launch = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
                if (launch == null) break;
                launch.setAction(Intent.ACTION_MAIN);
                launch.putExtra(LOG_EXTRA, it.getString("id"));
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                String label = it.getString("label");
                list.add(new ShortcutInfoCompat.Builder(ctx, "log-" + it.getString("id"))
                    .setShortLabel(label.length() > 24 ? label.substring(0, 24) : label)
                    .setLongLabel(label)
                    .setIcon(IconCompat.createWithResource(ctx, ctx.getApplicationInfo().icon))
                    .setIntent(launch)
                    .build());
            }
            ShortcutManagerCompat.setDynamicShortcuts(ctx, list);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't set shortcuts", "io");
        }
    }

    // ---- Reminder check: things that stop or delay reminders on this phone ----

    @PluginMethod
    public void reminderHealth(PluginCall call) {
        Context ctx = getContext();
        JSObject o = new JSObject();
        o.put("notificationsEnabled", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        boolean channelOff = false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel ch = nm.getNotificationChannel("doses");
            channelOff = ch != null && ch.getImportance() == NotificationManager.IMPORTANCE_NONE;
        }
        o.put("channelOff", channelOff);
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        o.put("batteryUnrestricted", pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        o.put("manufacturer", Build.MANUFACTURER);
        o.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(o);
    }

    /** Ask to let reminders run without battery restrictions (or open the list if that's not possible). */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Context ctx = getContext();
        try {
            // Google Play builds don't ask for the permission this needs: they open the list of apps instead.
            if (ctx.checkSelfPermission("android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) throw new SecurityException("not declared");
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.getPackageName()));
            getActivity().startActivity(i);
        } catch (Exception e) {
            try { getActivity().startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); } catch (Exception ignored) { /* nothing to open */ }
        }
        call.resolve();
    }

    /** The app's notification settings, to turn reminders back on. */
    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context ctx = getContext();
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
        i.putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
        try { getActivity().startActivity(i); }
        catch (Exception e) {
            try { getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.getPackageName()))); } catch (Exception ignored) { /* nothing to open */ }
        }
        call.resolve();
    }

    // ---- Home-screen widget ----

    /** What the widget shows (JSON, see src/app/widget.ts); the widget redraws straight away. */
    @PluginMethod
    public void setWidget(PluginCall call) {
        String json = call.getString("json", "{}");
        WidgetStore.save(getContext(), json);
        WearBridge.push(getContext(), json);
        call.resolve();
    }

    /** Taps from the watch waiting to be logged: {items: [{medId, at}]}, cleared. */
    @PluginMethod
    public void takeWatchLogs(PluginCall call) {
        try {
            JSObject o = new JSObject();
            o.put("items", new org.json.JSONArray(WearBridge.take(getContext(), WearBridge.LOGS)));
            call.resolve(o);
        } catch (Exception e) { call.reject(e.getMessage(), "io"); }
    }

    /** What the watch shows during a workout (next set, rest end); "{}" when there's none. */
    @PluginMethod
    public void setWatchWorkout(PluginCall call) {
        WearBridge.pushWorkout(getContext(), call.getString("json", "{}"));
        call.resolve();
    }

    /** "Set done" taps from the watch: {items: [{setId, at}]}, cleared. */
    @PluginMethod
    public void takeWatchSets(PluginCall call) {
        try {
            JSObject o = new JSObject();
            o.put("items", new org.json.JSONArray(WearBridge.take(getContext(), WearBridge.SETS)));
            call.resolve(o);
        } catch (Exception e) { call.reject(e.getMessage(), "io"); }
    }

    /** Widget taps waiting to be logged: {items: [{kind, ..., at}]}, cleared. */
    @PluginMethod
    public void takeWidgetActions(PluginCall call) {
        try {
            JSObject o = new JSObject();
            o.put("items", new org.json.JSONArray(WidgetStore.take(getContext())));
            call.resolve(o);
        } catch (Exception e) { call.reject(e.getMessage(), "io"); }
    }
}
