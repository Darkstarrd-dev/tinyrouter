//go:build windows

package monitor

import (
	"os/exec"
	"strconv"
	"syscall"
)

// CREATE_NO_WINDOW (0x08000000) prevents the spawned command from
// flashing a visible console window. Without this, every monitor
// command (especially looping ones like "nvidia-smi -l 1") pops up
// a cmd window on each execution.
const createNoWindow = 0x08000000

func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | createNoWindow,
	}
}

func killProcessGroup(cmd *exec.Cmd) {
	exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid)).Run()
}
