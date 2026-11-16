import SwiftUI
import MoteScreenCore

enum SettingsTab: String, CaseIterable, Identifiable {
    case general, speed, hook, eink, debug, cleanup, about
    var id: String { rawValue }
    var title: String {
        switch self {
        case .general: return "一般"
        case .speed: return "Agent Speed"
        case .hook: return "Codex"
        case .eink: return "墨水屏"
        case .debug: return "调试"
        case .cleanup: return "清理"
        case .about: return "关于"
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @State var tab: SettingsTab
    @State private var code = ""

    init(tab: SettingsTab = .general) { _tab = State(initialValue: tab) }

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(SettingsTab.allCases) { item in
                    Button(item.title) { tab = item }
                        .buttonStyle(.plain)
                        .font(.system(size: 13))
                        .padding(.vertical, 5)
                        .padding(.horizontal, 8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(tab == item ? Color.primary.opacity(0.08) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                Spacer()
            }
            .padding(8)
            .frame(width: 168)
            .background(Color(nsColor: .controlBackgroundColor))
            ScrollView { pane.padding(20).frame(maxWidth: .infinity, alignment: .leading) }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    @ViewBuilder private var pane: some View {
        switch tab {
        case .general: general
        case .speed: speed
        case .hook: hook
        case .eink: eink
        case .debug: debug
        case .cleanup: cleanup
        case .about: about
        }
    }

    private var general: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("一般").font(.system(size: 17, weight: .semibold))
            group {
                Toggle("开机启动", isOn: Binding(get: { model.loginItem }, set: { model.setLogin($0) }))
                Text("打开时，系统可能会再确认一次").font(.system(size: 11)).foregroundStyle(.secondary)
                Button("打开向导") { model.reopenWizard() }
                Text("第一次安装的步骤可以随时重来").font(.system(size: 11)).foregroundStyle(.secondary)
            }
            LabeledContent("显示内容") { Text("仅连接状态").foregroundStyle(.secondary) }
            Text("速度看 Agent Speed，对话在 Codex 里处理，不在菜单栏重复显示。")
                .font(.system(size: 12)).foregroundStyle(.secondary)
        }
    }

    private var speed: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Agent Speed").font(.system(size: 17, weight: .semibold))
            Text("从它的局域网接口读速度。接口默认是关的，需要在 Agent Speed 里打开。").font(.system(size: 13))
            group {
                line("状态", linkLabel(model.speedConnected).rawValue)
                line("端口", "7247")
                line("访问码", model.settings.accessCode.isEmpty ? "未填写" : "已保存")
            }
            TextField("访问码", text: $code).textFieldStyle(.roundedBorder).frame(width: 180)
            HStack {
                Button("测试连接") { model.connectSpeed() }
                Button("更改访问码") { model.saveAccessCode(code) }
            }
            Text("未连接时，先确认 Agent Speed 已打开局域网，端口一致，访问码没有改过。")
                .font(.system(size: 12)).foregroundStyle(.secondary)
        }
    }

