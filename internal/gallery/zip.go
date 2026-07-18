package gallery

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"
)

// ErrEntryNotFound is returned by GetZipEntry when no entry with the requested
// name exists in the archive.
var ErrEntryNotFound = errors.New("entry not found")

// IsNotFound reports whether err is (or wraps) ErrEntryNotFound.
func IsNotFound(err error) bool {
	return errors.Is(err, ErrEntryNotFound)
}

// ListZipEntries opens the zip archive described by reader/size and returns a
// manifest of the supported image entries it contains. Directory entries and
// files whose extension is not in SupportedExts are skipped. Returned entries
// are sorted by name in ascending order; Total equals the image entry count.
func ListZipEntries(reader io.ReaderAt, size int64) (manifest Manifest, err error) {
	z, err := zip.NewReader(reader, size)
	if err != nil {
		return Manifest{}, fmt.Errorf("open zip: %w", err)
	}

	var entries []Entry
	for _, f := range z.File {
		if f.FileInfo().IsDir() {
			continue
		}
		if !IsSupportedExt(f.Name) {
			continue
		}
		entries = append(entries, Entry{
			Path: f.Name,
			Size: int64(f.UncompressedSize64),
			Kind: "file",
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Path < entries[j].Path
	})

	return Manifest{
		Entries: entries,
		Total:   len(entries),
	}, nil
}

// GetZipEntry finds the named entry inside the zip archive and returns its raw
// bytes plus a content-type derived from the extension. The name must match
// exactly (no fuzzy matching). Reads are bounded by a 100 MiB limit. When the
// entry does not exist, ErrEntryNotFound is returned.
func GetZipEntry(reader io.ReaderAt, size int64, name string) (data []byte, contentType string, err error) {
	z, err := zip.NewReader(reader, size)
	if err != nil {
		return nil, "", fmt.Errorf("open zip: %w", err)
	}

	var target *zip.File
	for _, f := range z.File {
		if f.Name == name {
			target = f
			break
		}
	}
	if target == nil {
		return nil, "", fmt.Errorf("%w: %s", ErrEntryNotFound, name)
	}

	rc, err := target.Open()
	if err != nil {
		return nil, "", fmt.Errorf("open entry: %w", err)
	}
	defer rc.Close()

	limited := io.LimitReader(rc, 100<<20)
	data, err = io.ReadAll(limited)
	if err != nil {
		return nil, "", fmt.Errorf("read entry: %w", err)
	}

	return data, contentTypeForExt(target.Name), nil
}

// contentTypeForExt returns the HTTP content-type for a file based on its
// extension. Unsupported extensions fall back to "application/octet-stream".
func contentTypeForExt(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".webp":
		return "image/webp"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".bmp":
		return "image/bmp"
	case ".tiff", ".tif":
		return "image/tiff"
	default:
		return "application/octet-stream"
	}
}
