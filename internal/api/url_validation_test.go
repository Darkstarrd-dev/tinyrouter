package api

import (
	"net/http"
	"testing"
)

func TestValidateBaseURL(t *testing.T) {
	cases := []struct {
		name    string
		baseURL string
		wantErr bool
	}{
		{"empty", "", true},
		{"non-http scheme", "ftp://example.com", true},
		{"javascript scheme", "javascript:alert(1)", true},
		{"file scheme", "file:///etc/passwd", true},
		{"missing host", "https://", true},
		{"localhost loopback", "http://127.0.0.1:8080", false},
		{"localhost hostname", "http://localhost:11434", false},
		{"IPv6 loopback", "http://[::1]/", false},
		{"link-local", "http://169.254.169.254/latest/meta-data/", false},
		{"private 10/8", "http://10.0.0.1/", false},
		{"private 192.168/16", "http://192.168.1.1/", false},
		{"public literal IP", "http://8.8.8.8/", false},
		{"example.com", "https://example.com", false},
		{"unresolvable hostname", "https://this-host-does-not-exist-zzz.invalid", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := validateBaseURL(c.baseURL)
			if c.wantErr && err == nil {
				t.Errorf("expected error for %q, got nil", c.baseURL)
			}
			if !c.wantErr && err != nil {
				t.Errorf("expected no error for %q, got: %v", c.baseURL, err)
			}
		})
	}
}

// TestCreateProvider_AcceptsLocalBaseURL verifies local providers are allowed.
func TestCreateProvider_AcceptsLocalBaseURL(t *testing.T) {
	srv, _, _, _ := setupTestServer(t)
	defer srv.Close()

	body := `{"id":"local","name":"Local","prefix":"local","baseUrl":"http://127.0.0.1:11434"}`
	resp := requestJSON(t, "POST", srv.URL+"/api/providers", body)
	if resp.StatusCode != http.StatusCreated {
		b := readBody(t, resp)
		t.Fatalf("expected 201 for local BaseURL, got %d: %s", resp.StatusCode, b)
	}
}
