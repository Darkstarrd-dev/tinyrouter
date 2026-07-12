package proxy

import "sync"

// Broadcaster fans out events to all subscribed channels. It solves the
// single-delivery problem of Go channels: every subscriber receives its own
// copy of each event, so multiple SSE listeners no longer steal events from
// each other.
type Broadcaster struct {
	mu      sync.RWMutex
	subs    map[uint64]chan interface{}
	nextID  uint64
	bufSize int
}

// NewBroadcaster creates a Broadcaster. Each subscriber channel is buffered
// with bufSize (defaults to 1 when bufSize < 1).
func NewBroadcaster(bufSize int) *Broadcaster {
	if bufSize < 1 {
		bufSize = 1
	}
	return &Broadcaster{
		subs:    make(map[uint64]chan interface{}),
		bufSize: bufSize,
	}
}

// Subscribe registers a new subscriber and returns a read-only channel that
// receives events plus an idempotent unsubscribe function. The unsubscribe
// function removes the subscriber from the registry, closes its channel, and
// is safe to call multiple times.
func (b *Broadcaster) Subscribe() (<-chan interface{}, func()) {
	b.mu.Lock()
	id := b.nextID
	b.nextID++
	ch := make(chan interface{}, b.bufSize)
	b.subs[id] = ch
	b.mu.Unlock()

	var once sync.Once
	unsub := func() {
		once.Do(func() {
			b.mu.Lock()
			if c, ok := b.subs[id]; ok {
				delete(b.subs, id)
				close(c)
			}
			b.mu.Unlock()
		})
	}
	return ch, unsub
}

// Signal broadcasts a single event to every subscriber. Delivery to each
// subscriber is non-blocking: if a subscriber's buffer is full the signal is
// skipped for that subscriber without affecting others.
func (b *Broadcaster) Signal() {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, ch := range b.subs {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// Broadcast delivers a typed event to every subscriber. If any subscriber's
// channel buffer is full, delivery for that subscriber is skipped while
// others still receive the event.
func (b *Broadcaster) Broadcast(event interface{}) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, ch := range b.subs {
		select {
		case ch <- event:
		default:
		}
	}
}
