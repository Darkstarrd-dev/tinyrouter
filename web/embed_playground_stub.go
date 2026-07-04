//go:build !playground

package web

import "embed"

// PlaygroundStatic is the playground-asset embed.FS, empty in this build mode.
// Callers must check PlaygroundCompiled() before reading from it.
var PlaygroundStatic embed.FS

// Silence the "imported and not used" compiler error for the embed package.
var _ embed.FS
