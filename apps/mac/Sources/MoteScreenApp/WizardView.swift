import SwiftUI
import MoteScreenCore

struct WizardView: View {
    @EnvironmentObject private var model: AppModel
    @State private var step = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch step {
            case 0: welcome
            case 1: speed
            case 2: hook
            case 3: panel
            default: done
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var welcome: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("第一次打开").font(.system(size: 11)).foregroundStyle(.secondary)
            Text("开始设置").font(.system(size: 17, weight: .semibold))
            Text("这个客户端只显示连接状态。先接上 Agent Speed，再给 Codex 安装 hook。墨水屏可以稍后再连。速度仍在 Agent Speed 里看，对话仍在 Codex 里处理。")
                .font(.system(size: 13))
            VStack(alignment: .leading, spacing: 6) {
                Text("1  连接 Agent Speed")
                Text("2  安装 Codex hook")
                Text("3  连接墨水屏，可稍后")
            }.font(.system(size: 13))
            Text("开机时启动。建议打开。系统可能会再确认一次。").font(.system(size: 12)).foregroundStyle(.secondary)
            Spacer()
            HStack { Spacer(); Button("继续") { step = 1 }.keyboardShortcut(.defaultAction) }
        }
    }

    private var speed: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("1 / 3").font(.system(size: 11)).foregroundStyle(.secondary)
            Text("连接 Agent Speed").font(.system(size: 17, weight: .semibold))
            Text(model.speedConnected
                 ? "已经连上，速度数据可以从这里转给墨水屏。"
                 : "检测到 Agent Speed 在运行，但局域网还没打开，默认是关的。打开后点重新检测。")
                .font(.system(size: 13))
            statusBox(title: "Agent Speed", value: linkLabel(model.speedConnected).rawValue,
                      body: model.speedConnected ? "端口 7247，访问码已保存。" : "在 Agent Speed 里打开局域网。默认端口 7247，如有访问码，填在下面。")
            Spacer()
            HStack {
                Button("上一步") { step = 0 }
                Spacer()
                Button("跳过") { model.speedConnected = false; step = 2 }
                if model.speedConnected {
                    Button("继续") { step = 2 }.keyboardShortcut(.defaultAction)
                } else {
                    Button("重新检测") { model.connectSpeed() }.keyboardShortcut(.defaultAction)
                }
            }
        }
    }

    private var hook: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("2 / 3").font(.system(size: 11)).foregroundStyle(.secondary)
            Text("安装 Codex hook").font(.system(size: 17, weight: .semibold))
            Text("Codex 在需要你批准、或一轮结束时，会调用一个小脚本。脚本只通知「有事要看」，不会传送对话正文。")
                .font(.system(size: 13))
            statusBox(title: "Codex hook", value: model.hook == .installed ? "已安装" : "未安装",
                      body: "已检测到本机有 Codex。安装时会把脚本放到本应用的数据目录，并写入用户目录下的 .codex/hooks.json，只追加我们的条目。")
            Spacer()
            HStack {
                Button("上一步") { step = 1 }
                Spacer()
                Button("跳过") { step = 3 }
                if model.hook == .installed {
                    Button("继续") { step = 3 }.keyboardShortcut(.defaultAction)
                } else {
                    Button("安装 hook") { model.installHook() }.keyboardShortcut(.defaultAction)
                }
            }
        }
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("3 / 3").font(.system(size: 11)).foregroundStyle(.secondary)
            Text("连接墨水屏").font(.system(size: 17, weight: .semibold))
            Text("设备还连不上的话，可以先跳过。跳过后这一项是「未连接」，等能连了再来设置里接上。")
                .font(.system(size: 13))
            statusBox(title: "墨水屏", value: linkLabel(model.panelConnected).rawValue,
                      body: "之后可用 Wi-Fi 地址连接，或在插着 USB 时选取设备。这台 Mac 上可能有不止一个 ESP32 串口，请确认是这块屏。蓝牙只用于自制固件。")
            Spacer()
            HStack {
                Button("上一步") { step = 2 }
                Spacer()
                Button("稍后在设置里连接") { step = 4 }
                Button("跳过") { step = 4 }.keyboardShortcut(.defaultAction)
            }
        }
    }

    private var done: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("设置完成").font(.system(size: 11)).foregroundStyle(.secondary)
            Text("之后看菜单栏就行").font(.system(size: 17, weight: .semibold))
            Text("点开能看到三项各自的状态。设置、调试和清理都在同一个窗口里。")
                .font(.system(size: 13))
            VStack(alignment: .leading, spacing: 6) {
                labeled("开机启动", model.loginItem ? "开" : "关")
                labeled("Agent Speed", linkLabel(model.speedConnected).rawValue)
                labeled("Codex hook", model.hook.rawValue)
                labeled("墨水屏", linkLabel(model.panelConnected).rawValue)
            }.font(.system(size: 13))
            Spacer()
            HStack {
                Button("上一步") { step = 3 }
                Spacer()
                Button("完成") { model.finishSetup() }.keyboardShortcut(.defaultAction)
            }
        }
    }

    private func labeled(_ name: String, _ value: String) -> some View {
        HStack { Text(name); Spacer(); Text(value).foregroundStyle(.secondary) }
    }

    private func statusBox(title: String, value: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack { Text(title).font(.system(size: 13, weight: .semibold)); Spacer(); Text(value).foregroundStyle(.secondary) }
            Text(body).font(.system(size: 12)).foregroundStyle(.secondary)
        }
        .padding(12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
