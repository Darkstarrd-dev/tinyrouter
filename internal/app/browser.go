package app

import (
	"os/exec"
	"runtime"
)

// OpenBrowser opens the default browser for the current OS. It is used both by
// the console host (auto-open on start) and by the tray menu "打开控制台" item.
func OpenBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}
