import Foundation
import Capacitor
import CoreNFC
import UIKit
import UniformTypeIdentifiers

/// NFC for MedTap on iPhone (Core NFC NDEF reader sessions), printing, sharing, and a folder for automatic backups.
/// iPhones only read tags for an app while it shows the system scanning sheet, so there's no "listen".
/// Error codes match NfcErrorKind in src/nfc/write.ts.
@objc(MedTapNativePlugin)
public class MedTapNativePlugin: CAPPlugin, CAPBridgedPlugin, NFCNDEFReaderSessionDelegate, UIDocumentPickerDelegate {
    public let identifier = "MedTapNativePlugin"
    public let jsName = "MedTapNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "nfcStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nfcListen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nfcWrite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nfcRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nfcCancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openNfcSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "folderAccess", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listFiles", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteFile", returnType: CAPPluginReturnPromise)
    ]

    private var session: NFCNDEFReaderSession?
    private var pending: CAPPluginCall?
    private var writeURL: URL?
    private var timeoutWork: DispatchWorkItem?
    private var folderCall: CAPPluginCall?

    @objc func nfcStatus(_ call: CAPPluginCall) {
        let ok = NFCNDEFReaderSession.readingAvailable
        call.resolve(["supported": ok, "enabled": ok])
    }

    @objc func nfcListen(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func openNfcSettings(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func nfcWrite(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else {
            call.reject("No link to write", "io")
            return
        }
        begin(call, write: url, message: "Hold the top of your iPhone near the tag.")
    }

    @objc func nfcRead(_ call: CAPPluginCall) {
        begin(call, write: nil, message: "Hold the top of your iPhone near a MedTap tag.")
    }

    @objc func nfcCancel(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.session?.invalidate()
            self.finish(error: ("Cancelled", "cancelled"))
            call.resolve()
        }
    }

    @objc func print(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else {
                call.reject("Nothing to print")
                return
            }
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = call.getString("name") ?? "MedTap"
            let controller = UIPrintInteractionController.shared
            controller.printInfo = info
            controller.printFormatter = webView.viewPrintFormatter()
            controller.present(animated: true) { _, _, _ in call.resolve() }
        }
    }

    /// Share a file (backup, report, family update) through the share sheet.
    @objc func shareFile(_ call: CAPPluginCall) {
        guard let b64 = call.getString("base64"), let data = Data(base64Encoded: b64) else {
            call.reject("No file", "io")
            return
        }
        let name = (call.getString("name") ?? "MedTap").replacingOccurrences(of: "/", with: "_")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            call.reject(error.localizedDescription, "io")
            return
        }
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("Nothing to share from", "io")
                return
            }
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = vc.view
            sheet.completionWithItemsHandler = { _, _, _, _ in call.resolve() }
            vc.present(sheet, animated: true)
        }
    }

    // MARK: - Backup folder

    /// The Files folder picker. The folder is kept as a bookmark (base64), which reaches it again after restarts.
    @objc func pickFolder(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("Nothing to show the picker from", "io")
                return
            }
            self.folderCall?.reject("Replaced by a new request", "cancelled")
            self.folderCall = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder])
            picker.delegate = self
            picker.allowsMultipleSelection = false
            vc.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = folderCall else { return }
        folderCall = nil
        guard let url = urls.first else {
            call.reject("No folder chosen", "cancelled")
            return
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let bookmark = try url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil)
            call.resolve(["uri": bookmark.base64EncodedString(), "name": url.lastPathComponent])
        } catch {
            call.reject("Couldn't keep access to that folder", "io")
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        folderCall?.reject("No folder chosen", "cancelled")
        folderCall = nil
    }

    /// Run `body` with access to the bookmarked folder. Rejects with "gone" if it can't be found.
    private func inFolder(_ call: CAPPluginCall, _ body: (URL) throws -> Void) {
        guard let b64 = call.getString("uri"), let data = Data(base64Encoded: b64) else {
            call.reject("Can't reach the backup folder", "gone")
            return
        }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else {
            call.reject("Can't reach the backup folder", "gone")
            return
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            try body(url)
        } catch {
            call.reject(error.localizedDescription, "io")
        }
    }

    /// Coordinated, so folders kept in iCloud Drive or another provider see the change.
    private func coordinated(writing url: URL, options: NSFileCoordinator.WritingOptions, _ body: (URL) throws -> Void) throws {
        var coordError: NSError?
        var bodyError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: options, error: &coordError) { u in
            do { try body(u) } catch { bodyError = error }
        }
        if let e = coordError ?? bodyError { throw e }
    }

    @objc func folderAccess(_ call: CAPPluginCall) {
        guard let b64 = call.getString("uri"), let data = Data(base64Encoded: b64) else {
            call.resolve(["ok": false])
            return
        }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else {
            call.resolve(["ok": false])
            return
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        var isDir: ObjCBool = false
        let ok = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) && isDir.boolValue
        call.resolve(["ok": ok])
    }

    @objc func writeFile(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), let text = call.getString("text") else {
            call.reject("Nothing to save", "io")
            return
        }
        let safe = name.replacingOccurrences(of: "/", with: "_")
        inFolder(call) { dir in
            try coordinated(writing: dir.appendingPathComponent(safe), options: .forReplacing) { u in
                try Data(text.utf8).write(to: u, options: .atomic)
            }
            call.resolve()
        }
    }

    @objc func listFiles(_ call: CAPPluginCall) {
        inFolder(call) { dir in
            let names = try FileManager.default.contentsOfDirectory(atPath: dir.path)
            call.resolve(["names": names])
        }
    }

    @objc func deleteFile(_ call: CAPPluginCall) {
        guard let name = call.getString("name") else {
            call.resolve()
            return
        }
        let safe = name.replacingOccurrences(of: "/", with: "_")
        inFolder(call) { dir in
            let file = dir.appendingPathComponent(safe)
            if FileManager.default.fileExists(atPath: file.path) {
                try coordinated(writing: file, options: .forDeleting) { u in
                    try FileManager.default.removeItem(at: u)
                }
            }
            call.resolve()
        }
    }

    // MARK: - One write or read at a time

    private func begin(_ call: CAPPluginCall, write: URL?, message: String) {
        guard NFCNDEFReaderSession.readingAvailable else {
            call.reject("This iPhone can't read tags", "unavailable")
            return
        }
        DispatchQueue.main.async {
            self.session?.invalidate()
            self.finish(error: ("Replaced by a new request", "cancelled"))
            self.pending = call
            self.writeURL = write
            let s = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: false)
            s.alertMessage = message
            self.session = s
            let ms = call.getDouble("timeoutMs") ?? 30000
            let work = DispatchWorkItem { [weak self] in
                self?.session?.invalidate(errorMessage: "No tag found.")
                self?.finish(error: ("No tag found", "timeout"))
            }
            self.timeoutWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + ms / 1000, execute: work)
            s.begin()
        }
    }

    /// Resolve or reject the waiting call once. Always on the main queue.
    private func finish(result: [String: Any]? = nil, error: (String, String)? = nil) {
        if !Thread.isMainThread {
            DispatchQueue.main.async { self.finish(result: result, error: error) }
            return
        }
        timeoutWork?.cancel()
        timeoutWork = nil
        guard let call = pending else { return }
        pending = nil
        writeURL = nil
        session = nil
        if let error = error {
            call.reject(error.0, error.1)
        } else {
            call.resolve(result ?? [:])
        }
    }

    private func fail(_ session: NFCNDEFReaderSession, _ shown: String, _ code: String) {
        session.invalidate(errorMessage: shown)
        finish(error: (shown, code))
    }

    // MARK: - NFCNDEFReaderSessionDelegate

    public func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {}

    public func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        var code = "io"
        if let e = error as? NFCReaderError {
            switch e.code {
            case .readerSessionInvalidationErrorUserCanceled: code = "cancelled"
            case .readerSessionInvalidationErrorSessionTimeout: code = "timeout"
            case .readerSessionInvalidationErrorFirstNDEFTagRead: return
            default: code = "io"
            }
        }
        finish(error: (error.localizedDescription, code))
    }

    public func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {}

    public func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard let tag = tags.first else { return }
        let url = writeURL
        session.connect(to: tag) { error in
            if error != nil {
                self.fail(session, "Couldn't read the tag. Hold it still and try again.", "io")
                return
            }
            tag.queryNDEFStatus { status, capacity, error in
                if error != nil {
                    self.fail(session, "Couldn't read the tag. Hold it still and try again.", "io")
                    return
                }
                if let url = url {
                    self.write(url, to: tag, status: status, capacity: capacity, session: session)
                } else {
                    self.read(tag, status: status, session: session)
                }
            }
        }
    }

    private func write(_ url: URL, to tag: NFCNDEFTag, status: NFCNDEFStatus, capacity: Int, session: NFCNDEFReaderSession) {
        switch status {
        case .notSupported:
            fail(session, "This kind of tag can't hold a link.", "unsupported-tag")
        case .readOnly:
            fail(session, "This tag is locked.", "read-only")
        case .readWrite:
            guard let payload = NFCNDEFPayload.wellKnownTypeURIPayload(url: url) else {
                fail(session, "Couldn't write the link.", "io")
                return
            }
            let message = NFCNDEFMessage(records: [payload])
            if message.length > capacity {
                fail(session, "This tag is too small for the link.", "too-small")
                return
            }
            tag.writeNDEF(message) { error in
                if error != nil {
                    self.fail(session, "The tag moved away. Try again.", "io")
                } else {
                    session.alertMessage = "Tag written."
                    session.invalidate()
                    self.finish(result: [:])
                }
            }
        @unknown default:
            fail(session, "Couldn't write the tag.", "io")
        }
    }

    private func read(_ tag: NFCNDEFTag, status: NFCNDEFStatus, session: NFCNDEFReaderSession) {
        if status == .notSupported {
            fail(session, "This kind of tag can't hold a link.", "unsupported-tag")
            return
        }
        tag.readNDEF { message, _ in
            // A blank tag reads as an error with no message; that's "no link", not a failure.
            let found = message?.records.compactMap { $0.wellKnownTypeURIPayload()?.absoluteString }.first
            session.alertMessage = found == nil ? "This tag is blank." : "Tag read."
            session.invalidate()
            self.finish(result: ["url": found ?? NSNull()])
        }
    }
}
