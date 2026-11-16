import SwiftUI
import MoteScreenCore

@main
struct MoteScreenApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var model = AppModel.shared

    var body: some Scene {
        MenuBarExtra {
            PopoverView()
                .environmentObject(model)
        } label: {
            Text(model.menuText)
        }
        .menuBarExtraStyle(.window)
    }
}

struct PopoverView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("连接状态").font(.system(size: 13, weight: .semibold))
            Text("速度看 Agent Speed，对话在 Codex 里处理")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
            VStack(spacing: 0) {
                row("墨水屏", linkLabel(model.panelConnected).rawValue, bad: false)
                row("Agent Speed", linkLabel(model.speedConnected).rawValue, bad: false)
                row("Codex hook", model.hook.rawValue, bad: model.hook == .broken)
            }
            .background(Color.white)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            HStack {
                Button("设置") { WindowHost.shared.openSettings() }
                Spacer()
                Button("调试") { WindowHost.shared.openSettings(tab: .debug) }
            }
            .buttonStyle(.plain)
            .font(.system(size: 12))
        }
        .padding(12)
        .frame(width: 280)
    }

    private func row(_ name: String, _ value: String, bad: Bool) -> some View {
        HStack {
            Text(name).font(.system(size: 13))
            Spacer()
            Text(value).font(.system(size: 12)).foregroundStyle(bad ? Color.red : Color.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
    }
}
