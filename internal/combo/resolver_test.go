package combo

import (
	"testing"

	"github.com/tinyrouter/tinyrouter/internal/config"
	"github.com/tinyrouter/tinyrouter/internal/registry"
)

func testRegistry(combos ...config.Combo) *registry.Registry {
	return registry.New(&config.Config{
		Combos: combos,
	})
}

func testRegistryWithProviders(providers []config.Provider, combos ...config.Combo) *registry.Registry {
	return registry.New(&config.Config{
		Providers: providers,
		Combos:    combos,
	})
}

func TestResolve_NotFound(t *testing.T) {
	r := New(testRegistry())
	plan, err := r.Resolve("nonexistent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if plan != nil {
		t.Fatalf("expected nil plan, got %+v", plan)
	}
}

func TestResolve_Fallback(t *testing.T) {
	providers := []config.Provider{
		{ID: "p1", Prefix: "provA", Name: "A"},
		{ID: "p2", Prefix: "provB", Name: "B"},
	}
	c := config.Combo{
		ID: "c1", Name: "fb", Strategy: "fallback",
		Models: []string{"provA/model-a", "provB/model-b"},
	}
	r := New(testRegistryWithProviders(providers, c))

	plan, err := r.Resolve("fb")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if plan == nil {
		t.Fatal("expected non-nil plan")
	}
	if plan.Strategy != "fallback" {
		t.Errorf("expected strategy fallback, got %s", plan.Strategy)
	}
	if len(plan.Targets) != 2 {
		t.Fatalf("expected 2 targets, got %d", len(plan.Targets))
	}
	if plan.Targets[0].ProviderID != "p1" || plan.Targets[0].Model != "model-a" {
		t.Errorf("unexpected first target: %+v", plan.Targets[0])
	}
	if plan.Targets[1].ProviderID != "p2" || plan.Targets[1].Model != "model-b" {
		t.Errorf("unexpected second target: %+v", plan.Targets[1])
	}
}

func TestResolve_RoundRobin_Sticky(t *testing.T) {
	providers := []config.Provider{
		{ID: "p1", Prefix: "provA", Name: "A"},
		{ID: "p2", Prefix: "provB", Name: "B"},
		{ID: "p3", Prefix: "provC", Name: "C"},
	}
	c := config.Combo{
		ID: "c1", Name: "rr", Strategy: "round-robin",
		Models: []string{"provA/model-a", "provB/model-b", "provC/model-c"},
	}
	r := New(testRegistryWithProviders(providers, c))

	for i := 0; i < 3; i++ {
		plan, _ := r.Resolve("rr")
		if plan.Targets[0].ProviderID != "p1" {
			t.Errorf("call %d: expected p1 first, got %s", i, plan.Targets[0].ProviderID)
		}
	}
}

func TestResolve_RoundRobin_Rotate(t *testing.T) {
	providers := []config.Provider{
		{ID: "p1", Prefix: "provA", Name: "A"},
		{ID: "p2", Prefix: "provB", Name: "B"},
		{ID: "p3", Prefix: "provC", Name: "C"},
	}
	c := config.Combo{
		ID: "c1", Name: "rr", Strategy: "round-robin",
		Models: []string{"provA/model-a", "provB/model-b", "provC/model-c"},
	}
	r := New(testRegistryWithProviders(providers, c))

	for i := 0; i < 3; i++ {
		r.Resolve("rr")
	}
	plan, _ := r.Resolve("rr")
	if plan.Targets[0].ProviderID != "p2" {
		t.Errorf("after 3 calls, expected p2 first, got %s", plan.Targets[0].ProviderID)
	}
}

func TestResolve_EmptyModels(t *testing.T) {
	c := config.Combo{
		ID: "c1", Name: "empty", Strategy: "fallback",
		Models: []string{},
	}
	r := New(testRegistry(c))

	plan, _ := r.Resolve("empty")
	if plan != nil {
		t.Fatalf("expected nil for empty models, got %+v", plan)
	}
}

func TestResolve_InvalidModelFormat(t *testing.T) {
	c := config.Combo{
		ID: "c1", Name: "bad", Strategy: "fallback",
		Models: []string{"no-slash"},
	}
	r := New(testRegistry(c))

	plan, _ := r.Resolve("bad")
	if plan != nil {
		t.Fatalf("expected nil for invalid model, got %+v", plan)
	}
}

func TestResolve_Fusion(t *testing.T) {
	providers := []config.Provider{
		{ID: "p1", Prefix: "provA", Name: "A"},
		{ID: "p2", Prefix: "provB", Name: "B"},
	}
	c := config.Combo{
		ID: "c1", Name: "fu", Strategy: "fusion",
		Models:      []string{"provA/model-a", "provB/model-b"},
		FusionJudge: "judge-model",
	}
	r := New(testRegistryWithProviders(providers, c))

	plan, _ := r.Resolve("fu")
	if plan == nil {
		t.Fatal("expected non-nil plan")
	}
	if plan.JudgeModel != "judge-model" {
		t.Errorf("expected judge model, got %s", plan.JudgeModel)
	}
	if len(plan.Targets) != 2 {
		t.Errorf("expected 2 targets, got %d", len(plan.Targets))
	}
}

func TestIsComboName(t *testing.T) {
	c := config.Combo{Name: "mycombo", Strategy: "fallback", Models: []string{"p/m"}}
	r := New(testRegistry(c))

	if !r.IsComboName("mycombo") {
		t.Error("expected true for existing combo")
	}
	if r.IsComboName("nonexistent") {
		t.Error("expected false for non-existent combo")
	}
}

func TestSplitModel(t *testing.T) {
	provider, model := splitModel("deepseek/deepseek-chat")
	if provider != "deepseek" || model != "deepseek-chat" {
		t.Errorf("expected deepseek/deepseek-chat, got %s/%s", provider, model)
	}

	provider, model = splitModel("no-slash")
	if provider != "" || model != "no-slash" {
		t.Errorf("expected empty provider, got %s/%s", provider, model)
	}

	provider, model = splitModel("a/b/c")
	if provider != "a" || model != "b/c" {
		t.Errorf("expected a/b/c, got %s/%s", provider, model)
	}
}
