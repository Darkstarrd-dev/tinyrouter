package fsutil

import "errors"

// ErrUnsupportedPlatform is returned when a file picker or directory picker
// is requested on a platform that does not support native dialogs (e.g. Linux
// without a desktop environment).
var ErrUnsupportedPlatform = errors.New("fsutil: unsupported platform")
