package proxy

import (
	"testing"
	"time"
)

func TestSignatureCache_PutGet(t *testing.T) {
	c := NewSignatureCache()
	c.Put("id1", "sig1")
	c.Put("id2", "sig2")

	if sig, ok := c.Get("id1"); !ok || sig != "sig1" {
		t.Fatalf("expected id1=sig1, got %q ok=%v", sig, ok)
	}
	if sig, ok := c.Get("id2"); !ok || sig != "sig2" {
		t.Fatalf("expected id2=sig2, got %q ok=%v", sig, ok)
	}
	if _, ok := c.Get("missing"); ok {
		t.Fatalf("expected missing id to not be found")
	}
}

func TestSignatureCache_TTL(t *testing.T) {
	c := NewSignatureCache()
	c.Put("id1", "sig1")

	// Re-Get should not refresh putAt; manually forcing expiry via a fresh
	// entry past TTL is validated through evictExpired on the next Put and
	// through the Get TTL check below.
	if _, ok := c.Get("id1"); !ok {
		t.Fatalf("expected id1 present immediately after Put")
	}

	// Build a second cache with a tiny TTL and confirm expiry.
	c2 := &SignatureCache{
		entries:    make(map[string]sigEntry),
		maxEntries: defaultSigMaxEntries,
		ttl:        10 * time.Millisecond,
	}
	c2.Put("id1", "sig1")
	time.Sleep(20 * time.Millisecond)
	if _, ok := c2.Get("id1"); ok {
		t.Fatalf("expected id1 to be expired after TTL")
	}
}

func TestSignatureCache_LRU(t *testing.T) {
	c := &SignatureCache{
		entries:    make(map[string]sigEntry),
		maxEntries: 3,
		ttl:        defaultSigTTL,
	}
	for i := 0; i < 3; i++ {
		c.Put(string(rune('a'+i)), "sig")
		time.Sleep(2 * time.Millisecond)
	}
	if len(c.entries) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(c.entries))
	}
	// Adding a 4th should evict the oldest (a).
	c.Put("d", "sig")
	if len(c.entries) != 3 {
		t.Fatalf("expected still 3 entries after cap, got %d", len(c.entries))
	}
	if _, ok := c.Get("a"); ok {
		t.Fatalf("expected oldest entry 'a' to be evicted (LRU)")
	}
	if _, ok := c.Get("b"); !ok {
		t.Fatalf("expected entry 'b' to survive")
	}
}
