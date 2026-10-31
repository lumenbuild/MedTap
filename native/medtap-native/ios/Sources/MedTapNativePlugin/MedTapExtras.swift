import Foundation
import Capacitor
import HealthKit
import UserNotifications
import UIKit

/// Apple Health (read only), Siri Shortcuts targets, a reminder check and the widget data for MedTap on iPhone.
/// Health results use the same shape as Health Connect on Android (see HealthBridge.kt).
extension MedTapNativePlugin {
    static let health = HKHealthStore()

    private var readTypes: Set<HKObjectType> {
        var s: Set<HKObjectType> = []
        let q: [HKQuantityTypeIdentifier] = [.stepCount, .heartRate, .restingHeartRate, .bodyMass, .bloodPressureSystolic, .bloodPressureDiastolic, .appleExerciseTime,
                                             .bodyFatPercentage, .leanBodyMass, .heartRateVariabilitySDNN]
        for id in q { if let t = HKObjectType.quantityType(forIdentifier: id) { s.insert(t) } }
        s.insert(HKObjectType.workoutType())
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { s.insert(sleep) }
        if let bp = HKObjectType.correlationType(forIdentifier: .bloodPressure) { s.insert(bp) }
        return s
    }

    @objc func healthStatus(_ call: CAPPluginCall) {
        // iPhones never say which types were allowed (for privacy), so reading simply returns what it can.
        let ok = HKHealthStore.isHealthDataAvailable()
        call.resolve(["status": ok ? "available" : "unsupported", "granted": ok ? ["unknown"] : []])
    }

    @objc func healthRequest(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { call.reject("Apple Health isn't available", "unavailable"); return }
        MedTapNativePlugin.health.requestAuthorization(toShare: nil, read: readTypes) { _, error in
            if let error = error { call.reject(error.localizedDescription, "io"); return }
            self.healthStatus(call)
        }
    }

