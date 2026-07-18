package api

import (
	"sync"
	"time"
)

const (
	// galleryMaxSessions caps the number of in-memory zip sessions retained.
	galleryMaxSessions = 8
	// gallerySessionTTL is the idle expiry for a zip session.
	gallerySessionTTL = 5 * time.Minute
)

// zipSession holds an uploaded zip archive in memory along with bookkeeping for
// idle expiry.
type zipSession struct {
	data       []byte
	createdAt  time.Time
	lastAccess time.Time
}

// gallerySessionStore is a thread-safe, bounded LRU store of in-memory zip
// sessions. It is intentionally simple: retention is bounded by
// galleryMaxSessions and stale entries are evicted by touchSessions.
type gallerySessionStore struct {
	mu       sync.RWMutex
	sessions map[string]*zipSession
	order    []string // insertion/access order for LRU eviction
}

func newGallerySessionStore() *gallerySessionStore {
	return &gallerySessionStore{
		sessions: make(map[string]*zipSession),
	}
}

// put stores data under sessionID, evicting the least-recently-used session
// when the store is over capacity.
func (s *gallerySessionStore) put(sessionID string, data []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.sessions[sessionID]; ok {
		s.removeLocked(sessionID)
	}
	s.sessions[sessionID] = &zipSession{
		data:       data,
		createdAt:  time.Now(),
		lastAccess: time.Now(),
	}
	s.order = append(s.order, sessionID)

	for len(s.order) > galleryMaxSessions {
		s.removeLocked(s.order[0])
	}
}

// get returns the session data for sessionID and updates its last-access time.
func (s *gallerySessionStore) get(sessionID string) ([]byte, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[sessionID]
	if !ok {
		return nil, false
	}
	sess.lastAccess = time.Now()
	s.bumpLocked(sessionID)
	return sess.data, true
}

// remove deletes a single session under lock (caller must hold mu).
func (s *gallerySessionStore) removeLocked(sessionID string) {
	delete(s.sessions, sessionID)
	for i, id := range s.order {
		if id == sessionID {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
}

// bumpLocked moves sessionID to the most-recently-used position (caller holds mu).
func (s *gallerySessionStore) bumpLocked(sessionID string) {
	for i, id := range s.order {
		if id == sessionID {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
	s.order = append(s.order, sessionID)
}

// touch evicts sessions idle for longer than gallerySessionTTL. It is run
// periodically by the cleanup goroutine.
func (s *gallerySessionStore) touch() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	var expired []string
	for id, sess := range s.sessions {
		if now.Sub(sess.lastAccess) > gallerySessionTTL {
			expired = append(expired, id)
		}
	}
	for _, id := range expired {
		s.removeLocked(id)
	}
}

// gallerySessions is the package-level store for zip preview sessions.
var gallerySessions = newGallerySessionStore()

// gallerySessionCleanup periodically evicts expired zip sessions. It is
// fire-and-forget: the process owns all memory and exits cleanly without
// needing explicit teardown.
func gallerySessionCleanup() {
	ticker := time.NewTicker(1 * time.Minute)
	for range ticker.C {
		gallerySessions.touch()
	}
}
