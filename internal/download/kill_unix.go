//go:build !windows

package download

import (
	"os/exec"
	"strconv"
	"syscall"
)

// killProcessTree 终止进程及其整个子进程树（Unix）。
// 向进程组发送 SIGTERM（子进程已成为独立进程组组长，见 setupProcessGroup）。
func killProcessTree(pid int) error {
	pgid, err := syscall.Getpgid(pid)
	if err == nil {
		_ = syscall.Kill(-pgid, syscall.SIGTERM)
	}
	return nil
}

// setupProcessGroup 让子进程成为独立进程组的组长（Unix），
// 以便 killProcessTree 能整组终止（含 ffmpeg 子进程）。
func setupProcessGroup(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setpgid = true
}
