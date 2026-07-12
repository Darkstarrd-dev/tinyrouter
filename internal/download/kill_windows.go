//go:build windows

package download

import (
	"os/exec"
	"strconv"
	"syscall"
)

// CREATE_NO_WINDOW (0x08000000) 避免被 spawn 的命令（yt-dlp / ffmpeg）弹出
// 可见的控制台窗口。否则每次下载都会闪出一个 cmd 窗口。
const createNoWindow = 0x08000000

// killProcessTree 终止进程及其整个子进程树（Windows）。
// 使用 taskkill /PID <pid> /T /F。
func killProcessTree(pid int) error {
	return exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F").Run()
}

// setupProcessGroup 在 Windows 上为子进程设置创建标志，避免弹出可见控制台窗口。
// 保留 CREATE_NEW_PROCESS_GROUP 以便 taskkill /T 能终止整棵进程树。
func setupProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | createNoWindow,
	}
}
