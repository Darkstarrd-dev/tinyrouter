package state

import (
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

const (
	// CurrentVersion is the snapshot format version.
	CurrentVersion = 1
)

// Snapshot is the top-level persisted runtime state.
type Snapshot struct {
	Version int                       `yaml:"version"`
	SavedAt time.Time                 `yaml:"saved_at"`
	Keys    map[string]*KeySnapshot   `yaml:"keys"`
	Combos  map[string]*ComboSnapshot `yaml:"combos"`
}

// KeySnapshot holds the persistable subset of a key's runtime state.
type KeySnapshot struct {
	BackoffLevel int                  `yaml:"backoff_level"`
	ModelLocks   map[string]time.Time `yaml:"model_locks,omitempty"`
	// ModelStatus persists per-model cooldown/lock status so the lock type
	// (cooldown vs daily-locked) survives a restart.
	ModelStatus map[string]string `yaml:"model_status,omitempty"`
	RotatedAt   time.Time         `yaml:"rotated_at,omitempty"`
	ConsecCount      int                  `yaml:"consec_count"`
	LastUsedAt       time.Time            `yaml:"last_used_at,omitempty"`
	NIMRequestCount  int                  `yaml:"nim_request_count,omitempty"`
	NIMLastSendTime  time.Time            `yaml:"nim_last_send_time,omitempty"`
	NIMCooldownLevel int                  `yaml:"nim_cooldown_level,omitempty"`
	NIMLast429Time   time.Time            `yaml:"nim_last_429_time,omitempty"`
}

// ComboSnapshot holds the persistable subset of a combo's rotation state.
type ComboSnapshot struct {
	Index       int `yaml:"index"`
	ConsecCount int `yaml:"consec_count"`
}

// Load reads a snapshot from path. If the file does not exist it returns an
// empty snapshot with CurrentVersion.
func Load(path string) (*Snapshot, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return &Snapshot{
				Version: CurrentVersion,
				Keys:    make(map[string]*KeySnapshot),
				Combos:  make(map[string]*ComboSnapshot),
			}, nil
		}
		return nil, err
	}
	var s Snapshot
	if err := yaml.Unmarshal(data, &s); err != nil {
		return nil, err
	}
	if s.Keys == nil {
		s.Keys = make(map[string]*KeySnapshot)
	}
	if s.Combos == nil {
		s.Combos = make(map[string]*ComboSnapshot)
	}
	return &s, nil
}

// Save writes a snapshot to path atomically (temp file + rename).
func Save(path string, s *Snapshot) error {
	data, err := yaml.Marshal(s)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
