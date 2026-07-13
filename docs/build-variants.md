# 构建变体 (Build Variants)

> 最后核对：2026-07-14

TinyRouter 通过 build tag + 链接器 flag 组合，提供多个构建变体。Windows 下用 `build.ps1` 一键产出。

## build.ps1 参数

```powershell
./build.ps1 [-Variant default|tray|webview|debug] [-Playground] [-Strip] [-All] [-OutputDir dist]
```

- 不加参数 = 仅产出 default 变体一个 exe
- `-All` = 一次性产出全部 13 个变体（忽略 `-Variant` / `-Playground` / `-Strip`）

## Variant 含义

| Variant | 行为 | tags | ldflags | CGO |
|---|---|---|---|---|
| `default` | console 窗口 + 自动打开浏览器(当前行为) | — | — | 无 |
| `tray` | 系统托盘常驻,无 console 窗口,右键菜单"打开控制台/退出" | `tray` | `-H windowsgui` | 无 |
| `webview` | tray + WebView2 原生窗口右键菜单多一项"打开独立窗口"(Win10/11 自带 Runtime,纯 Go) | `tray,webview` | `-H windowsgui` | 无 |
| `debug` | 全 DWARF/console 窗口,供 `dlv` 调试;Playground/Strip 被忽略 | — | — | 无 |

## 关键开关

- **-Playground**: 启用 `playground` build tag,内嵌 `web/playground/static-pg` 资产(无此 tag 用 `web/embed_playground_stub.go` 空 FS)
- **-Strip**: 加 `-ldflags "-s -w"` 剥离符号表 + DWARF,减约 3.6 MB;失去 `dlv` 调试能力,运行不感知

## 默认构建 vs 标签构建

- **无 tag** = 当前行为(console 窗口 + 浏览器),`go build -o tinyrouter .` 与 `./build.ps1` 等价
- **`-tags tray`** = 切换到 `host_tray_windows.go`,引入 `fyne.io/systray`;无此 tag 用 `host_console.go`
- **`-tags "tray,webview"`** = tray 基础上引入 `host_webview_windows.go` + `jchv/go-webview2`;托盘菜单多一项"打开独立窗口",在 Win10/11 上用 WebView2 Runtime 弹出原生窗口加载 admin UI;关闭窗口不退出进程,仍可再次打开
- **`-tags playground`** = 切换到 `web/embed_playground.go`,内嵌 Playground 资产;无此 tag 用 `web/embed_playground_stub.go`

## 13 产物矩阵 (实际体积,基于 1024×1024 logo.png 多尺寸 ICO)

| Variant | Playground | Strip | 输出文件 | 体积 |
|---|---|---|---|---|
| default | 否 | 否 | `tinyrouter.exe` | 15.15 MB |
| default | 否 | 是 | `tinyrouter-stripped.exe` | 11.51 MB |
| default | 是 | 否 | `tinyrouter-pg.exe` | 19.17 MB |
| default | 是 | 是 | `tinyrouter-pg-stripped.exe` | 15.53 MB |
| tray | 否 | 否 | `tinyrouter-tray.exe` | 15.62 MB |
| tray | 否 | 是 | `tinyrouter-tray-stripped.exe` | 11.77 MB |
| tray | 是 | 否 | `tinyrouter-tray-pg.exe` | 19.64 MB |
| tray | 是 | 是 | `tinyrouter-tray-pg-stripped.exe` | 15.79 MB |
| webview | 否 | 否 | `tinyrouter-webview.exe` | 16.02 MB |
| webview | 否 | 是 | `tinyrouter-webview-stripped.exe` | 12.09 MB |
| webview | 是 | 否 | `tinyrouter-webview-pg.exe` | 20.04 MB |
| webview | 是 | 是 | `tinyrouter-webview-pg-stripped.exe` | 16.11 MB |
| debug | — | — | `tinyrouter-debug.exe` | 15.15 MB |

Playground 模块增量约 +4.0 MB;Strip 减约 3.6 MB;Tray 仅增约 +0.3 MB(纯 Go,无 CGO);WebView 在 tray 基础再增约 +0.4 MB(`jchv/go-webview2` 纯 Go + 内嵌 WebView2Loader 字节)。

## 图标资源

`web/static/favicon.ico` 通过 `gen-icon.ps1` 从 `web/static/logo.png` (1024×1024) 生成,内嵌 7 个尺寸(16/24/32/48/64/128/256),覆盖托盘、资源管理器、任务栏、Alt+Tab、jumplist 全部 DPI 场景。`rsrc.syso` 自动同步,无需手动维护;改 logo 后跑 `./gen-icon.ps1` 再 `go generate ./...`。
