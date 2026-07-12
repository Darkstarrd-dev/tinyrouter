//go:build windows

package download

import (
	"os/exec"
	"strconv"
)

// killProcessTree 终止进程及其整个子进程树（Windows）。
// 使用 taskkill /PID <pid> /T /F。
func killProcessTree(pid int) error {
	return exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F").Run()
}

// setupProcessGroup 在 Windows 上无需设置进程组（taskkill /T 已处理整棵树）。
func setupProcessGroup(cmd *exec.Cmd) {
}
