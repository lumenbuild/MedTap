package app.medtap.nativeplugin

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.BloodPressureRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.LeanBodyMassRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.AggregateGroupByDurationRequest
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.Period
import java.time.ZoneId
import kotlin.math.roundToInt

/**
 * Health Connect, read only: daily steps, sleep (with its stages), resting heart rate, heart rate variability, exercise
 * minutes, hourly heart rate and heart rate and steps in 5-minute blocks (for how a dose shows in the heart rate), plus weigh-ins, body fat, lean mass, blood pressure readings and exercise sessions (with distance). Called from MedTapNativePlugin (Java), results as JSON strings.
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
        HealthPermission.getReadPermission(DistanceRecord::class),
        HealthPermission.getReadPermission(BodyFatRecord::class),
        HealthPermission.getReadPermission(LeanBodyMassRecord::class),
        HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
    )

    /** Health Connect's exercise types, as the app's cardio activities. */
    private fun activity(type: Int): String = when (type) {
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING, ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "run"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING, ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "walk"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING, ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "ride"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL, ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "swim"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING, ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "row"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING, ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "strength"
        else -> "other"
    }

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

    /** Where "Health Connect settings" goes, best first: this app's access page (Android 14+, where Health Connect is
     *  part of the phone), Health Connect's data and access screen, then its settings. The old
     *  "androidx.health.ACTION_HEALTH_CONNECT_SETTINGS" alone opens nothing on Android 14+. */
    @JvmStatic
    fun settingsIntents(context: Context): List<Intent> {
        val out = mutableListOf<Intent>()
        if (Build.VERSION.SDK_INT >= 34) {
            out += Intent("android.health.connect.action.MANAGE_HEALTH_PERMISSIONS").putExtra(Intent.EXTRA_PACKAGE_NAME, context.packageName)
        }
        out += HealthConnectClient.getHealthConnectManageDataIntent(context)
        out += Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
        return out
    }

    /** The permissions this app declares: each app (TapDose, TapWeigh, TapLift) removes the record types it doesn't use
     *  from its manifest, and asks only for the rest. */
    @JvmStatic
    fun declared(context: Context): Set<String> {
        val asked = try {
            context.packageManager.getPackageInfo(context.packageName, android.content.pm.PackageManager.GET_PERMISSIONS).requestedPermissions?.toSet() ?: emptySet()
        } catch (e: Exception) { emptySet() }
        return PERMISSIONS.filter { it in asked }.toSet()
    }

    @JvmStatic
    fun requestIntent(context: Context): Intent =
        PermissionController.createRequestPermissionResultContract().createIntent(context, declared(context))

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
                    // Steps in 5-minute blocks (288 a day), a week at a time, to tell resting from moving.
                    val blocks = HashMap<String, IntArray>()
                    var w = from
                    while (w.isBefore(to)) {
                        val we = minOf(w.plus(Duration.ofDays(7)), to)
                        for (b in client.aggregateGroupByDuration(AggregateGroupByDurationRequest(setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(w, we), Duration.ofMinutes(5)))) {
                            val n = b.result[StepsRecord.COUNT_TOTAL] ?: continue
                            val t = b.startTime.atZone(z)
                            blocks.getOrPut(t.toLocalDate().toString()) { IntArray(288) }[t.hour * 12 + t.minute / 5] += n.toInt()
                        }
                        w = we
                    }
                    for ((k, a) in blocks) day(LocalDate.parse(k)).put("steps5", JSONArray(a.toList()))
                }
                if (has(SleepSessionRecord::class)) {
                    for (r in readAll(client, SleepSessionRecord::class, range)) {
                        // A night counts on the day it ends (the morning after).
                        val d = r.endTime.atZone(z).toLocalDate()
                        val row = day(d)
                        // Time asleep: the session less any awake stages, when it has stages.
                        var awake = 0L; var deep = 0L; var rem = 0L; var wakes = 0
                        for (st in r.stages) {
                            val m = (st.endTime.toEpochMilli() - st.startTime.toEpochMilli()) / 60000
                            when (st.stage) {
                                SleepSessionRecord.STAGE_TYPE_AWAKE, SleepSessionRecord.STAGE_TYPE_AWAKE_IN_BED, SleepSessionRecord.STAGE_TYPE_OUT_OF_BED -> { awake += m; wakes++ }
                                SleepSessionRecord.STAGE_TYPE_DEEP -> deep += m
                                SleepSessionRecord.STAGE_TYPE_REM -> rem += m
                            }
                        }
                        val min = ((r.endTime.toEpochMilli() - r.startTime.toEpochMilli()) / 60000).toInt() - awake.toInt()
                        row.put("sleepMin", row.optInt("sleepMin", 0) + min)
                        if (r.stages.isNotEmpty()) {
                            row.put("sleepDeepMin", row.optInt("sleepDeepMin", 0) + deep.toInt()).put("sleepRemMin", row.optInt("sleepRemMin", 0) + rem.toInt())
                                .put("sleepAwakeMin", row.optInt("sleepAwakeMin", 0) + awake.toInt()).put("sleepWakes", row.optInt("sleepWakes", 0) + wakes)
                        }
                        // The main sleep: the longest session of the night.
                        if (min > row.optInt("mainSleepMin", 0)) row.put("mainSleepMin", min).put("sleepStart", r.startTime.toEpochMilli()).put("sleepEnd", r.endTime.toEpochMilli())
                    }
                }
                if (has(RestingHeartRateRecord::class)) {
                    for (r in readAll(client, RestingHeartRateRecord::class, range)) day(r.time.atZone(z).toLocalDate()).put("restingHr", r.beatsPerMinute)
                }
                val workouts = JSONArray()
                if (has(ExerciseSessionRecord::class)) {
                    val distance = has(DistanceRecord::class)
                    for (r in readAll(client, ExerciseSessionRecord::class, range)) {
                        val d = r.startTime.atZone(z).toLocalDate()
                        day(d).put("exerciseMin", day(d).optInt("exerciseMin", 0) + ((r.endTime.toEpochMilli() - r.startTime.toEpochMilli()) / 60000).toInt())
                        val w = JSONObject().put("t", r.startTime.toEpochMilli()).put("end", r.endTime.toEpochMilli()).put("type", activity(r.exerciseType))
                        if (distance) {
                            val km = client.aggregate(AggregateRequest(setOf(DistanceRecord.DISTANCE_TOTAL), TimeRangeFilter.between(r.startTime, r.endTime)))[DistanceRecord.DISTANCE_TOTAL]?.inKilometers
                            if (km != null && km > 0) w.put("km", km)
                        }
                        workouts.put(w)
                    }
                }
                if (has(HeartRateVariabilityRmssdRecord::class)) {
                    val sums = HashMap<LocalDate, DoubleArray>()
                    for (r in readAll(client, HeartRateVariabilityRmssdRecord::class, range)) {
                        val a = sums.getOrPut(r.time.atZone(z).toLocalDate()) { DoubleArray(2) }
                        a[0] += r.heartRateVariabilityMillis; a[1] += 1.0
                    }
                    for ((d, a) in sums) day(d).put("hrvMs", (a[0] / a[1]).roundToInt())
                }
                if (has(HeartRateRecord::class)) {
                    val sums = HashMap<String, DoubleArray>()
                    val counts = HashMap<String, IntArray>()
                    val sums5 = HashMap<String, DoubleArray>()
                    val counts5 = HashMap<String, IntArray>()
                    for (r in readAll(client, HeartRateRecord::class, range)) for (s in r.samples) {
                        val t = s.time.atZone(z)
                        val k = t.toLocalDate().toString()
                        sums.getOrPut(k) { DoubleArray(24) }[t.hour] += s.beatsPerMinute.toDouble()
                        counts.getOrPut(k) { IntArray(24) }[t.hour] += 1
                        val i = t.hour * 12 + t.minute / 5
                        sums5.getOrPut(k) { DoubleArray(288) }[i] += s.beatsPerMinute.toDouble()
                        counts5.getOrPut(k) { IntArray(288) }[i] += 1
                    }
                    for ((k, sum) in sums5) {
                        val c = counts5[k]!!
                        val arr = JSONArray()
                        for (i in 0 until 288) arr.put(if (c[i] > 0) (sum[i] / c[i]).roundToInt() else JSONObject.NULL)
                        day(LocalDate.parse(k)).put("hr5", arr)
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
                val bodyFat = JSONArray()
                if (has(BodyFatRecord::class)) for (r in readAll(client, BodyFatRecord::class, range)) bodyFat.put(JSONObject().put("t", r.time.toEpochMilli()).put("pct", r.percentage.value))
                val lean = JSONArray()
                if (has(LeanBodyMassRecord::class)) for (r in readAll(client, LeanBodyMassRecord::class, range)) lean.put(JSONObject().put("t", r.time.toEpochMilli()).put("kg", r.mass.inKilograms))
                val out = JSONObject().put("days", JSONArray(days.values.toList())).put("weights", weights).put("bp", bp)
                    .put("workouts", workouts).put("bodyFat", bodyFat).put("lean", lean)
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
        } while (token != null && out.size < 200_000)
        return out
    }
}
