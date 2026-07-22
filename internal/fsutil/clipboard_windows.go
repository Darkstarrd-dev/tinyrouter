//go:build windows

package fsutil

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// GetClipboardFilePaths reads file paths from the Windows clipboard (CF_HDROP
// format). This is populated when the user copies files in Explorer (Ctrl+C).
// Returns nil if the clipboard does not contain file paths or is unavailable.
func GetClipboardFilePaths() []string {
	user32 := windows.NewLazySystemDLL("user32.dll")
	shell32 := windows.NewLazySystemDLL("shell32.dll")

	procOpenClipboard := user32.NewProc("OpenClipboard")
	procCloseClipboard := user32.NewProc("CloseClipboard")
	procGetClipboardData := user32.NewProc("GetClipboardData")
	procDragQueryFileW := shell32.NewProc("DragQueryFileW")

	const cfHdrop = 15

	// OpenClipboard(NULL) — open for reading.
	hr, _, _ := procOpenClipboard.Call(0)
	if hr == 0 {
		return nil
	}
	defer procCloseClipboard.Call()

	// GetClipboardData(CF_HDROP) returns an HDROP handle.
	hDrop, _, _ := procGetClipboardData.Call(cfHdrop)
	if hDrop == 0 {
		return nil
	}

	// Query count: DragQueryFileW(hDrop, 0xFFFFFFFF, NULL, 0) returns count.
	count, _, _ := procDragQueryFileW.Call(hDrop, 0xFFFFFFFF, 0, 0)
	if count == 0 {
		return nil
	}

	paths := make([]string, 0, count)
	buf := make([]uint16, 1024)
	for i := uint32(0); i < uint32(count); i++ {
		n, _, _ := procDragQueryFileW.Call(hDrop, uintptr(i), uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
		if n > 0 {
			paths = append(paths, windows.UTF16ToString(buf[:n]))
		}
	}
	return paths
}
