package gallery

import (
	"bytes"
	"fmt"
	"image/jpeg"
	"io"

	"golang.org/x/image/tiff"
)

// ConvertTIFFToJPEG decodes a TIFF image from r and re-encodes it as JPEG,
// returning the encoded bytes. quality must be in [1, 100]; values outside
// that range are clamped to 85. Decode failures are wrapped and returned.
func ConvertTIFFToJPEG(r io.Reader, quality int) ([]byte, error) {
	img, err := tiff.Decode(r)
	if err != nil {
		return nil, fmt.Errorf("decode tiff: %w", err)
	}
	if quality < 1 || quality > 100 {
		quality = 85
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality}); err != nil {
		return nil, fmt.Errorf("encode jpeg: %w", err)
	}
	return buf.Bytes(), nil
}

// ConvertTIFFBlobToJPEG is a convenience wrapper around ConvertTIFFToJPEG that
// accepts an in-memory TIFF byte slice, for direct use by HTTP handlers.
func ConvertTIFFBlobToJPEG(data []byte, quality int) ([]byte, error) {
	return ConvertTIFFToJPEG(bytes.NewReader(data), quality)
}
