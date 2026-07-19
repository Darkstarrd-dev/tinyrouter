package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
)

// sampleConfig returns a minimal config with one provider (p1/Prov1) that has
// one active key (k1/Key1/sk-test) and one model (m1, limited quota).
func sampleConfig(baseURL string) *config.Config {
	return &config.Config{
		Providers: []config.Provider{
			{
				ID:      "p1",
				Name:    "Prov1",
				BaseURL: baseURL,
				Keys: []config.Key{
					{ID: "k1", Name: "Key1", Key: "sk-test", IsActive: true},
				},
				Models: []config.ModelDef{
					{ID: "m1", QuotaType: "limited"},
				},
			},
		},
	}
}

// serveProtoTest routes a POST /api/providers/{id}/models/test-proto through
// chi so that chi.URLParam resolves the provider id as the real handler expects.
func serveProtoTest(t *testing.T, rt *Router, providerID, model, proto string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"model": model, "proto": proto})
	req := httptest.NewRequest(http.MethodPost, "/api/providers/"+providerID+"/models/test-proto", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	r := chi.NewRouter()
	r.Post("/api/providers/{id}/models/test-proto", rt.testProviderModelProto)
	r.ServeHTTP(rec, req)
	return rec
}

// ---------------------------------------------------------------------------
// Happy-path tests: each proto returns a single-probe result with the expected
// protocol field and a 200 status.
// ---------------------------------------------------------------------------

func TestTestProviderModelProto_OpenAICompat(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	cfg := sampleConfig(srv.URL)
	rt, _ := newTestRouter(t, cfg)

	rec := serveProtoTest(t, rt, "p1", "m1", config.ProtocolOpenAICompat)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}

	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v (body=%s)", err, rec.Body.String())
	}
	if proto, _ := out["protocol"].(string); proto != "openai-compat" {
		t.Fatalf("protocol = %q, want openai-compat", proto)
	}
	if ok, _ := out["ok"].(bool); !ok {
		t.Fatalf("expected ok=true, got %+v", out)
	}
	// Verify the full field set matches probeResultToMap shape.
	for _, f := range []string{"protocol", "ok", "status", "latencyMs", "error", "skipped", "request", "responseHeaders", "responseBody", "responseBodyRaw"} {
		if _, ok := out[f]; !ok {
			t.Fatalf("response missing field %q", f)
		}
	}
}

func TestTestProviderModelProto_OpenAIResponses(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"output":[]}`))
	}))
	defer srv.Close()

	cfg := sampleConfig(srv.URL)
	rt, _ := newTestRouter(t, cfg)

	rec := serveProtoTest(t, rt, "p1", "m1", config.ProtocolOpenAIResponses)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}

	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v (body=%s)", err, rec.Body.String())
	}
	if proto, _ := out["protocol"].(string); proto != "openai-responses" {
		t.Fatalf("protocol = %q, want openai-responses", proto)
	}
}

func TestTestProviderModelProto_Anthropic(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"content":[]}`))
	}))
	defer srv.Close()

	cfg := sampleConfig(srv.URL)
	rt, _ := newTestRouter(t, cfg)

	rec := serveProtoTest(t, rt, "p1", "m1", config.ProtocolAnthropic)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}

	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v (body=%s)", err, rec.Body.String())
	}
	if proto, _ := out["protocol"].(string); proto != "anthropic" {
		t.Fatalf("protocol = %q, want anthropic", proto)
	}
}

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

