//go:build !windows

package terminal

import "syscall"

func killProcessGroup(pid int) {
	syscall.Kill(-pid, syscall.SIGKILL)
}
