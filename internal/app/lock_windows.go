//go:build windows

package app

import (
	"os"
	"syscall"
	"unsafe"
)

var (
	kernel32       = syscall.NewLazyDLL("kernel32.dll")
	procLockFileEx = kernel32.NewProc("LockFileEx")
)

const (
	LOCKFILE_EXCLUSIVE_LOCK   = 0x00000002
	LOCKFILE_FAIL_IMMEDIATELY = 0x00000001
)

// tryLockFile acquires an exclusive, non-blocking lock on the open file using
// the Win32 LockFileEx API. OS-level file locks are released automatically by
// the kernel when the process exits (even on crash or kill), so a stale lock
// file on disk never prevents a future startup from re-acquiring the lock.
func tryLockFile(f *os.File) error {
	// LockFileEx(handle, flags, reserved, lenLow, lenHigh, ol)
	var ol [24]byte // OVERLAPPED struct, zeroed
	h := syscall.Handle(f.Fd())
	r1, _, err := procLockFileEx.Call(
		uintptr(h),
		uintptr(LOCKFILE_EXCLUSIVE_LOCK|LOCKFILE_FAIL_IMMEDIATELY),
		0,
		1, // lock 1 byte
		0,
		uintptr(unsafe.Pointer(&ol[0])),
	)
	if r1 == 0 {
		return err
	}
	return nil
}
