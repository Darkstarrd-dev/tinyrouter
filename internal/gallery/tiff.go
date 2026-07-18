package gallery

import (
	"bytes"
	"fmt"
	"image/jpeg"
	"io"

	"golang.org/x/image/tiff"
)

// maxTIFFDim is the maximum allowed pixel dimension (width or height) for a
// decoded TIFF image. 16384×16384 at 4 bytes/pixel = 1 GiB worst case, which
// is generous for any legitimate image while blocking decompression-bomb DoS.
const maxTIFFDim = 16384

// ConvertTIFFToJPEG decodes a TIFF image from r and re-encodes it as JPEG,
// returning the encoded bytes. quality must be in [1, 100]; values outside
// that range are clamped to 85. Decode failures are wrapped and returned.
func ConvertTIFFToJPEG(r io.Reader, quality int) ([]byte, error) {
	img, err := tiff.Decode(r)
	if err != nil {
		return nil, fmt.Errorf("decode tiff: %w", err)
	}
	// Guard against decompression-bomb DoS: a small compressed TIFF can decode
	// to a huge image.Image (width×height×4 bytes in memory). Reject images
	// whose dimensions exceed maxTIFFDim in either direction.
	b := img.Bounds()
	if dx, dy := b.Dx(), b.Dy(); dx > maxTIFFDim || dy > maxTIFFDim {
		return nil, fmt.Errorf("tiff image too large: %dx%d (max %dx%d)", dx, dy, maxTIFFDim, maxTIFFDim)
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
