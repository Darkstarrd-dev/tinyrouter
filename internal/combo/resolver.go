package combo

import (
	"sync"

	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/registry"
)

// ModelTarget is a resolved provider+model pair within a combo.
type ModelTarget struct {
	ProviderID string
	Model      string
}

// ComboPlan describes how to execute a combo request.
type ComboPlan struct {
	Strategy   string        // "fallback" | "round-robin" | "fusion"
	Targets    []ModelTarget // ordered (fallback/round-robin) or parallel (fusion)
	JudgeModel string        // fusion only
}

// Resolver resolves combo names into execution plans.
type Resolver struct {
	reg   *registry.Registry
	mu    sync.Mutex
	state map[string]*comboState // combo name → rotation state
}

type comboState struct {
	index       int
	consecCount int
}

// New creates a Resolver.
func New(reg *registry.Registry) *Resolver {
	return &Resolver{reg: reg, state: make(map[string]*comboState)}
}

// Resolve returns a ComboPlan for the given combo name, or nil if not found.
func (r *Resolver) Resolve(comboName string) (*ComboPlan, error) {
	combo, ok := r.reg.GetComboByName(comboName)
	if !ok {
		return nil, nil
	}

	var targets []ModelTarget
	for _, m := range combo.Models {
		providerID, model := splitModel(m)
		if providerID == "" {
			continue
		}
		targets = append(targets, ModelTarget{ProviderID: providerID, Model: model})
	}

	if len(targets) == 0 {
		return nil, nil
	}

	plan := &ComboPlan{
		Strategy:   combo.Strategy,
		Targets:    targets,
		JudgeModel: combo.FusionJudge,
	}

	if combo.Strategy == "round-robin" {
		plan.Targets = r.rotateTargets(combo.Name, targets)
	}

	return plan, nil
}

// rotateTargets rotates the target list based on internal state.
func (r *Resolver) rotateTargets(comboName string, targets []ModelTarget) []ModelTarget {
	r.mu.Lock()
	defer r.mu.Unlock()

	st, ok := r.state[comboName]
	if !ok {
		st = &comboState{index: 0, consecCount: 0}
		r.state[comboName] = st
	}

	st.consecCount++
	if st.consecCount > 3 { // stickyLimit=3
		st.index = (st.index + 1) % len(targets)
		st.consecCount = 1
	}

	// Rotate slice so current index is first
	result := make([]ModelTarget, len(targets))
	for i := range targets {
		result[i] = targets[(st.index+i)%len(targets)]
	}
	return result
}

// splitModel parses "provider/model" into (providerID, model).
// If no slash, returns ("", model) which is invalid for our purposes.
func splitModel(s string) (string, string) {
	for i := 0; i < len(s); i++ {
		if s[i] == '/' {
			return s[:i], s[i+1:]
		}
	}
	return "", s
}

// IsComboName checks if the given model string matches a combo name.
func (r *Resolver) IsComboName(name string) bool {
	_, ok := r.reg.GetComboByName(name)
	return ok
}

// ListCombos returns all combos.
func (r *Resolver) ListCombos() []config.Combo {
	return r.reg.ListCombos()
}
