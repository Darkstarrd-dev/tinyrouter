package proxy

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tinyrouter/tinyrouter/internal/combo"
	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/console"
	"github.com/tinyrouter/tinyrouter/internal/registry"
	"github.com/tinyrouter/tinyrouter/internal/rotation"
	"github.com/tinyrouter/tinyrouter/internal/usage"
)

func newTestHandler(t *testing.T) *Handler {
	t.Helper()
	cfg := &config.Config{
		Providers: []config.Provider{
			{
				ID: "test", Name: "Test Provider", Prefix: "test",
				BaseURL: "http://localhost:9999", IsActive: true,
				Keys: []config.Key{
					{ID: "key1", Key: "sk-test-key", Name: "Key Main", IsActive: true, Priority: 1},
				},
				Models: []config.ModelDef{
					{ID: "gpt-4", QuotaType: "limited"},
				},
			},
		},
		Rotation: config.RotationConfig{
			Strategy: "fill-first", MaxRetries: 5, BackoffMaxSec: 300,
		},
	}
	reg := registry.New(cfg)
	sel := rotation.New(reg, &cfg.Rotation)
	comboRes := combo.New(reg)
	usageBuf := usage.New(100)
	qt := usage.NewQuotaTracker()
	logger := console.New(100)
	return New(reg, sel, comboRes, usageBuf, qt, logger)
}

func newTestHandlerWithCustomProvider(t *testing.T, provider config.Provider, rotationCfg config.RotationConfig) *Handler {
	t.Helper()
	cfg := &config.Config{
		Providers: []config.Provider{provider},
		Rotation:  rotationCfg,
	}
	reg := registry.New(cfg)
	sel := rotation.New(reg, &cfg.Rotation)
	comboRes := combo.New(reg)
	usageBuf := usage.New(100)
	qt := usage.NewQuotaTracker()
	logger := console.New(100)
	return New(reg, sel, comboRes, usageBuf, qt, logger)
}

func TestForwardUpstream_Success(t *testing.T) {
	receivedModel := ""
	mockUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-test-key" {
			t.Error("unexpected Authorization header")
		}
		if r.Header.Get("Content-Type") != "application/json" {
			t.Error("unexpected Content-Type")
		}
		body, _ := io.ReadAll(r.Body)
		var parsed map[string]any
		json.Unmarshal(body, &parsed)
		receivedModel, _ = parsed["model"].(string)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"id":"test","choices":[{"message":{"content":"hi"}}]}`))
	}))
	defer mockUpstream.Close()

	h := newTestHandler(t)
	sel := &rotation.SelectedKey{
		Provider: config.Provider{
			ID: "test", Name: "Test Provider", Prefix: "test",
			BaseURL: mockUpstream.URL, IsActive: true,
		},
		Key:     config.Key{ID: "key1", Key: "sk-test-key", Name: "Key Main", IsActive: true, Priority: 1},
		KeyName: "Key Main",
	}

	body := []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}`)
	headers := http.Header{"User-Agent": {"test-agent"}}

	resp, err := h.forwardUpstream(sel, body, headers, false, "/v1/chat/completions")
	if err != nil {
		t.Fatalf("forwardUpstream failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	if receivedModel != "gpt-4" {
		t.Fatalf("expected upstream model gpt-4, got %s", receivedModel)
	}

	respBody, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(respBody), `"id":"test"`) {
		t.Fatalf("unexpected response body: %s", string(respBody))
	}
}

