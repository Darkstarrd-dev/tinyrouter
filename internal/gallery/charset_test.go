package gallery

import (
	"testing"

	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
)

func TestDecodeZipName_ShiftJIS(t *testing.T) {
	// "異世界" encoded as Shift-JIS, then stored as raw bytes (simulating
	// what Go zip.Reader does: f.Name = string(rawShiftJISBytes))
	sjis, err := japanese.ShiftJIS.NewEncoder().Bytes([]byte("異世界"))
	if err != nil {
		t.Fatal(err)
	}
	name := string(sjis) // raw Shift-JIS bytes in a Go string
	got := decodeZipName(name)
	if got != "異世界" {
		t.Fatalf("ShiftJIS: want %q, got %q", "異世界", got)
	}
}

func TestDecodeZipName_GBK(t *testing.T) {
	// "漫画" encoded as GBK
	gbk, err := simplifiedchinese.GBK.NewEncoder().Bytes([]byte("漫画"))
	if err != nil {
		t.Fatal(err)
	}
	name := string(gbk)
	got := decodeZipName(name)
	if got != "漫画" {
		t.Fatalf("GBK: want %q, got %q", "漫画", got)
	}
}

func TestDecodeZipName_AlreadyUTF8(t *testing.T) {
	// Genuine UTF-8 name — should pass through unchanged
	name := "images/異世界/01.webp"
	if got := decodeZipName(name); got != name {
		t.Fatalf("UTF-8 passthrough: want %q, got %q", name, got)
	}
}

func TestDecodeZipName_ASCII(t *testing.T) {
	name := "images/sub/01_0000.webp"
	if got := decodeZipName(name); got != name {
		t.Fatalf("ASCII: want %q, got %q", name, got)
	}
}

func TestDecodeZipName_Empty(t *testing.T) {
	if got := decodeZipName(""); got != "" {
		t.Fatalf("empty: want empty, got %q", got)
	}
}
