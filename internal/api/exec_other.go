//go:build !windows

package api

import "os/exec"

func setCmdHideWindow(cmd *exec.Cmd) {}
