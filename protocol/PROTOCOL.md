# 协议 v1

Mac 把速度和 Codex 待处理推到墨水屏。设备不用把对话正文传回来。

Wi-Fi 是默认通道：设备在 TCP `7427` 上收，一行一个 JSON 对象，UTF-8，以 `\n` 结尾。蓝牙走同一个 JSON，按写入拼到换行。USB 串口也是同一份 NDJSON，只在插着并且打开了「插入时自动用 USB」时由 Mac 改走串口。这不会把 Wi-Fi 或蓝牙从设置里关掉。

`v` 固定为 `1`。不认识的字段忽略。`v` 不是 1 时，设备回一条 `error`，并保持上一帧画面。一行（不含换行）最长 16384 字节，够放下 8 条标题。更长的行整行丢掉，并回 `{"v":1,"type":"error","error":"frameTooLarge"}`。

## 帧

### hello

连接刚建立时双方各发一次。

```json
{"v":1,"type":"hello","role":"mac"}
```

`role` 是 `mac` 或 `device`。

### config

设置变化时，以及每次连上之后，Mac 推一份。设备用它决定无线电和刷新，不自己发明策略。

```json
{"v":1,"type":"config","seq":1,"link":"wifi","usbFallback":true,"pushGeneratingSec":15,"pushIdleSec":60,"partialOnChange":true,"fullEveryN":10,"fullEveryMin":10}
```

| 字段 | 含义 |
| --- | --- |
| `link` | `wifi` 或 `bluetooth`。没有第三种互斥值。 |
| `usbFallback` | 为真时，Mac 发现选定的串口插着就改走 USB。 |
| `pushGeneratingSec` | 生成中或调用工具时，速度帧的最小间隔。可选 5、15、30、60、300。 |
| `pushIdleSec` | 空闲时的间隔，同一组可选值。 |
| `partialOnChange` | 有新画面时先局部刷新。 |
| `fullEveryN` | 累计这么多次局部刷新后，下一次改为基线刷新。 |
| `fullEveryMin` | 距离上次基线刷新达到这么多分钟，也做一次基线刷新，用来清残影。 |

Codex 的 `PermissionRequest` 和 `Stop` 不看这两个间隔，收到就推 `inbox`。

可选的 Wi-Fi 写入只走 USB，不进仓库示例：

```json
{"v":1,"type":"wifi","ssid":"名字","password":"口令"}
```

口令只留在设备 NVS 里。日志里不要打出口令。

### speed

来自 Agent Speed 的数字。可以有其他来源的速度，没有额度。

```json
{"v":1,"type":"speed","seq":12,"phase":"generating","outputTokS":75.9,"sessions":{"active":3,"generating":2,"tools":1},"history":[70,75.9],"sources":[{"name":"Codex","outputTokS":48.2}]}
```

`phase` 是 `generating`、`tools` 或 `idle`。`history` 最多 60 个点。`sources` 最多 8 条。

### inbox

整表替换，不是增量。只收 `source` 为 `codex` 或省略的条目。`kind` 只有 `permission` 和 `stop`。

```json
{"v":1,"type":"inbox","seq":4,"items":[{"id":"perm:1","kind":"permission","title":"允许运行 cargo test","project":"payments-api","at":"2026-11-16T03:57:00.000Z"}]}
```

标题最多 48 个 Unicode 字符，项目名最多 32 个。最多 8 条。不要放对话正文、路径全文、模型名。

### ping、ack、error

```json
{"v":1,"type":"ping","seq":1}
{"v":1,"type":"ack","seq":12,"of":"speed"}
{"v":1,"type":"error","error":"unsupportedVersion"}
```

设备收到 `speed`、`inbox`、`config` 后可以回 `ack`。Mac 把超时看成未连接：至少 45 秒，或空闲推送间隔的 3 倍，取更大的那个。

## 刷新

策略在 Mac 和设备上用同一套判断：

- 开机第一幅：基线。同一帧 1-bit 画面写入 `0x24` 和 `0x26`，然后 `0x22=0xF7`、`0x20`。这一下可能会闪。
- 主桌面、工作台、详情之间的换页：局部。只写 `0x24`，`0x22=0xFF`、`0x20`，不复位面板。`0x26` 留着上一幅，所以只动有变化的点。`partialOnChange` 管不到换页。
- 还在同一页，画面没变，而且还没到基线的时间：不动。
- 到了 `fullEveryMin`，或局部刷新已经做了 `fullEveryN` 次：下一次改为基线（`0xF7`）。关掉局部刷新时，同一页的新画面也走基线。换页仍然是局部，除非这次正好赶上次数或时间。
- 同一页上的新数字、时钟或卡片文字：局部（`0xFF`）。

基线和局部都是面板公开示例里的 1-bit 命令。4 灰阶（`0x1A=0x5A`、`0x22=0xD7`）不用于界面。下一次刷新要等 BUSY 脚空下来。不在这里新造控制器寄存器或 LUT。

## 蓝牙

自制固件上的 GATT 服务，不是出厂固件的通道。

- Service `6d6f7465-7363-7265-656e-000000000001`
- 写入 `6d6f7465-7363-7265-656e-000000000002`：Mac 写入 NDJSON 片段
- 通知 `6d6f7465-7363-7265-656e-000000000003`：设备把 ack 通知出来

片段按顺序拼，见到 `\n` 才算一帧。

## 端口

- 设备 TCP：`7427`
- Mac 本机 hook：`127.0.0.1:7428`，只收摘要，不收对话正文
- Agent Speed 仍是它自己的 `7247`，本协议不占用那个端口