    @objc func openHealthConnect(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: "x-apple-health://") { UIApplication.shared.open(url) }
            call.resolve()
        }
    }

    @objc func healthRead(_ call: CAPPluginCall) {
        guard let fromMs = call.getDouble("from"), let toMs = call.getDouble("to") else { call.reject("Missing dates", "io"); return }
        let tz = TimeZone(identifier: call.getString("zone") ?? "") ?? .current
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz
        let from = Date(timeIntervalSince1970: fromMs / 1000), to = Date(timeIntervalSince1970: toMs / 1000)
        let fmt = DateFormatter()
        fmt.calendar = cal; fmt.timeZone = tz; fmt.locale = Locale(identifier: "en_US_POSIX"); fmt.dateFormat = "yyyy-MM-dd"
        let store = MedTapNativePlugin.health
        let group = DispatchGroup()
        let lock = NSLock()
        var days: [String: [String: Any]] = [:]
        var weights: [[String: Any]] = [], bp: [[String: Any]] = [], workouts: [[String: Any]] = [], bodyFat: [[String: Any]] = [], lean: [[String: Any]] = []
        func setDay(_ d: Date, _ key: String, _ value: Any, add: Bool = false) {
            lock.lock(); defer { lock.unlock() }
            let k = fmt.string(from: d)
            var row = days[k] ?? ["date": k]
            if add, let old = row[key] as? Int, let v = value as? Int { row[key] = old + v } else { row[key] = value }
            days[k] = row
        }
        let range = HKQuery.predicateForSamples(withStart: from, end: to, options: [])
        func dailySum(_ id: HKQuantityTypeIdentifier, _ unit: HKUnit, _ key: String) {
            guard let type = HKObjectType.quantityType(forIdentifier: id) else { return }
            group.enter()
            let q = HKStatisticsCollectionQuery(quantityType: type, quantitySamplePredicate: range, options: .cumulativeSum,
                                                anchorDate: cal.startOfDay(for: from), intervalComponents: DateComponents(day: 1))
            q.initialResultsHandler = { _, results, _ in
                results?.enumerateStatistics(from: from, to: to) { s, _ in
                    if let v = s.sumQuantity()?.doubleValue(for: unit) { setDay(s.startDate, key, Int(v.rounded())) }
                }
                group.leave()
            }
            store.execute(q)
        }
        func samples(_ type: HKSampleType, _ handle: @escaping ([HKSample]) -> Void) {
            group.enter()
            let q = HKSampleQuery(sampleType: type, predicate: range, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, s, _ in
                handle(s ?? [])
                group.leave()
            }
            store.execute(q)
        }
        dailySum(.stepCount, .count(), "steps")
        dailySum(.appleExerciseTime, .minute(), "exerciseMin")
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            samples(sleep) { list in
                // Stages (iOS 16+: deep, REM, core; awake) by the night they end, plus when the night began and ended.
                var span: [String: (Date, Date)] = [:]
                for case let s as HKCategorySample in list {
                    let m = Int(s.endDate.timeIntervalSince(s.startDate) / 60)
                    if s.value == HKCategoryValueSleepAnalysis.inBed.rawValue { continue }
                    let k = fmt.string(from: s.endDate)
                    if s.value == HKCategoryValueSleepAnalysis.awake.rawValue {
                        setDay(s.endDate, "sleepAwakeMin", m, add: true); setDay(s.endDate, "sleepWakes", 1, add: true); continue
                    }
                    setDay(s.endDate, "sleepMin", m, add: true)
                    if #available(iOS 16.0, *) {
                        if s.value == HKCategoryValueSleepAnalysis.asleepDeep.rawValue { setDay(s.endDate, "sleepDeepMin", m, add: true) }
                        if s.value == HKCategoryValueSleepAnalysis.asleepREM.rawValue { setDay(s.endDate, "sleepRemMin", m, add: true) }
                    }
                    let old = span[k]
                    span[k] = (min(old?.0 ?? s.startDate, s.startDate), max(old?.1 ?? s.endDate, s.endDate))
                }
                for (k, v) in span {
                    lock.lock()
                    var row = days[k] ?? ["date": k]
                    row["sleepStart"] = Int(v.0.timeIntervalSince1970 * 1000); row["sleepEnd"] = Int(v.1.timeIntervalSince1970 * 1000)
                    days[k] = row
                    lock.unlock()
                }
            }
        }
        // Steps in 5-minute blocks (288 a day), to tell resting from moving.
        if let stepType = HKObjectType.quantityType(forIdentifier: .stepCount) {
            group.enter()
            let q = HKStatisticsCollectionQuery(quantityType: stepType, quantitySamplePredicate: range, options: .cumulativeSum,
                                                anchorDate: cal.startOfDay(for: from), intervalComponents: DateComponents(minute: 5))
            q.initialResultsHandler = { _, results, _ in
                var blocks: [String: [Int]] = [:]
                results?.enumerateStatistics(from: from, to: to) { st, _ in
                    guard let v = st.sumQuantity()?.doubleValue(for: .count()), v > 0 else { return }
                    let k = fmt.string(from: st.startDate)
                    let i = cal.component(.hour, from: st.startDate) * 12 + cal.component(.minute, from: st.startDate) / 5
                    if blocks[k] == nil { blocks[k] = Array(repeating: 0, count: 288) }
                    blocks[k]![i] += Int(v.rounded())
                }
                lock.lock()
                for (k, a) in blocks { var row = days[k] ?? ["date": k]; row["steps5"] = a; days[k] = row }
                lock.unlock()
                group.leave()
            }
            store.execute(q)
        }
        if let rhr = HKObjectType.quantityType(forIdentifier: .restingHeartRate) {
            samples(rhr) { list in
                for case let s as HKQuantitySample in list { setDay(s.startDate, "restingHr", Int(s.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute())).rounded())) }
            }
        }
        if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) {
            samples(hr) { list in
                var sums: [String: [Double]] = [:], counts: [String: [Int]] = [:]
                var sums5: [String: [Double]] = [:], counts5: [String: [Int]] = [:]
                for case let s as HKQuantitySample in list {
                    let k = fmt.string(from: s.startDate), h = cal.component(.hour, from: s.startDate)
                    let bpm = s.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
                    if sums[k] == nil { sums[k] = Array(repeating: 0, count: 24); counts[k] = Array(repeating: 0, count: 24) }
                    sums[k]![h] += bpm
                    counts[k]![h] += 1
                    // And in 5-minute blocks (288 a day), for how a dose shows in the heart rate.
                    let i = h * 12 + cal.component(.minute, from: s.startDate) / 5
                    if sums5[k] == nil { sums5[k] = Array(repeating: 0, count: 288); counts5[k] = Array(repeating: 0, count: 288) }
                    sums5[k]![i] += bpm
                    counts5[k]![i] += 1
                }
                lock.lock()
                for (k, sum) in sums {
                    let c = counts[k]!
                    var row = days[k] ?? ["date": k]
                    row["hrByHour"] = (0..<24).map { h -> Any in c[h] > 0 ? Int((sum[h] / Double(c[h])).rounded()) as Any : NSNull() as Any }
                    if let s5 = sums5[k], let c5 = counts5[k] {
                        row["hr5"] = (0..<288).map { i -> Any in c5[i] > 0 ? Int((s5[i] / Double(c5[i])).rounded()) as Any : NSNull() as Any }
                    }
                    days[k] = row
                }
                lock.unlock()
            }
        }
        if let w = HKObjectType.quantityType(forIdentifier: .bodyMass) {
            samples(w) { list in
                lock.lock(); defer { lock.unlock() }
                for case let s as HKQuantitySample in list { weights.append(["t": s.startDate.timeIntervalSince1970 * 1000, "kg": s.quantity.doubleValue(for: .gramUnit(with: .kilo))]) }
            }
        }
        if let bpType = HKObjectType.correlationType(forIdentifier: .bloodPressure),
           let sysT = HKObjectType.quantityType(forIdentifier: .bloodPressureSystolic), let diaT = HKObjectType.quantityType(forIdentifier: .bloodPressureDiastolic) {
            samples(bpType) { list in
                lock.lock(); defer { lock.unlock() }
                for case let c as HKCorrelation in list {
                    guard let sys = c.objects(for: sysT).first as? HKQuantitySample, let dia = c.objects(for: diaT).first as? HKQuantitySample else { continue }
                    bp.append(["t": c.startDate.timeIntervalSince1970 * 1000, "sys": Int(sys.quantity.doubleValue(for: .millimeterOfMercury()).rounded()), "dia": Int(dia.quantity.doubleValue(for: .millimeterOfMercury()).rounded())])
                }
            }
        }
        if let t = HKObjectType.quantityType(forIdentifier: .bodyFatPercentage) {
            samples(t) { list in
                lock.lock(); defer { lock.unlock() }
                for case let s as HKQuantitySample in list { bodyFat.append(["t": s.startDate.timeIntervalSince1970 * 1000, "pct": s.quantity.doubleValue(for: .percent()) * 100]) }
            }
        }
        if let t = HKObjectType.quantityType(forIdentifier: .leanBodyMass) {
            samples(t) { list in
                lock.lock(); defer { lock.unlock() }
                for case let s as HKQuantitySample in list { lean.append(["t": s.startDate.timeIntervalSince1970 * 1000, "kg": s.quantity.doubleValue(for: .gramUnit(with: .kilo))]) }
            }
        }
        if let t = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN) {
            samples(t) { list in
                var sums: [String: (Double, Int)] = [:]
                for case let s as HKQuantitySample in list {
                    let k = fmt.string(from: s.startDate)
                    let v = s.quantity.doubleValue(for: .secondUnit(with: .milli))
                    sums[k] = ((sums[k]?.0 ?? 0) + v, (sums[k]?.1 ?? 0) + 1)
                }
                lock.lock()
                for (k, a) in sums { var row = days[k] ?? ["date": k]; row["hrvMs"] = Int((a.0 / Double(a.1)).rounded()); days[k] = row }
                lock.unlock()
            }
        }
        samples(HKObjectType.workoutType()) { list in
            lock.lock(); defer { lock.unlock() }
            for case let w as HKWorkout in list {
                let type: String
                switch w.workoutActivityType {
                case .running: type = "run"
                case .walking, .hiking: type = "walk"
                case .cycling: type = "ride"
                case .swimming: type = "swim"
                case .rowing: type = "row"
                case .traditionalStrengthTraining, .functionalStrengthTraining: type = "strength"
                case .highIntensityIntervalTraining, .crossTraining: type = "hiit"
                case .yoga: type = "yoga"
                case .pilates: type = "pilates"
                case .elliptical: type = "elliptical"
                case .stairClimbing, .stairs: type = "stairs"
                case .socialDance, .cardioDance: type = "dance"
                case .boxing, .martialArts, .kickboxing: type = "boxing"
                case .tennis, .badminton, .squash, .soccer, .basketball, .australianFootball, .golf, .volleyball: type = "sport"
                default: type = "other"
                }
                var row: [String: Any] = ["t": w.startDate.timeIntervalSince1970 * 1000, "end": w.endDate.timeIntervalSince1970 * 1000, "type": type]
                if let km = w.totalDistance?.doubleValue(for: .meterUnit(with: .kilo)), km > 0 { row["km"] = km }
                if let kcal = w.totalEnergyBurned?.doubleValue(for: .kilocalorie()), kcal > 0 { row["kcal"] = Int(kcal.rounded()) }
                workouts.append(row)
            }
        }
        group.notify(queue: .main) {
            let sorted = days.keys.sorted().map { days[$0]! }
            call.resolve(["days": sorted, "weights": weights, "bp": bp, "workouts": workouts, "bodyFat": bodyFat, "lean": lean])
        }
    }

    // ---- Siri Shortcuts: the medicines "Log … in MedTap" can name (read by the app's LogDoseIntent) ----

    @objc func setShortcuts(_ call: CAPPluginCall) {
        let items = (call.getArray("items", JSObject.self) ?? []).compactMap { i -> [String: String]? in
            guard let id = i["id"] as? String, let label = i["label"] as? String else { return nil }
            return ["id": id, "label": label]
        }
        UserDefaults.standard.set(items, forKey: "medtap.shortcutMeds")
        NotificationCenter.default.post(name: Notification.Name("MedTapShortcutsChanged"), object: nil)
        call.resolve()
    }

    /// A Siri Shortcut asked to log a medicine (LogDoseIntent stores it, then the app opens).
    func emitPendingLog() {
        guard let id = UserDefaults.standard.string(forKey: "medtap.pendingLog") else { return }
        UserDefaults.standard.removeObject(forKey: "medtap.pendingLog")
        notifyListeners("logRequest", data: ["medId": id], retainUntilConsumed: true)
    }

    // ---- Reminder check ----

    @objc func reminderHealth(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { s in
            call.resolve(["notificationsEnabled": s.authorizationStatus == .authorized || s.authorizationStatus == .provisional,
                          "channelOff": false, "batteryUnrestricted": true, "manufacturer": "Apple", "sdk": 0])
        }
    }

    @objc func openBatterySettings(_ call: CAPPluginCall) { call.resolve() }

    @objc func openNotificationSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            call.resolve()
        }
    }

    /// The widget is Android only for now; keep the data so a future iPhone widget can use it.
    @objc func setWidget(_ call: CAPPluginCall) {
        UserDefaults.standard.set(call.getString("json") ?? "{}", forKey: "medtap.widget")
        call.resolve()
    }
}
