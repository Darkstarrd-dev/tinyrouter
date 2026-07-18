package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/tinyrouter/tinyrouter/internal/config"
)

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

// serveModelTest routes a POST /api/providers/{id}/models/test through chi so
// that chi.URLParam resolves the provider id as the real handler expects.
func serveModelTest(t *testing.T, rt *Router, providerID, model string) *httptest.ResponseRecorder {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"model": model})
	req := httptest.NewRequest(http.MethodPost, "/api/providers/"+providerID+"/models/test", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	r := chi.NewRouter()
	r.Post("/api/providers/{id}/models/test", rt.testProviderModel)
	r.ServeHTTP(rec, req)
	return rec
}

func doTestProviderModel(t *testing.T, rt *Router) map[string]any {
	t.Helper()
	rec := serveModelTest(t, rt, "p1", "m1")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response: %v (body=%s)", err, rec.Body.String())
	}
	return out
}

func doTestProviderModelStatus(t *testing.T, rt *Router, want int) {
	t.Helper()
	rec := serveModelTest(t, rt, "p1", "m1")
	if rec.Code != want {
		t.Fatalf("expected %d, got %d (body=%s)", want, rec.Code, rec.Body.String())
	}
}

// TestTestProviderModel_Compound_PersistsProtocolsOnChange probes a model whose
// stored Protocols is empty; with all three upstream endpoints returning 200 the
// derived set should be written to config.yaml (file created).
func TestTestProviderModel_Compound_PersistsProtocolsOnChange(t *testing.T) {
	srv := okServer(t)
	defer srv.Close()

	cfg := sampleConfig(srv.URL)
	rt, cfgPath := newTestRouter(t, cfg)

	out := doTestProviderModel(t, rt)

	if ok, _ := out["ok"].(bool); !ok {
		t.Fatalf("expected top-level ok=true, got %+v", out)
	}
	protos, _ := out["protocols"].([]any)
	if len(protos) != 3 {
		t.Fatalf("protocols = %+v, want 3 protocols", protos)
	}
	md, found := rt.reg.GetModelByAliasOrID("p1", "m1")
	if !found {
		t.Fatal("model m1 not found")
	}
	if len(md.Protocols) != 3 {
		t.Fatalf("Protocols = %+v, want 3", md.Protocols)
	}
	// config.yaml persisted (saveConfig invoked -> file exists with protocols).
	data, err := os.ReadFile(cfgPath)
	if err != nil {
		t.Fatalf("config not written: %v", err)
	}
	if !strings.Contains(string(data), "openai-compat") || !strings.Contains(string(data), "anthropic") {
		t.Fatalf("config missing protocols: %s", string(data))
	}
}

// TestTestProviderModel_Compound_NoChangeNoWrite probes a model that already
// supports the same protocol set the probe derives; config.yaml must NOT be
// rewritten to disk with a changed protocol set.
func TestTestProviderModel_Compound_NoChangeNoWrite(t *testing.T) {
	// Upstream: openai-compat (200) + anthropic (200), responses (404).
	// This yields {openai-compat, anthropic} — exactly the pre-set set.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/responses" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"message":"not found"}}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	cfg := sampleConfig(srv.URL)
	cfg.Providers[0].Models[0].Protocols = []string{config.ProtocolOpenAICompat, config.ProtocolAnthropic}
	rt, _ := newTestRouter(t, cfg)

	// Pre-write config so we can compare disk content before/after.
	if err := rt.saveConfig(cfg); err != nil {
		t.Fatalf("pre saveConfig: %v", err)
	}
	preBytes, err := os.ReadFile(rt.configPath)
	if err != nil {
		t.Fatalf("read pre config: %v", err)
	}

	doTestProviderModel(t, rt)

	md, _ := rt.reg.GetModelByAliasOrID("p1", "m1")
	if len(md.Protocols) != 2 {
		t.Fatalf("Protocols changed unexpectedly: %+v", md.Protocols)
	}
	postBytes, err := os.ReadFile(rt.configPath)
	if err != nil {
		t.Fatalf("read post config: %v", err)
	}
	// The no-change path must not alter the protocol set on disk.
	if strings.Count(string(postBytes), "anthropic") != strings.Count(string(preBytes), "anthropic") ||
		strings.Count(string(postBytes), "openai-compat") != strings.Count(string(preBytes), "openai-compat") {
		t.Fatalf("protocols changed on disk despite no logical change:\npre=%s\npost=%s", preBytes, postBytes)
	}
}

// TestTestProviderModel_BackwardCompatFields verifies the legacy top-level
// fields are still present alongside the new per-protocol sub-objects.
func TestTestProviderModel_BackwardCompatFields(t *testing.T) {
	srv := okServer(t)
	defer srv.Close()

	cfg := sampleConfig(srv.URL)
	rt, _ := newTestRouter(t, cfg)

	out := doTestProviderModel(t, rt)
	for _, f := range []string{"latencyMs", "status", "error", "request", "responseHeaders", "responseBody", "responseBodyRaw",
		"openaiCompat", "openaiResponses", "anthropic", "protocols", "ok"} {
		if _, ok := out[f]; !ok {
			t.Fatalf("response missing field %q; got %+v", f, out)
		}
	}
}

// TestTestProviderModel_EmptyModel verifies a 400 when the model field is empty
// (the original handler rejected blank model ids; an arbitrary non-empty model
// is still probed even if not in the provider's model list).
func TestTestProviderModel_EmptyModel(t *testing.T) {
	srv := okServer(t)
	defer srv.Close()
	cfg := sampleConfig(srv.URL)
	rt, _ := newTestRouter(t, cfg)

	body, _ := json.Marshal(map[string]string{"model": ""})
	req := httptest.NewRequest(http.MethodPost, "/api/providers/p1/models/test", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r := chi.NewRouter()
	r.Post("/api/providers/{id}/models/test", rt.testProviderModel)
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty model, got %d (body=%s)", rec.Code, rec.Body.String())
	}
}

// TestTestProviderModel_ProviderNotFound verifies a 404 for an unknown provider.
func TestTestProviderModel_ProviderNotFound(t *testing.T) {
	srv := okServer(t)
	defer srv.Close()
	cfg := sampleConfig(srv.URL)
	rt, _ := newTestRouter(t, cfg)

	rec := serveModelTest(t, rt, "ghost", "m1")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for missing provider, got %d (body=%s)", rec.Code, rec.Body.String())
	}
}

// TestTestProviderModel_NoActiveKey verifies a 400 when no active key exists.
func TestTestProviderModel_NoActiveKey(t *testing.T) {
	srv := okServer(t)
	defer srv.Close()
	cfg := sampleConfig(srv.URL)
	cfg.Providers[0].Keys[0].IsActive = false
	rt, _ := newTestRouter(t, cfg)

	doTestProviderModelStatus(t, rt, http.StatusBadRequest)
}
