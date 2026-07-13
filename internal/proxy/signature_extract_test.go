package proxy

import (
	"testing"
)

func TestExtractThoughtSignature_FromDeltaToolCall(t *testing.T) {
	payload := []byte(`{"choices":[{"delta":{"index":0,"role":"assistant","tool_calls":[{"extra_content":{"google":{"thought_signature":"Eo4GCosG==="}},"function":{"arguments":"{}","name":"task"},"id":"FL1tqiJ9","type":"function"}]}}],"model":"models/gemini-3.1-flash-lite"}`)

	id, sig, ok := extractThoughtSignature(payload)
	if !ok {
		t.Fatalf("expected ok=true, got ok=false")
	}
	if id != "FL1tqiJ9" {
		t.Fatalf("expected id FL1tqiJ9, got %q", id)
	}
	if sig != "Eo4GCosG===" {
		t.Fatalf("expected sig Eo4GCosG===, got %q", sig)
	}
}

func TestExtractThoughtSignature_MultiplePicksFirst(t *testing.T) {
	payload := []byte(`{"choices":[{"delta":{"tool_calls":[
		{"id":"a","extra_content":{"google":{"thought_signature":"sigA"}}},
		{"id":"b","extra_content":{"google":{"thought_signature":"sigB"}}}
	]}}]}`)
	id, sig, ok := extractThoughtSignature(payload)
	if !ok || id != "a" || sig != "sigA" {
		t.Fatalf("expected a/sigA, got %q/%q ok=%v", id, sig, ok)
	}
}

func TestExtractThoughtSignature_NoSignature(t *testing.T) {
	payload := []byte(`{"choices":[{"delta":{"tool_calls":[
		{"id":"FL1tqiJ9","function":{"name":"task"},"type":"function"}
	]}}]}`)
	if _, _, ok := extractThoughtSignature(payload); ok {
		t.Fatalf("expected ok=false when no signature present")
	}
}

func TestExtractThoughtSignature_Malformed(t *testing.T) {
	payload := []byte(`{not valid json`)
	if _, _, ok := extractThoughtSignature(payload); ok {
		t.Fatalf("expected ok=false on malformed JSON (no panic)")
	}
}

func TestExtractThoughtSignature_NotToolCall(t *testing.T) {
	payload := []byte(`{"choices":[{"delta":{"content":"hello"}}]}`)
	if _, _, ok := extractThoughtSignature(payload); ok {
		t.Fatalf("expected ok=false for plain content chunk")
	}
}
