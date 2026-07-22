// Package fsutil provides shared filesystem utilities: atomic file writes,
// system file-manager invocations, and browser-open helpers.
package fsutil

import (
	"fmt"
	"os"
)

// AtomicWrite writes data to path atomically using a deterministic temp file
// (path + ".tmp") followed by os.Rename. The deterministic naming preserves
// crash-recovery semantics: callers can look for path+".tmp" on next startup
// to detect and apply pending writes that never completed.
//
// On rename failure (e.g. Windows file lock), AtomicWrite falls back to a
// direct os.WriteFile. If both rename and direct write fail, the .tmp file
// remains on disk (data is not lost) and an error is returned.
//
// The caller is responsible for ensuring the parent directory exists.
func AtomicWrite(path string, data []byte, perm os.FileMode) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, perm); err != nil {
		return err
	}
	if renameErr := os.Rename(tmp, path); renameErr != nil {
		// Fallback: direct write to target (works if the lock was transient).
		if writeErr := os.WriteFile(path, data, perm); writeErr != nil {
			// Both rename and direct write failed — target is actively locked.
			// .tmp retains the data; caller may use it for crash recovery.
			return fmt.Errorf("file locked (rename and direct write both failed); pending data in %s: %w", tmp, writeErr)
		}
		// Direct write succeeded; clean up the now-redundant .tmp file.
		_ = os.Remove(tmp)
		return nil
	}
	return nil
}
