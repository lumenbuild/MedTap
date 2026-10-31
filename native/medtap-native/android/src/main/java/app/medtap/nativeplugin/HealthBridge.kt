package app.medtap.nativeplugin

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.feature.ExperimentalMindfulnessSessionApi
import androidx.health.connect.client.records.BloodGlucoseRecord
import androidx.health.connect.client.records.ElevationGainedRecord
import androidx.health.connect.client.records.FloorsClimbedRecord
import androidx.health.connect.client.records.HydrationRecord
import androidx.health.connect.client.records.MindfulnessSessionRecord
import androidx.health.connect.client.records.NutritionRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.PowerRecord
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.SkinTemperatureRecord
import androidx.health.connect.client.records.SpeedRecord
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.records.Vo2MaxRecord
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
        HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        // Overnight vitals, fitness and energy, and what other apps log (water, food, glucose).
        HealthPermission.getReadPermission(OxygenSaturationRecord::class),
        HealthPermission.getReadPermission(RespiratoryRateRecord::class),
        HealthPermission.getReadPermission(Vo2MaxRecord::class),
        HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class),
        HealthPermission.getReadPermission(FloorsClimbedRecord::class),
        HealthPermission.getReadPermission(ElevationGainedRecord::class),
        HealthPermission.getReadPermission(SpeedRecord::class),
        HealthPermission.getReadPermission(PowerRecord::class),
        HealthPermission.getReadPermission(HydrationRecord::class),
        HealthPermission.getReadPermission(NutritionRecord::class),
        HealthPermission.getReadPermission(BloodGlucoseRecord::class),
    ) + FEATURE_PERMISSIONS.keys

    /** Permissions that only newer Health Connect versions know: asked for only where the feature is there. Skin
     *  temperature, mindfulness, and reading history from before the app was allowed in (otherwise 30 days at most). */
    @OptIn(ExperimentalMindfulnessSessionApi::class)
    private val FEATURE_PERMISSIONS: Map<String, Int> get() = mapOf(
        HealthPermission.getReadPermission(SkinTemperatureRecord::class) to HealthConnectFeatures.FEATURE_SKIN_TEMPERATURE,
        HealthPermission.getReadPermission(MindfulnessSessionRecord::class) to HealthConnectFeatures.FEATURE_MINDFULNESS_SESSION,
        HealthPermission.PERMISSION_READ_HEALTH_DATA_HISTORY to HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_HISTORY,
    )

    /** Health Connect's exercise types (from the watch or any app), as the app's activities. */
    private fun activity(type: Int): String = when (type) {
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING, ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "run"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING, ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "walk"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING, ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "ride"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL, ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "swim"
        ExerciseSessionRecord.EXERCISE_TYPE_ROWING, ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE -> "row"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING, ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING, ExerciseSessionRecord.EXERCISE_TYPE_CALISTHENICS -> "strength"
        ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING, ExerciseSessionRecord.EXERCISE_TYPE_BOOT_CAMP -> "hiit"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "yoga"
        ExerciseSessionRecord.EXERCISE_TYPE_PILATES -> "pilates"
        ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL -> "elliptical"
        ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING, ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE -> "stairs"
        ExerciseSessionRecord.EXERCISE_TYPE_DANCING -> "dance"
        ExerciseSessionRecord.EXERCISE_TYPE_BOXING, ExerciseSessionRecord.EXERCISE_TYPE_MARTIAL_ARTS -> "boxing"
        ExerciseSessionRecord.EXERCISE_TYPE_TENNIS, ExerciseSessionRecord.EXERCISE_TYPE_BADMINTON, ExerciseSessionRecord.EXERCISE_TYPE_SQUASH,
        ExerciseSessionRecord.EXERCISE_TYPE_SOCCER, ExerciseSessionRecord.EXERCISE_TYPE_BASKETBALL, ExerciseSessionRecord.EXERCISE_TYPE_FOOTBALL_AUSTRALIAN,
        ExerciseSessionRecord.EXERCISE_TYPE_GOLF, ExerciseSessionRecord.EXERCISE_TYPE_VOLLEYBALL -> "sport"
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
        val features = try { HealthConnectClient.getOrCreate(context).features } catch (e: Exception) { null }
        val featureOk = { p: String -> FEATURE_PERMISSIONS[p]?.let { f -> features?.getFeatureStatus(f) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE } ?: true }
        return PERMISSIONS.filter { it in asked && featureOk(it) }.toSet()
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
                // Each session's heart rate, minute by minute (for time in each zone), filled in from the heart rate below.
                class Session(val start: Long, val end: Long, val w: JSONObject) { val mins = ((end - start) / 60_000L).toInt().coerceIn(1, 600); val sum = DoubleArray(mins); val n = IntArray(mins) }
                val sessions = ArrayList<Session>()
                if (has(ExerciseSessionRecord::class)) {
                    val distance = has(DistanceRecord::class)
                    val heart = has(HeartRateRecord::class)
                    val calories = has(ActiveCaloriesBurnedRecord::class)
                    for (r in readAll(client, ExerciseSessionRecord::class, range)) {
                        val d = r.startTime.atZone(z).toLocalDate()
                        day(d).put("exerciseMin", day(d).optInt("exerciseMin", 0) + ((r.endTime.toEpochMilli() - r.startTime.toEpochMilli()) / 60000).toInt())
                        val w = JSONObject().put("t", r.startTime.toEpochMilli()).put("end", r.endTime.toEpochMilli()).put("type", activity(r.exerciseType))
                        r.title?.takeIf { it.isNotBlank() }?.let { w.put("title", it) }
                        // Distance, heart rate (average and highest) and active calories over the session, where they were recorded.
                        val metrics = buildSet {
                            if (distance) add(DistanceRecord.DISTANCE_TOTAL)
                            if (heart) { add(HeartRateRecord.BPM_AVG); add(HeartRateRecord.BPM_MAX) }
                            if (calories) add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
                            if (has(SpeedRecord::class)) add(SpeedRecord.SPEED_AVG)
                            if (has(PowerRecord::class)) add(PowerRecord.POWER_AVG)
                            if (has(ElevationGainedRecord::class)) add(ElevationGainedRecord.ELEVATION_GAINED_TOTAL)
                        }
                        if (metrics.isNotEmpty()) {
                            try {
                                val agg = client.aggregate(AggregateRequest(metrics, TimeRangeFilter.between(r.startTime, r.endTime)))
                                agg[DistanceRecord.DISTANCE_TOTAL]?.inKilometers?.takeIf { it > 0 }?.let { w.put("km", it) }
                                agg[HeartRateRecord.BPM_AVG]?.takeIf { it > 0 }?.let { w.put("avgHr", it) }
                                agg[HeartRateRecord.BPM_MAX]?.takeIf { it > 0 }?.let { w.put("maxHr", it) }
                                agg[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories?.takeIf { it > 0 }?.let { w.put("kcal", it.roundToInt()) }
                                agg[SpeedRecord.SPEED_AVG]?.inKilometersPerHour?.takeIf { it > 0 }?.let { w.put("kmh", Math.round(it * 10) / 10.0) }
                                agg[PowerRecord.POWER_AVG]?.inWatts?.takeIf { it > 0 }?.let { w.put("watts", it.roundToInt()) }
                                agg[ElevationGainedRecord.ELEVATION_GAINED_TOTAL]?.inMeters?.takeIf { it > 0 }?.let { w.put("climbM", it.roundToInt()) }
                            } catch (_: Exception) { /* a metric this phone can't total */ }
                        }
                        workouts.put(w)
                        sessions.add(Session(r.startTime.toEpochMilli(), r.endTime.toEpochMilli(), w))
                    }
                }
                sessions.sortBy { it.start }
                val starts = LongArray(sessions.size) { sessions[it].start }
                fun sessionAt(t: Long): Session? {
                    var i = java.util.Arrays.binarySearch(starts, t)
                    if (i < 0) i = -i - 2
                    return if (i >= 0 && t < sessions[i].end) sessions[i] else null
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
                        sessionAt(s.time.toEpochMilli())?.let { se ->
                            val m = ((s.time.toEpochMilli() - se.start) / 60_000L).toInt()
                            if (m in 0 until se.mins) { se.sum[m] += s.beatsPerMinute.toDouble(); se.n[m] += 1 }
                        }
                    }
                    for (se in sessions) if (se.n.any { it > 0 }) {
                        val arr = JSONArray()
                        for (m in 0 until se.mins) arr.put(if (se.n[m] > 0) (se.sum[m] / se.n[m]).roundToInt() else JSONObject.NULL)
                        se.w.put("hrMin", arr)
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
                // Overnight: blood oxygen and breathing rate during the main sleep (by the morning it ends), and the night's
                // skin temperature against the person's own baseline. Then the day's energy, climbing, fitness and what
                // other apps log. Each part on its own, so one this phone can't read doesn't stop the rest.
                val nights = days.values.filter { it.has("sleepStart") }.map { Triple(it.getLong("sleepStart"), it.getLong("sleepEnd"), it.getString("date")) }
                fun nightKey(i: Instant): String? {
                    val t = i.toEpochMilli()
                    nights.firstOrNull { t >= it.first && t <= it.second }?.let { return it.third }
                    val zt = i.atZone(z)
                    return when { zt.hour < 11 -> zt.toLocalDate().toString(); zt.hour >= 19 -> zt.toLocalDate().plusDays(1).toString(); else -> null }
                }
                fun round1(v: Double) = Math.round(v * 10) / 10.0
                suspend fun part(f: suspend () -> Unit) { try { f() } catch (_: Exception) { } }
                part {
                    if (has(OxygenSaturationRecord::class)) {
                        val acc = HashMap<String, DoubleArray>()
                        for (r in readAll(client, OxygenSaturationRecord::class, range)) {
                            val k = nightKey(r.time) ?: continue
                            val a = acc.getOrPut(k) { doubleArrayOf(0.0, 0.0, 101.0) }
                            val v = r.percentage.value
                            a[0] += v; a[1] += 1.0; if (v < a[2]) a[2] = v
                        }
                        for ((k, a) in acc) day(LocalDate.parse(k)).put("spo2Avg", round1(a[0] / a[1])).put("spo2Min", round1(a[2]))
                    }
                }
                part {
                    if (has(RespiratoryRateRecord::class)) {
                        val acc = HashMap<String, DoubleArray>()
                        for (r in readAll(client, RespiratoryRateRecord::class, range)) {
                            val k = nightKey(r.time) ?: continue
                            val a = acc.getOrPut(k) { DoubleArray(2) }
                            a[0] += r.rate; a[1] += 1.0
                        }
                        for ((k, a) in acc) day(LocalDate.parse(k)).put("respRate", round1(a[0] / a[1]))
                    }
                }
                part {
                    if (has(SkinTemperatureRecord::class)) {
                        for (r in readAll(client, SkinTemperatureRecord::class, range)) {
                            if (r.deltas.isEmpty()) continue
                            val avg = r.deltas.map { it.delta.inCelsius }.average()
                            day(r.endTime.atZone(z).toLocalDate()).put("skinTempDelta", Math.round(avg * 100) / 100.0)
                        }
                    }
                }
                part {
                    if (has(Vo2MaxRecord::class)) for (r in readAll(client, Vo2MaxRecord::class, range)) day(r.time.atZone(z).toLocalDate()).put("vo2max", round1(r.vo2MillilitersPerMinuteKilogram))
                }
                part {
                    // By day: calories burned (all, and active), floors and metres climbed, and water and food logged in other apps.
                    val metrics = buildSet {
                        if (has(TotalCaloriesBurnedRecord::class)) add(TotalCaloriesBurnedRecord.ENERGY_TOTAL)
                        if (has(ActiveCaloriesBurnedRecord::class)) add(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL)
                        if (has(FloorsClimbedRecord::class)) add(FloorsClimbedRecord.FLOORS_CLIMBED_TOTAL)
                        if (has(ElevationGainedRecord::class)) add(ElevationGainedRecord.ELEVATION_GAINED_TOTAL)
                        if (has(HydrationRecord::class)) add(HydrationRecord.VOLUME_TOTAL)
                        if (has(NutritionRecord::class)) { add(NutritionRecord.ENERGY_TOTAL); add(NutritionRecord.PROTEIN_TOTAL); add(NutritionRecord.TOTAL_CARBOHYDRATE_TOTAL); add(NutritionRecord.TOTAL_FAT_TOTAL) }
                    }
                    if (metrics.isNotEmpty()) {
                        val start = from.atZone(z).toLocalDate().atStartOfDay()
                        val end = to.atZone(z).toLocalDate().plusDays(1).atStartOfDay()
                        for (r in client.aggregateGroupByPeriod(AggregateGroupByPeriodRequest(metrics, TimeRangeFilter.between(start, end), Period.ofDays(1)))) {
                            val row = day(r.startTime.toLocalDate())
                            r.result[TotalCaloriesBurnedRecord.ENERGY_TOTAL]?.inKilocalories?.takeIf { it > 0 }?.let { row.put("kcalTotal", it.roundToInt()) }
                            r.result[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories?.takeIf { it > 0 }?.let { row.put("kcalActive", it.roundToInt()) }
                            r.result[FloorsClimbedRecord.FLOORS_CLIMBED_TOTAL]?.takeIf { it > 0 }?.let { row.put("floors", it.roundToInt()) }
                            r.result[ElevationGainedRecord.ELEVATION_GAINED_TOTAL]?.inMeters?.takeIf { it > 0 }?.let { row.put("climbM", it.roundToInt()) }
                            r.result[HydrationRecord.VOLUME_TOTAL]?.inMilliliters?.takeIf { it > 0 }?.let { row.put("waterOtherMl", it.roundToInt()) }
                            r.result[NutritionRecord.ENERGY_TOTAL]?.inKilocalories?.takeIf { it > 0 }?.let { row.put("foodOtherKcal", it.roundToInt()) }
                            r.result[NutritionRecord.PROTEIN_TOTAL]?.inGrams?.takeIf { it > 0 }?.let { row.put("foodOtherProteinG", it.roundToInt()) }
                            r.result[NutritionRecord.TOTAL_CARBOHYDRATE_TOTAL]?.inGrams?.takeIf { it > 0 }?.let { row.put("foodOtherCarbsG", it.roundToInt()) }
                            r.result[NutritionRecord.TOTAL_FAT_TOTAL]?.inGrams?.takeIf { it > 0 }?.let { row.put("foodOtherFatG", it.roundToInt()) }
                        }
                    }
                }
                part { readMindfulness(client, range, z, ::day, granted) }
                part {
                    // Blood glucose (a CGM or meter app): the day's average, lowest, highest, time in range (3.9–10 mmol/L)
                    // and the average in each hour.
                    if (has(BloodGlucoseRecord::class)) {
                        class G { var sum = 0.0; var n = 0; var lo = 99.0; var hi = 0.0; var inRange = 0; val hs = DoubleArray(24); val hn = IntArray(24) }
                        val acc = HashMap<String, G>()
                        for (r in readAll(client, BloodGlucoseRecord::class, range)) {
                            val t = r.time.atZone(z)
                            val v = r.level.inMillimolesPerLiter
                            val g = acc.getOrPut(t.toLocalDate().toString()) { G() }
                            g.sum += v; g.n++; if (v < g.lo) g.lo = v; if (v > g.hi) g.hi = v; if (v in 3.9..10.0) g.inRange++
                            g.hs[t.hour] += v; g.hn[t.hour]++
                        }
                        for ((k, g) in acc) {
                            val hours = JSONArray()
                            for (h in 0 until 24) hours.put(if (g.hn[h] > 0) round1(g.hs[h] / g.hn[h]) else JSONObject.NULL)
                            day(LocalDate.parse(k)).put("glucoseAvg", round1(g.sum / g.n)).put("glucoseMin", round1(g.lo)).put("glucoseMax", round1(g.hi))
                                .put("glucoseInRange", Math.round(g.inRange * 100.0 / g.n).toInt()).put("glucoseByHour", hours)
                        }
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

    /** Minutes of mindfulness (meditation, breathing) by day. */
    @OptIn(ExperimentalMindfulnessSessionApi::class)
    private suspend fun readMindfulness(client: HealthConnectClient, range: TimeRangeFilter, z: ZoneId, day: (LocalDate) -> JSONObject, granted: Set<String>) {
        if (HealthPermission.getReadPermission(MindfulnessSessionRecord::class) !in granted) return
        for (r in readAll(client, MindfulnessSessionRecord::class, range)) {
            val row = day(r.startTime.atZone(z).toLocalDate())
            row.put("mindfulMin", row.optInt("mindfulMin", 0) + ((r.endTime.toEpochMilli() - r.startTime.toEpochMilli()) / 60_000L).toInt())
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
