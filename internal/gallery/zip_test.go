package gallery

import (
	"archive/zip"
	"bytes"
	"errors"
	"testing"
)

func buildTestZip(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	write := func(name string, data []byte) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	write("a.png", []byte("png-fake-bytes"))
	write("notes.txt", []byte("should be ignored"))
	write("images/b.webp", []byte("webp-fake-bytes"))
	write("images/sub/c.jpg", []byte("jpg-fake-bytes"))

	if err := zw.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buf.Bytes()
}

func TestListZipEntries_SortedAndFiltered(t *testing.T) {
	data := buildTestZip(t)
	reader := bytes.NewReader(data)
	manifest, err := ListZipEntries(reader, int64(len(data)))
	if err != nil {
		t.Fatalf("ListZipEntries: %v", err)
	}

	if manifest.Total != 3 {
		t.Fatalf("expected Total 3, got %d", manifest.Total)
	}
	if len(manifest.Entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(manifest.Entries))
	}

	// Sorted ascending by path.
	wantOrder := []string{"a.png", "images/b.webp", "images/sub/c.jpg"}
	for i, e := range manifest.Entries {
		if e.Path != wantOrder[i] {
			t.Fatalf("entry %d: want %s got %s", i, wantOrder[i], e.Path)
		}
		if e.Kind != "file" {
			t.Fatalf("entry %s: want kind file got %s", e.Path, e.Kind)
		}
	}

	// No txt and no directory entries.
	for _, e := range manifest.Entries {
		if e.Path == "notes.txt" {
			t.Fatalf("txt entry should be filtered out")
		}
		if e.Size == 0 {
			t.Fatalf("entry %s has zero size", e.Path)
		}
	}
}

func TestGetZipEntry_Exists(t *testing.T) {
	data := buildTestZip(t)
	reader := bytes.NewReader(data)

	dataOut, ct, err := GetZipEntry(reader, int64(len(data)), "images/b.webp")
	if err != nil {
		t.Fatalf("GetZipEntry: %v", err)
	}
	if string(dataOut) != "webp-fake-bytes" {
		t.Fatalf("unexpected bytes: %q", string(dataOut))
	}
	if ct != "image/webp" {
		t.Fatalf("expected image/webp, got %s", ct)
	}
}

func TestGetZipEntry_NotFound(t *testing.T) {
	data := buildTestZip(t)
	reader := bytes.NewReader(data)

	_, _, err := GetZipEntry(reader, int64(len(data)), "missing.png")
	if !errors.Is(err, ErrEntryNotFound) {
		t.Fatalf("expected ErrEntryNotFound, got %v", err)
	}
}