func TestTestProviderModelProto_InvalidProto(t *testing.T) {
	srv := okServer(t)
	defer srv.Close()
	cfg := sampleConfig(srv.URL)
	rt, _ := newTestRouter(t, cfg)

	rec := serveProtoTest(t, rt, "p1", "m1", "bogus")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid proto, got %d (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestTestProviderModelProto_EmptyModel(t *testing.T) {
	srv := okServer(t)
	defer srv.Close()
	cfg := sampleConfig(srv.URL)
	rt, _ := newTestRouter(t, cfg)

	body, _ := json.Marshal(map[string]string{"model": "", "proto": config.ProtocolOpenAICompat})
	req := httptest.NewRequest(http.MethodPost, "/api/providers/p1/models/test-proto", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r := chi.NewRouter()
	r.Post("/api/providers/{id}/models/test-proto", rt.testProviderModelProto)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty model, got %d (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestTestProviderModelProto_ProviderNotFound(t *testing.T) {
	srv := okServer(t)
	defer srv.Close()
	cfg := sampleConfig(srv.URL)
	rt, _ := newTestRouter(t, cfg)

	rec := serveProtoTest(t, rt, "ghost", "m1", config.ProtocolOpenAICompat)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing provider, got %d (body=%s)", rec.Code, rec.Body.String())
	}
}

func TestTestProviderModelProto_NoActiveKey(t *testing.T) {
	srv := okServer(t)
	defer srv.Close()
	cfg := sampleConfig(srv.URL)
	cfg.Providers[0].Keys[0].IsActive = false
	rt, _ := newTestRouter(t, cfg)

	rec := serveProtoTest(t, rt, "p1", "m1", config.ProtocolOpenAICompat)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for no active key, got %d (body=%s)", rec.Code, rec.Body.String())
	}
}

// ---------------------------------------------------------------------------
// URL normalization correctness
// ---------------------------------------------------------------------------

func TestNormalizeProbeBaseURL(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		// Already clean
		{"https://example.com", "https://example.com"},
		{"https://example.com/", "https://example.com"},
		{"https://example.com/v1", "https://example.com/v1"},
		// Strip /v1/chat/completions
		{"https://example.com/v1/chat/completions", "https://example.com"},
		// Strip /chat/completions
		{"https://example.com/chat/completions", "https://example.com"},
		// Strip /completions
		{"https://example.com/completions", "https://example.com"},
		// Strip /v1/responses
		{"https://example.com/v1/responses", "https://example.com"},
		// Strip /responses
		{"https://example.com/responses", "https://example.com"},
		// Strip /v1/messages
		{"https://example.com/v1/messages", "https://example.com"},
		// Strip /messages
		{"https://example.com/messages", "https://example.com"},
		// Strip /v1/models
		{"https://example.com/v1/models", "https://example.com"},
		// Strip /models
		{"https://example.com/models", "https://example.com"},
		// Strip /v1/images/generations
		{"https://example.com/v1/images/generations", "https://example.com"},
		// Strip /images/generations
		{"https://example.com/images/generations", "https://example.com"},
		// Strip trailing slash before suffix
		{"https://example.com/v1/chat/completions/", "https://example.com"},
		// With space
		{"  https://example.com/v1/chat/completions  ", "https://example.com"},
		// Only one suffix stripped (first match)
		{"https://example.com/v1/chat/completions/v1/messages", "https://example.com/v1/chat/completions"},
		// No suffix match
		{"https://example.com/custom/path", "https://example.com/custom/path"},
		// Raw mode not affected (normalize is called before raw check in builders)
		{"https://example.com/v1/chat/completions*", "https://example.com/v1/chat/completions*"},
	}
	for _, tt := range tests {
		got := normalizeProbeBaseURL(tt.input)
		if got != tt.expected {
			t.Errorf("normalizeProbeBaseURL(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestBuildProbeURL_Normalization(t *testing.T) {
	tests := []struct {
		baseURL      string
		endpointPath string
		expected     string
	}{
		// BaseURL already a clean root
		{"https://example.com", "/v1/chat/completions", "https://example.com/v1/chat/completions"},
		{"https://example.com", "/v1/responses", "https://example.com/v1/responses"},
		{"https://example.com", "/v1/messages", "https://example.com/v1/messages"},
		// BaseURL ends with a known suffix — normalize strips it
		{"https://example.com/v1/chat/completions", "/v1/chat/completions", "https://example.com/v1/chat/completions"},
		{"https://example.com/v1/chat/completions", "/v1/responses", "https://example.com/v1/responses"},
		{"https://example.com/v1/chat/completions", "/v1/messages", "https://example.com/v1/messages"},
		{"https://example.com/v1/responses", "/v1/chat/completions", "https://example.com/v1/chat/completions"},
		{"https://example.com/v1/models", "/v1/chat/completions", "https://example.com/v1/chat/completions"},
		{"https://example.com/v1/images/generations", "/v1/chat/completions", "https://example.com/v1/chat/completions"},
		// Raw mode
		{"https://example.com/custom*", "/v1/chat/completions", "https://example.com/custom"},
		// With trailing slash
		{"https://example.com/v1/chat/completions/", "/v1/responses", "https://example.com/v1/responses"},
		// With space
		{"  https://example.com/v1/chat/completions  ", "/v1/responses", "https://example.com/v1/responses"},
	}
	for _, tt := range tests {
		got := buildProbeURL(tt.baseURL, tt.endpointPath)
		if got != tt.expected {
			t.Errorf("buildProbeURL(%q, %q) = %q, want %q", tt.baseURL, tt.endpointPath, got, tt.expected)
		}
	}
}

func TestBuildAnthropicURL_Normalization(t *testing.T) {
	tests := []struct {
		baseURL      string
		endpointPath string
		expected     string
	}{
		// Clean root
		{"https://example.com", "/v1/messages", "https://example.com/v1/messages"},
		// BaseURL ends with /v1/chat/completions — normalize strips it
		{"https://example.com/v1/chat/completions", "/v1/messages", "https://example.com/v1/messages"},
		{"https://example.com/v1/chat/completions", "/v1/chat/completions", "https://example.com/v1/chat/completions"},
		// BaseURL ends with another suffix
		{"https://example.com/v1/responses", "/v1/messages", "https://example.com/v1/messages"},
		{"https://example.com/v1/models", "/v1/messages", "https://example.com/v1/messages"},
		// Raw mode
		{"https://example.com/custom*", "/v1/messages", "https://example.com/custom"},
		// With trailing slash
		{"https://example.com/v1/chat/completions/", "/v1/messages", "https://example.com/v1/messages"},
		// With space
		{"  https://example.com/v1/chat/completions  ", "/v1/messages", "https://example.com/v1/messages"},
	}
	for _, tt := range tests {
		got := buildAnthropicURL(tt.baseURL, tt.endpointPath)
		if got != tt.expected {
			t.Errorf("buildAnthropicURL(%q, %q) = %q, want %q", tt.baseURL, tt.endpointPath, got, tt.expected)
		}
	}
}