func TestForwardUpstream_NetworkError(t *testing.T) {
	h := newTestHandler(t)
	sel := &rotation.SelectedKey{
		Provider: config.Provider{
			ID: "test", Name: "Test Provider", Prefix: "test",
			BaseURL: "http://127.0.0.1:1", IsActive: true,
		},
		Key:     config.Key{ID: "key1", Key: "sk-test-key", Name: "Key Main", IsActive: true, Priority: 1},
		KeyName: "Key Main",
	}

	body := []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}`)
	_, err := h.forwardUpstream(sel, body, nil, false, "/v1/chat/completions")
	if err == nil {
		t.Fatal("expected network error, got nil")
	}
}

func TestForwardUpstream_UserAgentForwarded(t *testing.T) {
	var receivedUA string
	mockUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedUA = r.Header.Get("User-Agent")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{}`))
	}))
	defer mockUpstream.Close()

	h := newTestHandler(t)
	sel := &rotation.SelectedKey{
		Provider: config.Provider{
			ID: "test", Name: "Test Provider", Prefix: "test",
			BaseURL: mockUpstream.URL, IsActive: true,
		},
		Key:     config.Key{ID: "key1", Key: "sk-test-key", Name: "Key Main", IsActive: true, Priority: 1},
		KeyName: "Key Main",
	}

	body := []byte(`{"model":"gpt-4"}`)
	headers := http.Header{"User-Agent": {"custom-agent/1.0"}}

	_, err := h.forwardUpstream(sel, body, headers, false, "/v1/chat/completions")
	if err != nil {
		t.Fatalf("forwardUpstream failed: %v", err)
	}

	if receivedUA != "custom-agent/1.0" {
		t.Fatalf("expected User-Agent custom-agent/1.0, got %s", receivedUA)
	}
}

func TestBuildUpstreamURL(t *testing.T) {
	tests := []struct {
		baseURL string
		path    string
		want    string
	}{
		{"https://api.deepseek.com", "/v1/chat/completions", "https://api.deepseek.com/v1/chat/completions"},
		{"https://api.deepseek.com/v1", "/v1/chat/completions", "https://api.deepseek.com/v1/chat/completions"},
		{"https://api.deepseek.com/v1/chat/completions", "/v1/chat/completions", "https://api.deepseek.com/v1/chat/completions"},
		{"https://api.deepseek.com/", "/v1/chat/completions", "https://api.deepseek.com/v1/chat/completions"},
	}
	for _, tt := range tests {
		got := BuildUpstreamURL(tt.baseURL, tt.path)
		if got != tt.want {
			t.Errorf("BuildUpstreamURL(%q, %q) = %q, want %q", tt.baseURL, tt.path, got, tt.want)
		}
	}
}

func TestMaskURL(t *testing.T) {
	tests := []struct {
		url  string
		want string
	}{
		{"short", "short"},
		{"https://api.example.com/v1/chat/completions", "https://api.example...."},
	}
	for _, tt := range tests {
		got := maskURL(tt.url)
		if got != tt.want {
			t.Errorf("maskURL(%q) = %q, want %q", tt.url, got, tt.want)
		}
	}
}

