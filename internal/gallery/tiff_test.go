package gallery

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"testing"

	"golang.org/x/image/tiff"
)

func TestConvertTIFFBlobToJPEG_RoundTrip(t *testing.T) {
	// Build a minimal valid TIFF using x/image/tiff.
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 255, G: 0, B: 0, A: 255})
	img.Set(1, 1, color.RGBA{R: 0, G: 255, B: 0, A: 255})

	var tiffBuf bytes.Buffer
	if err := tiff.Encode(&tiffBuf, img, nil); err != nil {
		t.Fatalf("tiff encode: %v", err)
	}

	out, err := ConvertTIFFBlobToJPEG(tiffBuf.Bytes(), 85)
	if err != nil {
		t.Fatalf("ConvertTIFFBlobToJPEG: %v", err)
	}
	if len(out) == 0 {
		t.Fatalf("expected non-empty JPEG bytes")
	}

	dec, err := jpeg.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("jpeg decode round-trip: %v", err)
	}
	if dec.Bounds().Dx() != 2 || dec.Bounds().Dy() != 2 {
		t.Fatalf("unexpected decoded bounds: %v", dec.Bounds())
	}
}

func TestConvertTIFFBlobToJPEG_InvalidBytes(t *testing.T) {
	_, err := ConvertTIFFBlobToJPEG([]byte("not a tiff"), 85)
	if err == nil {
		t.Fatalf("expected error for invalid TIFF bytes")
	}
}
