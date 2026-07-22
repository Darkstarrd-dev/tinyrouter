//go:build !windows

package fsutil

// GetClipboardFilePaths is not supported on non-Windows platforms.
// Returns nil always.
func GetClipboardFilePaths() []string {
	return nil
}