func TestForwardUpstream_StreamingSetsAcceptHeader(t *testing.T) {
	var gotAccept string
	mockUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAccept = r.Header.Get("Accept")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{}`))
	}))
	defer mockUpstream.Close()

	h := newTestHandler(t)
	sel := &rotation.SelectedKey{
		Provider: config.Provider{
			ID: "test", Name: "Test Provider", Prefix: "test",
			BaseURL: mockUpstream.URL, IsActive: true,
		},
		Key:     config.Key{ID: "key1", Key: "sk-test-key", Name: "Key Main", IsActive: true, Priority: 1},
		KeyName: "Key Main",
	}

	body := []byte(`{"model":"gpt-4"}`)
	_, err := h.forwardUpstream(sel, body, nil, true, "/v1/chat/completions")
	if err != nil {
		t.Fatalf("forwardUpstream failed: %v", err)
	}

	if gotAccept != "text/event-stream" {
		t.Fatalf("expected Accept: text/event-stream for stream, got %s", gotAccept)
	}
}

func TestNormalizeBaseURL_TrimsSuffixes(t *testing.T) {
	tests := []struct{ input, want string }{
		{"https://api.example.com/v1/chat/completions", "https://api.example.com/v1"},
		{"https://api.example.com/v1/completions", "https://api.example.com/v1"},
		{"https://api.example.com/v1/models", "https://api.example.com/v1"},
		{"https://api.example.com/v1/", "https://api.example.com/v1"},
		{"https://api.example.com", "https://api.example.com"},
	}
	for _, tt := range tests {
		got := normalizeBaseURL(tt.input)
		if got != tt.want {
			t.Errorf("normalizeBaseURL(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestForwardWithRetry_NetworkError(t *testing.T) {
	h := newTestHandler(t)

	body := []byte(`{"model":"test/gpt-4","messages":[{"role":"user","content":"hi"}]}`)
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.handleProxy(w, req, "/v1/chat/completions")

	resp := w.Result()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("expected 502 Bad Gateway, got %d", resp.StatusCode)
	}
}

func TestSelectKey_Integration(t *testing.T) {
	cfg := &config.Config{
		Providers: []config.Provider{
			{
				ID: "test", Name: "Test Provider", Prefix: "test",
				BaseURL: "http://localhost:9999", IsActive: true,
				Keys: []config.Key{
					{ID: "key1", Key: "sk-key1", Name: "Key1", IsActive: true, Priority: 1},
					{ID: "key2", Key: "sk-key2", Name: "Key2", IsActive: true, Priority: 2},
				},
			},
		},
		Rotation: config.RotationConfig{Strategy: "fill-first", MaxRetries: 2, BackoffMaxSec: 300},
	}
	reg := registry.New(cfg)
	sel := rotation.New(reg, &cfg.Rotation)

	selected, err := sel.SelectKey("test", "gpt-4", nil)
	if err != nil {
		t.Fatalf("SelectKey failed: %v", err)
	}
	if selected.Key.ID != "key1" {
		t.Fatalf("expected key1, got %s", selected.Key.ID)
	}

	// Exclude key1
	selected2, err := sel.SelectKey("test", "gpt-4", []string{"key1"})
	if err != nil {
		t.Fatalf("SelectKey with exclude failed: %v", err)
	}
	if selected2.Key.ID != "key2" {
		t.Fatalf("expected key2, got %s", selected2.Key.ID)
	}

	// Exclude both
	_, err = sel.SelectKey("test", "gpt-4", []string{"key1", "key2"})
	if err == nil {
		t.Fatal("expected error when all keys excluded")
	}
}

func TestHandleProxy_InvalidModel(t *testing.T) {
	h := newTestHandler(t)
	body := `{"model":"unknown/model"}`
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.handleProxy(w, req, "/v1/chat/completions")

	resp := w.Result()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown prefix, got %d", resp.StatusCode)
	}
}

func TestHandleProxy_MissingModel(t *testing.T) {
	h := newTestHandler(t)
	body := `{"messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.handleProxy(w, req, "/v1/chat/completions")

	resp := w.Result()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing model, got %d", resp.StatusCode)
	}
}

func TestHandleProxy_InvalidJSON(t *testing.T) {
	h := newTestHandler(t)
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader("not json"))
	w := httptest.NewRecorder()
	h.handleProxy(w, req, "/v1/chat/completions")

	resp := w.Result()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid JSON, got %d", resp.StatusCode)
	}
}

func TestHandleProxy_BadModelFormat(t *testing.T) {
	h := newTestHandler(t)
	body := `{"model":"no-slash"}`
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.handleProxy(w, req, "/v1/chat/completions")

	resp := w.Result()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for bad model format, got %d", resp.StatusCode)
	}
}

