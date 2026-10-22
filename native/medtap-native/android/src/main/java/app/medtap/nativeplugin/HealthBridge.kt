package app.medtap.nativeplugin

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId
import kotlin.math.roundToInt

/**
 * Health Connect, read only: daily steps, sleep, resting heart rate, exercise minutes and hourly heart rate, plus
 * weigh-ins and blood pressure readings. Called from MedTapNativePlugin (Java), results as JSON strings.
 */
object HealthBridge {
    val PERMISSIONS: Set<String> = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(WeightRecord::class),
        HealthPermission.getReadPermission(BloodPressureRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
    )

    /** "available", "needs-update" (install or update the Health Connect app) or "unsupported". */
    @JvmStatic
    fun status(context: Context): String {
        if (Build.VERSION.SDK_INT < 26) return "unsupported"
        return when (HealthConnectClient.getSdkStatus(context)) {
            HealthConnectClient.SDK_AVAILABLE -> "available"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "needs-update"
            else -> "unsupported"
        }
    }

    @JvmStatic
    fun requestIntent(context: Context): Intent =
        PermissionController.createRequestPermissionResultContract().createIntent(context, PERMISSIONS)

    interface Callback { fun done(json: String?, error: String?) }

    /** Which of the permissions are granted, as a JSON array of record names. */
    @JvmStatic
    fun granted(context: Context, cb: Callback) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val g = HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions()
                val names = JSONArray()
                for (p in g) if (p in PERMISSIONS) names.put(p.substringAfterLast('.'))
                cb.done(names.toString(), null)
            } catch (e: Exception) { cb.done(null, e.message ?: "error") }
        }
    }

    /** Everything from `fromMs` to `toMs`, by local day in `zone`. Types not granted are left out. */
    @JvmStatic
    fun read(context: Context, fromMs: Long, toMs: Long, zone: String, cb: Callback) {
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val client = HealthConnectClient.getOrCreate(context)
                val granted = client.permissionController.getGrantedPermissions()
                fun has(c: kotlin.reflect.KClass<out androidx.health.connect.client.records.Record>) = HealthPermission.getReadPermission(c) in granted
                val z = ZoneId.of(zone)
                val from = Instant.ofEpochMilli(fromMs)
                val to = Instant.ofEpochMilli(toMs)
                val range = TimeRangeFilter.between(from, to)
                val days = sortedMapOf<String, JSONObject>()
                fun day(d: LocalDate): JSONObject = days.getOrPut(d.toString()) { JSONObject().put("date", d.toString()) }

                if (has(StepsRecord::class)) {
                    val start = from.atZone(z).toLocalDate().atStartOfDay()
                    val end = to.atZone(z).toLocalDate().plusDays(1).atStartOfDay()
                    val res = client.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(start, end), Period.ofDays(1)))
                    for (r in res) r.result[StepsRecord.COUNT_TOTAL]?.let { day(r.startTime.toLocalDate()).put("steps", it) }
                }
                if (has(SleepSessionRecord::class)) {
                    for (r in readAll(client, SleepSessionRecord::class, range)) {
                        // A night counts on the day it ends (the morning after).
                        val d = r.endTime.atZone(z).toLocalDate()
                        val min = ((r.endTime.toEpochMilli() - r.startTime.toEpochMilli()) / 60000).toInt()
                        day(d).put("sleepMin", day(d).optInt("sleepMin", 0) + min)
                    }
                }
                if (has(RestingHeartRateRecord::class)) {
                    for (r in readAll(client, RestingHeartRateRecord::class, range)) day(r.time.atZone(z).toLocalDate()).put("restingHr", r.beatsPerMinute)
                }
                if (has(ExerciseSessionRecord::class)) {
                    for (r in readAll(client, ExerciseSessionRecord::class, range)) {
                        val d = r.startTime.atZone(z).toLocalDate()
                        day(d).put("exerciseMin", day(d).optInt("exerciseMin", 0) + ((r.endTime.toEpochMilli() - r.startTime.toEpochMilli()) / 60000).toInt())
                    }
                }
                if (has(HeartRateRecord::class)) {
                    val sums = HashMap<String, DoubleArray>()
                    val counts = HashMap<String, IntArray>()
                    for (r in readAll(client, HeartRateRecord::class, range)) for (s in r.samples) {
                        val t = s.time.atZone(z)
                        val k = t.toLocalDate().toString()
                        sums.getOrPut(k) { DoubleArray(24) }[t.hour] += s.beatsPerMinute.toDouble()
                        counts.getOrPut(k) { IntArray(24) }[t.hour] += 1
                    }
                    for ((k, sum) in sums) {
                        val c = counts[k]!!
                        val arr = JSONArray()
                        for (h in 0 until 24) arr.put(if (c[h] > 0) (sum[h] / c[h]).roundToInt() else JSONObject.NULL)
                        day(LocalDate.parse(k)).put("hrByHour", arr)
                    }
                }
                val weights = JSONArray()
                if (has(WeightRecord::class)) for (r in readAll(client, WeightRecord::class, range)) weights.put(JSONObject().put("t", r.time.toEpochMilli()).put("kg", r.weight.inKilograms))
                val bp = JSONArray()
                if (has(BloodPressureRecord::class)) for (r in readAll(client, BloodPressureRecord::class, range)) bp.put(JSONObject().put("t", r.time.toEpochMilli()).put("sys", r.systolic.inMillimetersOfMercury.roundToInt()).put("dia", r.diastolic.inMillimetersOfMercury.roundToInt()))
                val out = JSONObject().put("days", JSONArray(days.values.toList())).put("weights", weights).put("bp", bp)
                cb.done(out.toString(), null)
            } catch (e: Exception) { cb.done(null, e.message ?: "error") }
        }
    }

    private suspend fun <T : androidx.health.connect.client.records.Record> readAll(client: HealthConnectClient, type: kotlin.reflect.KClass<T>, range: TimeRangeFilter): List<T> {
        val out = ArrayList<T>()
        var token: String? = null
        do {
            val res = client.readRecords(ReadRecordsRequest(type, range, pageSize = 1000, pageToken = token))
            out.addAll(res.records)
            token = res.pageToken
        } while (token != null && out.size < 50_000)
        return out
    }
}
