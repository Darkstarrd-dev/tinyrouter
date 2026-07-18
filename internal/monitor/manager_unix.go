//go:build !windows

package monitor

import (
	"os/exec"
	"syscall"
	"time"
)

func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killProcessGroup sends SIGTERM to the process group, then escalates to
// SIGKILL after a 2-second grace period. This ensures stubborn monitor
// commands that ignore SIGTERM are force-killed, preventing the Manager from
// getting stuck in "running" state forever.
func killProcessGroup(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	pgid := -cmd.Process.Pid
	_ = syscall.Kill(pgid, syscall.SIGTERM)
	go func() {
		time.Sleep(2 * time.Second)
		if err := syscall.Kill(pgid, 0); err == nil {
			_ = syscall.Kill(pgid, syscall.SIGKILL)
		}
	}()
}