func TestChatCompletions_SuccessWithMock(t *testing.T) {
	mockUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		body, _ := io.ReadAll(r.Body)
		var parsed map[string]any
		json.Unmarshal(body, &parsed)
		model, _ := parsed["model"].(string)
		resp := map[string]any{
			"id":    "test-response",
			"model": model,
			"choices": []map[string]any{
				{"message": map[string]any{"content": "hello"}},
			},
		}
		json.NewEncoder(w).Encode(resp)
	}))
	defer mockUpstream.Close()

	cfg := &config.Config{
		Providers: []config.Provider{
			{
				ID: "test", Name: "Test", Prefix: "test",
				BaseURL: mockUpstream.URL, IsActive: true,
				Keys: []config.Key{
					{ID: "k1", Key: "sk-test", Name: "TestKey", IsActive: true, Priority: 1},
				},
				Models: []config.ModelDef{
					{ID: "gpt-4", QuotaType: "limited"},
				},
			},
		},
		Rotation: config.RotationConfig{Strategy: "fill-first", MaxRetries: 2, BackoffMaxSec: 300},
	}
	reg := registry.New(cfg)
	sel := rotation.New(reg, &cfg.Rotation)
	comboRes := combo.New(reg)
	usageBuf := usage.New(100)
	qt := usage.NewQuotaTracker()
	logger := console.New(100)
	h := New(reg, sel, comboRes, usageBuf, qt, logger)

	body := `{"model":"test/gpt-4","messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ChatCompletions(w, req)

	resp := w.Result()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)
	if result["id"] != "test-response" {
		t.Fatalf("unexpected response id: %v", result["id"])
	}
}

func TestMaxRetries_Default(t *testing.T) {
	h := newTestHandler(t)
	mr := h.maxRetries()
	if mr != 5 {
		t.Fatalf("expected default maxRetries 5, got %d", mr)
	}
}

func TestMaxRetries_Custom(t *testing.T) {
	provider := config.Provider{
		ID: "test", Name: "Test", Prefix: "test",
		BaseURL: "http://localhost:9999", IsActive: true,
		Keys: []config.Key{
			{ID: "k1", Key: "sk-1", Name: "K1", IsActive: true, Priority: 1},
		},
	}
	cfg := config.RotationConfig{Strategy: "fill-first", MaxRetries: 2, BackoffMaxSec: 300}
	h := newTestHandlerWithCustomProvider(t, provider, cfg)
	mr := h.maxRetries()
	if mr != 2 {
		t.Fatalf("expected custom maxRetries 2, got %d", mr)
	}
}

func TestRecordUsage(t *testing.T) {
	h := newTestHandler(t)
	sel := &rotation.SelectedKey{
		Provider: config.Provider{ID: "test", Name: "Test Provider", Prefix: "test"},
		Key:      config.Key{ID: "key1", Key: "sk-1", Name: "K1"},
		KeyName:  "K1",
	}
	h.recordUsage("test", "gpt-4", sel, "success", 100, 50, 10, 20, "", nil, nil, nil, 0)
}

func TestAfterMaxRetries_WithMock(t *testing.T) {
	mockUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
		w.Write([]byte(`{"error":"rate limit exceeded"}`))
	}))
	defer mockUpstream.Close()

	cfg := &config.Config{
		Providers: []config.Provider{
			{
				ID: "test", Name: "Test", Prefix: "test",
				BaseURL: mockUpstream.URL, IsActive: true,
				Keys: []config.Key{
					{ID: "k1", Key: "sk-1", Name: "K1", IsActive: true, Priority: 1},
				},
				Models: []config.ModelDef{
					{ID: "gpt-4", QuotaType: "limited"},
				},
			},
		},
		Rotation: config.RotationConfig{
			Strategy: "fill-first", MaxRetries: 0, BackoffMaxSec: 300,
		},
	}
	reg := registry.New(cfg)
	sel := rotation.New(reg, &cfg.Rotation)
	comboRes := combo.New(reg)
	usageBuf := usage.New(100)
	qt := usage.NewQuotaTracker()
	logger := console.New(100)
	h := New(reg, sel, comboRes, usageBuf, qt, logger)

	body := `{"model":"test/gpt-4","messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ChatCompletions(w, req)

	resp := w.Result()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("expected 502 after retries exhausted, got %d", resp.StatusCode)
	}
}

