import AppIntents
import Foundation

// Siri and the Shortcuts app: "Log Vyvanse in MedTap". Opens the app at Log dose for that medicine (the person confirms
// there). The medicines it can name come from the app (MedTapNative.setShortcuts → UserDefaults "medtap.shortcutMeds").

@available(iOS 16.0, *)
struct MedicationEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Medication"
    static let defaultQuery = MedicationQuery()
    let id: String
    let label: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(label)") }
}

@available(iOS 16.0, *)
struct MedicationQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [MedicationEntity] { all().filter { identifiers.contains($0.id) } }
    func suggestedEntities() async throws -> [MedicationEntity] { all() }
    private func all() -> [MedicationEntity] {
        let items = UserDefaults.standard.array(forKey: "medtap.shortcutMeds") as? [[String: String]] ?? []
        return items.compactMap { i in
            guard let id = i["id"], let label = i["label"] else { return nil }
            return MedicationEntity(id: id, label: label)
        }
    }
}

@available(iOS 16.0, *)
struct LogDoseIntent: AppIntent {
    static let title: LocalizedStringResource = "Log a dose"
    static let description = IntentDescription("Opens the app to log a dose of one of your medicines.")
    static let openAppWhenRun = true

    @Parameter(title: "Medication")
    var medication: MedicationEntity

    func perform() async throws -> some IntentResult {
        UserDefaults.standard.set(medication.id, forKey: "medtap.pendingLog")
        return .result()
    }
}

@available(iOS 16.0, *)
struct MedTapShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: LogDoseIntent(), phrases: [
            "Log \(\.$medication) in \(.applicationName)",
            "Log my \(\.$medication) with \(.applicationName)",
        ], shortTitle: "Log a dose", systemImageName: "pills")
    }
}
