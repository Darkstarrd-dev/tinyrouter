package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
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
		{"literal loopback IPv4", "http://127.0.0.1:8080", true},
		{"literal loopback IPv6", "http://[::1]/", true},
		{"literal link-local", "http://169.254.169.254/latest/meta-data/", true},
		{"literal private 10/8", "http://10.0.0.1/", true},
		{"literal private 192.168/16", "http://192.168.1.1/", true},
		{"literal unspecified", "http://0.0.0.0/", true},
		{"public literal IP", "http://8.8.8.8/", false},
		{"example.com (may resolve)", "https://example.com", false},
		{"unresolvable hostname (no DNS)", "https://this-host-does-not-exist-zzz.invalid", false}, // DNS fails → degrade to permissive
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

// TestCreateProvider_RejectsSsrfBaseURL verifies that the API handler refuses
// a provider BaseURL pointing to an AWS metadata IP (SSRF vector).
func TestCreateProvider_RejectsSsrfBaseURL(t *testing.T) {
	srv, _, _, _ := setupTestServer(t)
	defer srv.Close()

	body := `{"id":"ssrf","name":"SSRF","prefix":"ssrf","baseUrl":"http://169.254.169.254/latest/meta-data/"}`
	resp := requestJSON(t, "POST", srv.URL+"/api/providers", body)
	if resp.StatusCode != http.StatusBadRequest {
		b := readBody(t, resp)
		t.Fatalf("expected 400 for SSRF BaseURL, got %d: %s", resp.StatusCode, b)
	}
	respBody := readBody(t, resp)
	if !strings.Contains(respBody, "private") && !strings.Contains(respBody, "loopback") && !strings.Contains(respBody, "link-local") {
		t.Errorf("expected error to mention private/loopback/link-local, got: %s", respBody)
	}
}

// TestUpdateProvider_RejectsSsrfBaseURL: update path also rejects.
func TestUpdateProvider_RejectsSsrfBaseURL(t *testing.T) {
	srv, _, _, _ := setupTestServer(t)
	defer srv.Close()

	// First create a valid provider.
	createBody := `{"id":"ok","name":"OK","prefix":"ok","baseUrl":"https://example.com"}`
	if resp := requestJSON(t, "POST", srv.URL+"/api/providers", createBody); resp.StatusCode != http.StatusCreated {
		t.Fatalf("setup create failed: %d %s", resp.StatusCode, readBody(t, resp))
	}

	// Try to update to a private BaseURL.
	rec := httptest.NewRecorder()
	_ = rec
	updBody := `{"name":"OK","prefix":"ok","baseUrl":"http://10.0.0.1/"}`
	resp := requestJSON(t, "PUT", srv.URL+"/api/providers/ok", updBody)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 on update, got %d: %s", resp.StatusCode, readBody(t, resp))
	}
}
