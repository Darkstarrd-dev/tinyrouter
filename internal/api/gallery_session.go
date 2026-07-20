package api

import (
	"sync"
	"time"
)

const (
	// galleryMaxSessions caps the number of in-memory zip sessions retained.
	// Sessions are evicted only by LRU once the store exceeds this capacity.
	// There is intentionally no time-based TTL: a common usage pattern is
	// loading several archives and autoplaying through one while the others
	// sit idle. A short idle TTL would evict the idle archives mid-session,
	// surfacing as 404s when the user switches back to them. Bounding by LRU
	// alone keeps idle archives alive as long as they remain within the most
	// recently used set, which matches the single-user local nature of the app.
	galleryMaxSessions = 32
)

// zipSession holds an uploaded zip archive in memory along with bookkeeping
// for LRU eviction. pinCount prevents the session from being evicted while
// an AI review task is in progress.
type zipSession struct {
	data       []byte
	createdAt  time.Time
	lastAccess time.Time
	pinCount   int32
}

// gallerySessionStore is a thread-safe, bounded LRU store of in-memory zip
// sessions. Retention is bounded solely by galleryMaxSessions via LRU
// eviction; there is no time-based expiry.
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
		evicted := false
		for i, id := range s.order {
			if sess, ok := s.sessions[id]; ok && sess.pinCount == 0 {
				s.removeLocked(s.order[i])
				evicted = true
				break
			}
		}
		if !evicted {
			break // 所有剩余会话都被固定，无法淘汰
		}
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

// update replaces the stored zip data for an existing session and refreshes
// its last-access time. Returns false if the session does not exist.
func (s *gallerySessionStore) update(sessionID string, data []byte) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[sessionID]
	if !ok {
		return false
	}
	sess.data = data
	sess.lastAccess = time.Now()
	s.bumpLocked(sessionID)
	return true
}

// remove deletes a session by id.
func (s *gallerySessionStore) remove(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.removeLocked(sessionID)
}

// removeLocked deletes a single session under lock (caller must hold mu).
func (s *gallerySessionStore) removeLocked(sessionID string) {
	delete(s.sessions, sessionID)
	for i, id := range s.order {
		if id == sessionID {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
}

// pin 增加会话的固定计数，防止 LRU 淘汰
func (s *gallerySessionStore) pin(sessionID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[sessionID]
	if !ok {
		return false
	}
	sess.pinCount++
	return true
}

// unpin 减少会话的固定计数
func (s *gallerySessionStore) unpin(sessionID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[sessionID]
	if !ok {
		return false
	}
	if sess.pinCount > 0 {
		sess.pinCount--
	}
	return true
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

// gallerySessions is the package-level store for zip preview sessions.
var gallerySessions = newGallerySessionStore()
