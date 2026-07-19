//go:build !windows

package api

import (
	"os/exec"
	"path/filepath"
	"runtime"
)

// openInExplorer opens path in the platform's file manager. On macOS it uses
// `open -R` to reveal the file in Finder. On Linux it opens the parent
// directory with xdg-open. macOS and Linux do not have explorer.exe's
// single-instance DDE issue, so exec.Command is sufficient.
func openInExplorer(path string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", "-R", path)
	default:
		cmd = exec.Command("xdg-open", filepath.Dir(path))
	}
	return cmd.Start()
}