    private var hook: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Codex").font(.system(size: 17, weight: .semibold))
            if model.hook == .broken {
                Text("Hook 已失效").font(.system(size: 13, weight: .semibold)).foregroundStyle(.red)
                Text("找不到我们登记的条目，或脚本已经不在原位置。常见原因是用户目录下的 .codex/hooks.json 被改写，或数据目录里的脚本被移走。")
                    .font(.system(size: 13))
            } else if model.hook == .installed {
                Text("Hook 已安装。它只通知「有事要看」，不会把对话正文送到墨水屏。").font(.system(size: 13))
            } else {
                Text("还没有安装 hook。装上之后，Codex 需要你批准或一轮结束时，会通知这个客户端。不会传送对话正文。").font(.system(size: 13))
            }
            group {
                line("Codex", "已检测到")
                line("Hook 状态", model.hook.rawValue)
                line("登记位置", ".codex/hooks.json")
                line("事件", "PermissionRequest · Stop")
            }
            HStack {
                Button(model.hook == .installed || model.hook == .broken ? "重新安装 hook" : "安装 hook") { model.installHook() }
                if model.hook == .installed {
                    Button("发送测试") { model.sendTest() }
                    Button("移除") { model.removeHook() }
                }
            }
            Text("重新安装只会写回我们自己的脚本和条目，不会覆盖你的其他 hook。")
                .font(.system(size: 12)).foregroundStyle(.secondary)
        }
    }

    private var eink: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("墨水屏").font(.system(size: 17, weight: .semibold))
            Text("设备能连上再接。还连不上就保持未连接即可。默认走 Wi-Fi。蓝牙只用于这块屏上的自制固件，不是出厂系统里的通道。")
                .font(.system(size: 13))
            group {
                line("状态", linkLabel(model.panelConnected).rawValue)
                line("地址", model.addressLabel)
                line("当前发送", model.pipeLabel)
            }
            Text("连接方式").font(.system(size: 11)).foregroundStyle(.secondary)
            Picker("主路径", selection: Binding(get: { model.settings.link }, set: { value in
                model.updateSettings { $0.link = value }
            })) {
                Text("Wi-Fi").tag(LinkChoice.wifi)
                Text("蓝牙").tag(LinkChoice.bluetooth)
            }
            .pickerStyle(.segmented)
            .frame(width: 220)
            Toggle("插入时自动用 USB", isOn: Binding(get: { model.settings.usbFallback }, set: { on in
                model.updateSettings { $0.usbFallback = on }
            }))
            Text("插着的时候改走串口，不会关掉上面选的 Wi-Fi 或蓝牙。这台 Mac 上可能有不止一个 ESP32 串口，选错端口无效。")
                .font(.system(size: 11)).foregroundStyle(.secondary)
            Text("通信频率").font(.system(size: 11)).foregroundStyle(.secondary)
            Picker("预设", selection: Binding(get: { model.settings.preset }, set: { name in
                guard name == "saver" || name == "balanced" || name == "timely" else { return }
                model.updateSettings { $0 = $0.applying(preset: name) }
            })) {
                Text("省电").tag("saver")
                Text("均衡").tag("balanced")
                Text("及时").tag("timely")
                Text("自定义").tag("custom")
            }
            .pickerStyle(.segmented)
            intervalPicker("生成中", keyPath: \.pushGeneratingSec)
            intervalPicker("空闲时", keyPath: \.pushIdleSec)
            Text("需要你批准，或一轮结束，会马上推过去，不等上面的间隔。")
                .font(.system(size: 12)).foregroundStyle(.secondary)
            Text("墨水屏刷新").font(.system(size: 11)).foregroundStyle(.secondary)
            Toggle("有新内容时局部刷新", isOn: Binding(get: { model.settings.partialOnChange }, set: { on in
                model.updateSettings { $0.partialOnChange = on }
            }))
            Picker("完整刷新", selection: Binding(get: { model.settings.fullEveryN }, set: { n in
                model.updateSettings { $0.fullEveryN = n }
            })) {
                ForEach(ScreenSettings.fullEveryNChoices, id: \.self) { n in Text("每 \(n) 次局部刷新").tag(n) }
            }
            Picker("或每隔", selection: Binding(get: { model.settings.fullEveryMin }, set: { n in
                model.updateSettings { $0.fullEveryMin = n }
            })) {
                ForEach(ScreenSettings.fullEveryMinChoices, id: \.self) { n in Text("\(n) 分钟").tag(n) }
            }
            Text("换页不闪屏。基线刷新只在开机，以及每 N 次局部刷新或每隔几分钟清一次残影，这时可能会闪一下。局部更快、更省电。默认按均衡来，照顾 1200 mAh 的电池。")
                .font(.system(size: 12)).foregroundStyle(.secondary)
            HStack {
                Button("扫描 Wi-Fi 设备") { model.scanWiFi() }
                Button("扫描蓝牙设备") { model.scanBluetooth() }
                Button("选取 USB 设备") { model.refreshPorts() }
            }
            if model.pickingUSB {
                ForEach(model.usbPorts, id: \.self) { port in
                    Button(port) { model.choosePort(port) }
                }
                if model.usbPorts.count > 1 {
                    Text("看到不止一个 ESP32 口。请确认是这块屏，选错了没有画面。")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
                if model.usbPorts.isEmpty {
                    Text("没有发现 ESP32 串口。").font(.system(size: 12)).foregroundStyle(.secondary)
                }
            }
        }
    }

    private var debug: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("调试").font(.system(size: 17, weight: .semibold))
            Text(model.logLines.joined(separator: "\n") + (model.lastFrame.isEmpty ? "" : "\n\n最近一帧\n\(model.lastFrame)"))
                .font(.system(size: 11, design: .monospaced))
                .frame(maxWidth: .infinity, minHeight: 180, alignment: .topLeading)
                .padding(8)
                .background(Color.black)
                .foregroundStyle(Color.white)
            HStack {
                Button("注入「等待批准」") { model.sendTest() }
                Button("重试全部连接") { model.connectSpeed(); model.scanWiFi() }
            }
            Text("注入事件只用来预览，不会改 Codex 里的真实对话。").font(.system(size: 12)).foregroundStyle(.secondary)
        }
    }

    private var cleanup: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("清理").font(.system(size: 17, weight: .semibold))
            Text("不用了，或准备卸载时，先在这里收拾干净。卸掉应用前如果不移除 hook，Codex 仍可能调用已经不存在的脚本。")
                .font(.system(size: 13))
            Button(model.hook == .removed || model.hook == .missing ? "已移除" : "移除 Codex hook") { model.removeHook() }
            Button("清除已保存的连接信息") { model.clearSecrets() }
            Toggle("开机启动", isOn: Binding(get: { model.loginItem }, set: { model.setLogin($0) }))
            Button("退出") { model.quitForTrash() }
            if model.quitHint {
                Text("hook 和连接信息已经清掉。请自行把应用拖到废纸篓。").font(.system(size: 12)).foregroundStyle(.secondary)
            }
        }
    }

    private var about: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("关于").font(.system(size: 17, weight: .semibold))
            line("这个客户端", "只显示连接状态")
            line("版本", "1.0")
            Text("速度看 Agent Speed，对话在 Codex 里处理。墨水屏用来在主显示器之外瞥一眼是否有事要处理。")
                .font(.system(size: 12)).foregroundStyle(.secondary)
        }
    }

    private func intervalPicker(_ title: String, keyPath: WritableKeyPath<ScreenSettings, Int>) -> some View {
        Picker(title, selection: Binding(get: { model.settings[keyPath: keyPath] }, set: { value in
            model.updateSettings { $0[keyPath: keyPath] = value }
        })) {
            ForEach(ScreenSettings.pushChoices, id: \.self) { sec in Text(formatSeconds(sec)).tag(sec) }
        }
    }

    private func line(_ name: String, _ value: String) -> some View {
        HStack { Text(name); Spacer(); Text(value).foregroundStyle(model.hook == .broken && name == "Hook 状态" ? Color.red : Color.secondary) }
            .font(.system(size: 13))
    }

    private func group<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) { content() }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white.opacity(0.7))
            .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
