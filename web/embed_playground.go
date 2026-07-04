//go:build playground

package web

import "embed"

// Static embeds the core UI assets in builds WITH the `playground` build tag.
// Identical to the no-tag variant (web/embed.go) — the playground-specific
// assets (vendor JS/CSS, KaTeX fonts, playground.js, playground.css, pg-i18n.js)
// live in web/playground/static-pg and are exposed via web.PlaygroundStatic.
//
//go:embed all:static
var Static embed.FS

// PlaygroundStatic embeds the playground-specific static assets. Only available
// when the `playground` build tag is set. Callers MUST check PlaygroundCompiled()
// before referencing PlaygroundStatic.
//
//go:embed all:playground/static-pg
var PlaygroundStatic embed.FS

// PlaygroundCompiled reports whether the playground module was compiled into
// this binary. Always true in this file variant.
func PlaygroundCompiled() bool { return true }
