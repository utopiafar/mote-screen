import AppKit
import SwiftUI

@MainActor
final class WindowHost {
    static let shared = WindowHost()
    private var windows: [String: NSWindow] = [:]

    func openWizard() { show(id: "wizard", title: "开始设置", size: NSSize(width: 500, height: 520), view: WizardView()) }
    func openSettings(tab: SettingsTab = .general) {
        AppModel.shared.objectWillChange.send()
        show(id: "settings", title: "设置", size: NSSize(width: 760, height: 640), view: SettingsView(tab: tab))
    }
    func close(id: String) { windows[id]?.close(); windows[id] = nil }

    private func show<V: View>(id: String, title: String, size: NSSize, view: V) {
        if let window = windows[id] {
            window.title = title
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = title
        window.contentView = NSHostingView(rootView: view.environmentObject(AppModel.shared))
        window.center()
        window.isReleasedWhenClosed = false
        windows[id] = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        Task { @MainActor in
            if !AppModel.shared.setupDone {
                WindowHost.shared.openWizard()
            }
        }
    }
}
