//go:build !windows

package download

import (
	"os/exec"
	"syscall"
	"time"
)

// killProcessTree terminates the process group by first sending SIGTERM, then
// escalating to SIGKILL after a 2-second grace period if the group is still
// alive. This ensures stubborn child processes (yt-dlp/ffmpeg ignoring SIGTERM
// during large file processing) are force-killed, preventing zombie processes
// and leftover .part files.
func killProcessTree(pid int) error {
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		return nil
	}
	// Send SIGTERM to the entire process group.
	_ = syscall.Kill(-pgid, syscall.SIGTERM)
	// SIGKILL fallback: after the grace period, check if the group still
	// exists and force-kill it if so.
	go func() {
		time.Sleep(2 * time.Second)
		// Signal 0 checks process existence without actually sending a signal.
		if err := syscall.Kill(-pgid, 0); err == nil {
			_ = syscall.Kill(-pgid, syscall.SIGKILL)
		}
	}()
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