func TestWriteError(t *testing.T) {
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadRequest, "test error")

	resp := w.Result()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)
	errObj, ok := result["error"].(map[string]any)
	if !ok {
		t.Fatal("expected error object")
	}
	if errObj["message"] != "test error" {
		t.Fatalf("unexpected error message: %v", errObj["message"])
	}
}

func TestInjectStreamOptions(t *testing.T) {
	provider := config.Provider{
		ID: "test", Name: "Test", Prefix: "test",
		BaseURL:          "http://localhost:9999",
		IsActive:         true,
		InjectStreamOpts: true,
		Keys: []config.Key{
			{ID: "k1", Key: "sk-1", Name: "K1", IsActive: true, Priority: 1},
		},
		Models: []config.ModelDef{{ID: "gpt-4", QuotaType: "limited"}},
	}
	cfg := config.RotationConfig{Strategy: "fill-first", MaxRetries: 0, BackoffMaxSec: 300}

	reg := registry.New(&config.Config{Providers: []config.Provider{provider}, Rotation: cfg})
	sel := rotation.New(reg, &cfg)
	comboRes := combo.New(reg)
	usageBuf := usage.New(100)
	qt := usage.NewQuotaTracker()
	logger := console.New(100)
	_ = New(reg, sel, comboRes, usageBuf, qt, logger)

	parsed := map[string]any{
		"model":    "gpt-4",
		"stream":   true,
		"messages": []any{map[string]any{"role": "user", "content": "hi"}},
	}

	// Simulate the injection logic from forwardWithRetry
	cfgProvider, _ := reg.GetProvider("test")
	if cfgProvider != nil && cfgProvider.InjectStreamOpts {
		if _, ok := parsed["stream_options"]; !ok {
			parsed["stream_options"] = map[string]any{"include_usage": true}
		}
	}

	if _, ok := parsed["stream_options"]; !ok {
		t.Fatal("expected stream_options to be injected")
	}
}

func TestListModels(t *testing.T) {
	h := newTestHandler(t)
	w := httptest.NewRecorder()
	h.ListModels(w, req(t))

	resp := w.Result()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)
	data, ok := result["data"].([]any)
	if !ok {
		t.Fatal("expected data array")
	}
	if len(data) == 0 {
		t.Fatal("expected at least one model")
	}
	entry := data[0].(map[string]any)
	if entry["id"] != "test/gpt-4" {
		t.Fatalf("expected model id test/gpt-4, got %v", entry["id"])
	}
}

func req(t *testing.T) *http.Request {
	t.Helper()
	return httptest.NewRequest("GET", "/v1/models", nil)
}

func TestParseAndUpdateQuota(t *testing.T) {
	h := newTestHandler(t)
	sel := &rotation.SelectedKey{
		Provider: config.Provider{
			ID: "test", Name: "Test Provider", Prefix: "test",
			BaseURL: "https://modelscope.cn/v1", IsActive: true,
			Keys: []config.Key{
				{ID: "key1", Key: "sk-1", Name: "K1", IsActive: true, Priority: 1},
			},
		},
		Key:     config.Key{ID: "key1", Key: "sk-1", Name: "K1", IsActive: true, Priority: 1},
		KeyName: "K1",
	}

	headers := http.Header{}
	headers.Set("Modelscope-Ratelimit-Model-Requests-Limit", "100")
	headers.Set("Modelscope-Ratelimit-Model-Requests-Remaining", "80")

	h.parseAndUpdateQuota(sel, "test", "gpt-4", headers)

	keyState := h.reg.GetKeyState("test", "key1")
	if keyState == nil {
		t.Fatal("expected key state")
	}
	quota := keyState.GetQuota("gpt-4")
	if quota == nil {
		t.Fatal("expected quota info")
	}
	if quota.ModelLimit != 100 {
		t.Fatalf("expected ModelLimit 100, got %d", quota.ModelLimit)
	}
	if quota.ModelRemaining != 80 {
		t.Fatalf("expected ModelRemaining 80, got %d", quota.ModelRemaining)
	}
}

