package config

import (
	"fmt"
	"os"
	"strings"
)

// validateProviders logs warnings for best-effort validation of provider config.
func validateProviders(cfg *Config) {
	prefixes := make(map[string]bool)
	validAPITypes := map[string]bool{"openai": true, "anthropic": true, "nim": true, "": true}
	for i, p := range cfg.Providers {
		if p.ID == "" {
			fmt.Fprintf(os.Stderr, "[config] warning: provider[%d] has empty id, skipping\n", i)
			continue
		}
		if p.Prefix == "" {
			fmt.Fprintf(os.Stderr, "[config] warning: provider %q has empty prefix, skipping\n", p.ID)
			continue
		}
		if prefixes[p.Prefix] {
			fmt.Fprintf(os.Stderr, "[config] warning: duplicate prefix %q for provider %q, skipping\n", p.Prefix, p.ID)
			continue
		}
		prefixes[p.Prefix] = true
		if p.BaseURL == "" || (!strings.HasPrefix(p.BaseURL, "http://") && !strings.HasPrefix(p.BaseURL, "https://")) {
			fmt.Fprintf(os.Stderr, "[config] warning: provider %q has invalid baseUrl %q\n", p.ID, p.BaseURL)
		}
		if !validAPITypes[p.APIType] {
			fmt.Fprintf(os.Stderr, "[config] warning: provider %q has unknown apiType %q\n", p.ID, p.APIType)
		}
	}
	for _, c := range cfg.Combos {
		for _, m := range c.Models {
			prefix, model := splitModel(m)
			if prefix == "" || model == "" {
				fmt.Fprintf(os.Stderr, "[config] warning: combo %q model %q does not use prefix/model format\n", c.Name, m)
			}
		}
	}
}

// splitModel parses "prefix/model" into (prefix, model).
func splitModel(s string) (string, string) {
	for i := 0; i < len(s); i++ {
		if s[i] == '/' {
			return s[:i], s[i+1:]
		}
	}
	return "", s
}
