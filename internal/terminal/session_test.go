package terminal

import (
	"os/exec"
	"testing"
)

func TestDefaultShell(t *testing.T) {
	shell := defaultShell()
	if shell == "" {
		t.Fatal("defaultShell() returned empty string")
	}
	_, err := exec.LookPath(shell)
	if err != nil {
		t.Errorf("default shell %q not found in PATH: %v", shell, err)
	}
}

func TestClose(t *testing.T) {
	s := &Session{
		closed: false,
	}

	s.Close()

	if !s.closed {
		t.Error("expected closed to be true after Close")
	}

	s.Close()
}

func TestKillProcessGroup(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("killProcessGroup panicked: %v", r)
		}
	}()

	killProcessGroup(999999)
}

func TestDefaultShellChecksWindowsFallback(t *testing.T) {
	shell := defaultShell()
	if shell == "" {
		t.Fatal("defaultShell() should not be empty")
	}
}

func TestKillProcessGroupZero(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("killProcessGroup(0) panicked: %v", r)
		}
	}()

	killProcessGroup(0)
}