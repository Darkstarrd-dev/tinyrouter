//go:build windows

package api

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows"
)

// openInExplorer opens path in Windows Explorer. If path is a file, Explorer
// opens its parent folder and selects the file. If path is a directory (or stat
// fails), Explorer opens the path or its parent directory.
//
// Uses ShellExecute instead of exec.Command because explorer.exe is a
// single-instance shell: a new process started via CreateProcess forwards its
// command line to the already-running explorer instance over DDE, which often
// drops the path argument and falls back to the Documents folder. ShellExecute
// goes through the shell and correctly delivers the path.
func openInExplorer(path string) error {
	verb, _ := windows.UTF16PtrFromString("open")
	fi, err := os.Stat(path)
	if err == nil && !fi.IsDir() {
		// File: launch explorer.exe with /select,"path" to highlight it.
		exe, _ := windows.UTF16PtrFromString("explorer.exe")
		params, _ := windows.UTF16PtrFromString(`/select,"` + path + `"`)
		return windows.ShellExecute(0, verb, exe, params, nil, windows.SW_SHOWNORMAL)
	}
	if err != nil {
		// Stat failed: fall back to opening the parent directory.
		dir := filepath.Dir(path)
		if dir != "" && dir != "." {
			_ = os.MkdirAll(dir, 0755)
			path = dir
		}
	}
	// Directory (or stat-failed fallback): open path with the default verb.
	file, _ := windows.UTF16PtrFromString(path)
	return windows.ShellExecute(0, verb, file, nil, nil, windows.SW_SHOWNORMAL)
}