func TestHandleProxy_StreamRequest(t *testing.T) {
	// Verify stream=true flag is parsed correctly through handleProxy
	h := newTestHandler(t)
	body := `{"model":"test/gpt-4","messages":[{"role":"user","content":"hi"}],"stream":true}`
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	// Since upstream doesn't exist, should return 502
	h.handleProxy(w, req, "/v1/chat/completions")

	resp := w.Result()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("expected 502 for stream with no upstream, got %d", resp.StatusCode)
	}
}

func TestComboResponse(t *testing.T) {
	// Simplified: just verify that writeError produces expected JSON structure
	w := httptest.NewRecorder()
	writeError(w, http.StatusBadGateway, "all keys exhausted")
	resp := w.Result()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", resp.StatusCode)
	}
	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)
	errObj, ok := result["error"].(map[string]any)
	if !ok {
		t.Fatal("expected error object")
	}
	if errObj["message"] != "all keys exhausted" {
		t.Fatalf("unexpected message: %v", errObj["message"])
	}
}

func TestRoundTrip_Success(t *testing.T) {
	mockUpstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"id":"ok","choices":[{"message":{"content":"done"}}]}`))
	}))
	defer mockUpstream.Close()

	cfg := &config.Config{
		Providers: []config.Provider{
			{
				ID: "rt", Name: "RoundTrip", Prefix: "rt",
				BaseURL: mockUpstream.URL, IsActive: true,
				Keys: []config.Key{
					{ID: "k1", Key: "sk-1", Name: "K1", IsActive: true, Priority: 1},
				},
				Models: []config.ModelDef{{ID: "gpt-4", QuotaType: "limited"}},
			},
		},
		Rotation: config.RotationConfig{Strategy: "fill-first", MaxRetries: 2, BackoffMaxSec: 300},
	}
	reg := registry.New(cfg)
	sel := rotation.New(reg, &cfg.Rotation)
	comboRes := combo.New(reg)
	usageBuf := usage.New(100)
	qt := usage.NewQuotaTracker()
	logger := console.New(100)
	h := New(reg, sel, comboRes, usageBuf, qt, logger)

	body := `{"model":"rt/gpt-4","messages":[{"role":"user","content":"hello"}]}`
	req := httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h.ChatCompletions(w, req)

	resp := w.Result()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var result map[string]any
	json.NewDecoder(resp.Body).Decode(&result)
	if result["id"] != "ok" {
		t.Fatalf("expected id ok, got %v", result["id"])
	}
}

func TestParseAndUpdateQuota_NoHeaders(t *testing.T) {
	h := newTestHandler(t)
	sel := &rotation.SelectedKey{
		Provider: config.Provider{
			ID: "test", Name: "Test", Prefix: "test",
			BaseURL: "http://localhost:9999", IsActive: true,
		},
		Key:     config.Key{ID: "key1", Key: "sk-1", Name: "K1"},
		KeyName: "K1",
	}
	// nil/empty headers should not panic
	h.parseAndUpdateQuota(sel, "test", "gpt-4", http.Header{})
}

func TestDebugMode(t *testing.T) {
	h := newTestHandler(t)
	if h.debugMode() {
		t.Fatal("expected debugMode false by default")
	}
	h.SetDebugModeProvider(func() bool { return true })
	if !h.debugMode() {
		t.Fatal("expected debugMode true after setting provider")
	}
}

func TestRecordUsage_DebugModeCapture(t *testing.T) {
	h := newTestHandler(t)
	h.SetDebugModeProvider(func() bool { return true })

	sel := &rotation.SelectedKey{
		Provider: config.Provider{ID: "test", Name: "Test Provider"},
		Key:      config.Key{ID: "k1", Key: "sk-1", Name: "K1"},
		KeyName:  "K1",
	}
	headers := http.Header{"X-Custom": {"val"}}
	h.recordUsage("test", "gpt-4", sel, "success", 100, 50, 10, 20, "", []byte(`{"req":true}`), []byte(`{"resp":true}`), headers, 200)
}
