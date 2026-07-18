//go:build windows

package terminal

import (
	"os/exec"
	"strconv"
	"syscall"
)

func killProcessGroup(pid int) {
	cmd := exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid))
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	_ = cmd.Run()
}
