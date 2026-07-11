//go:build windows

package terminal

import (
	"os/exec"
	"strconv"
)

func killProcessGroup(pid int) {
	_ = exec.Command("taskkill", "/F", "/T", "/PID", strconv.Itoa(pid)).Run()
}
