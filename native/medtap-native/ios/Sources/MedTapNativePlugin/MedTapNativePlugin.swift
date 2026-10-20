import Foundation
import Capacitor
import CoreNFC
import UIKit

/// NFC for MedTap on iPhone (Core NFC NDEF reader sessions) and printing.
/// iPhones only read tags for an app while it shows the system scanning sheet, so there's no "listen".
/// Error codes match NfcErrorKind in src/nfc/write.ts.
@objc(MedTapNativePlugin)
public class MedTapNativePlugin: CAPPlugin, CAPBridgedPlugin, NFCNDEFReaderSessionDelegate {
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
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise)
    ]

    private var session: NFCNDEFReaderSession?
    private var pending: CAPPluginCall?
    private var writeURL: URL?
    private var timeoutWork: DispatchWorkItem?

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
