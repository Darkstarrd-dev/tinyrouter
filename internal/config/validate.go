package config

import (
	"fmt"
	"os"
	"strings"
)

// validProtocols is the set of legal ModelDef.Protocols values.
var validProtocols = map[string]bool{
	ProtocolOpenAICompat:    true,
	ProtocolOpenAIResponses: true,
	ProtocolAnthropic:       true,
}

// validateModelDef logs warnings for best-effort validation of a single model.
// It checks that any Protocols values are within the known legal set. Unknown
// values are reported but do not block startup (warning only).
func validateModelDef(p *Provider, m *ModelDef) {
	for _, proto := range m.Protocols {
		if !validProtocols[proto] {
			fmt.Fprintf(os.Stderr, "[config] warning: provider %q model %q has unknown protocol %q (legal: openai-compat, openai-responses, anthropic)\n", p.ID, m.ID, proto)
		}
	}
}

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
		if p.APIType == "anthropic" && !strings.HasSuffix(p.BaseURL, "/v1/messages") && !strings.HasSuffix(p.BaseURL, "*") {
			fmt.Fprintf(os.Stderr, "[config] warning: anthropic provider %q BaseURL should typically end with /v1/messages or use raw mode (*) suffix\n", p.ID)
		}
		for j := range p.Models {
			validateModelDef(&p, &p.Models[j])
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
