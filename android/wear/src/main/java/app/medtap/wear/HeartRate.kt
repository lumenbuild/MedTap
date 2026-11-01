package app.medtap.wear

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.health.services.client.HealthServices
import androidx.health.services.client.MeasureCallback
import androidx.health.services.client.data.Availability
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.DataTypeAvailability
import androidx.health.services.client.data.DeltaDataType
import kotlinx.coroutines.delay
import org.json.JSONObject

/** The heart-rate sensor's permission: "health.READ_HEART_RATE" for apps built for Wear OS 6, "BODY_SENSORS" before. */
private fun hrPermission(c: android.content.Context) =
    if (Build.VERSION.SDK_INT >= 36 && c.applicationInfo.targetSdkVersion >= 36) "android.permission.health.READ_HEART_RATE" else Manifest.permission.BODY_SENSORS

/**
 * A 20-second heart-rate reading from the watch's sensor (sit still): the median of the readings goes to the phone as
 * a heart-rate entry, noted with what it's for (e.g. "45 min after Ritalin").
 */
@Composable
fun HeartRateScreen(note: String, back: () -> Unit) {
    val ctx = LocalContext.current
    val perm = remember { hrPermission(ctx) }
    var allowed by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed = it }
    LaunchedEffect(Unit) { if (!allowed) ask.launch(perm) }
    if (!allowed) {
        Page {
            item { Label("Heart rate", C.heart) }
            item { Small("Allow the heart-rate sensor to take a reading.", C.text) }
            item { Action("Allow", C.heart, filled = true) { ask.launch(perm) } }
        }
        return
    }
    val readings = remember { mutableStateListOf<Double>() }
    var status by remember { mutableStateOf("Hold still…") }
    var result by remember { mutableStateOf<Int?>(null) }
    var sent by remember { mutableStateOf("") }
    var seconds by remember { mutableStateOf(0) }
    DisposableEffect(Unit) {
        val client = HealthServices.getClient(ctx).measureClient
        val cb = object : MeasureCallback {
            override fun onAvailabilityChanged(dataType: DeltaDataType<*, *>, availability: Availability) {
                if (availability is DataTypeAvailability) status = when (availability) {
                    DataTypeAvailability.AVAILABLE -> "Measuring…"
                    DataTypeAvailability.ACQUIRING -> "Finding your pulse…"
                    DataTypeAvailability.UNAVAILABLE_DEVICE_OFF_BODY -> "Put the watch on snugly"
                    else -> "Sensor not available"
                }
            }
            override fun onDataReceived(data: DataPointContainer) {
                for (p in data.getData(DataType.HEART_RATE_BPM)) if (p.value in 30.0..230.0) readings.add(p.value)
            }
        }
        client.registerMeasureCallback(DataType.HEART_RATE_BPM, cb)
        onDispose { client.unregisterMeasureCallbackAsync(DataType.HEART_RATE_BPM, cb) }
    }
    LaunchedEffect(Unit) {
        while (seconds < 20 || readings.size < 5) {
            delay(1000); seconds++
            if (seconds > 60) break
        }
        if (readings.size >= 5) {
            val s = readings.sorted()
            val bpm = Math.round(s[s.size / 2]).toInt()
            result = bpm
            Alarms.buzz(ctx, longArrayOf(0, 60))
            val r = WatchState.checkIn(ctx, JSONObject().put("hrBpm", bpm).put("note", note))
            sent = if (r == WatchState.Sent.SENT) "Saved on your phone ✓" else "Saved ✓ · sends when your phone's near"
        } else status = "Couldn't get a steady reading"
    }
    Page {
        item { Label("Heart rate", C.heart) }
        item {
            Ring(if (result != null) 1f else (seconds / 20f), C.heart, share = 0.58f) {
                Big(result?.let { "$it" } ?: readings.lastOrNull()?.let { "${Math.round(it)}" } ?: "—", 30)
                Small(if (result != null) "bpm" else status)
            }
        }
        if (note != "Watch") item { Small(note) }
        if (sent.isNotEmpty()) item { Small(sent, C.good) }
        if (result != null || status.startsWith("Couldn")) item { Action("Done", C.heart, onClick = back) }
    }
}
