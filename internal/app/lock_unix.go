//go:build !windows

package app

import (
	"os"

	"golang.org/x/sys/unix"
)

// tryLockFile acquires an exclusive, non-blocking advisory lock on the open
// file. OS-level file locks are released automatically by the kernel when the
// process exits (even on crash or kill), so a stale lock file on disk never
// prevents a future startup from re-acquiring the lock.
func tryLockFile(f *os.File) error {
	return unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB)
}
