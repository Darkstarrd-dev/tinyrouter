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

func TestResolve_GreedySquirrel_TierOrdering(t *testing.T) {
	providers := []config.Provider{
		{ID: "p1", Prefix: "provA", Name: "A", Models: []config.ModelDef{
			{ID: "model-a", QuotaType: "unlimited"},
		}},
		{ID: "p2", Prefix: "provB", Name: "B", Models: []config.ModelDef{
			{ID: "model-b", QuotaType: "paid"},
		}},
		{ID: "p3", Prefix: "provC", Name: "C", Models: []config.ModelDef{
			{ID: "model-c", QuotaType: "limited"},
		}},
	}
	c := config.Combo{
		ID: "c1", Name: "gs", Strategy: "greedy-squirrel",
		Models: []string{"provA/model-a", "provB/model-b", "provC/model-c"},
	}
	r := New(testRegistryWithProviders(providers, c))

	plan, err := r.Resolve("gs")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if plan == nil {
		t.Fatal("expected non-nil plan")
	}
	if plan.Strategy != "greedy-squirrel" {
		t.Errorf("expected strategy greedy-squirrel, got %s", plan.Strategy)
	}
	if len(plan.Targets) != 3 {
		t.Fatalf("expected 3 targets, got %d", len(plan.Targets))
	}
	// Expected ordering: unlimited → limited → paid
	if plan.Targets[0].ProviderID != "p1" || plan.Targets[0].QuotaType != "unlimited" {
		t.Errorf("expected first target p1/unlimited, got %+v", plan.Targets[0])
	}
	if plan.Targets[1].ProviderID != "p3" || plan.Targets[1].QuotaType != "limited" {
		t.Errorf("expected second target p3/limited, got %+v", plan.Targets[1])
	}
	if plan.Targets[2].ProviderID != "p2" || plan.Targets[2].QuotaType != "paid" {
		t.Errorf("expected third target p2/paid, got %+v", plan.Targets[2])
	}
}

func TestResolve_GreedySquirrel_UnknownQuotaDefaultsLimited(t *testing.T) {
	providers := []config.Provider{
		{ID: "p1", Prefix: "provA", Name: "A", Models: []config.ModelDef{
			{ID: "model-a", QuotaType: "unlimited"},
		}},
		{ID: "p2", Prefix: "provB", Name: "B"},
		{ID: "p3", Prefix: "provC", Name: "C"},
	}
	c := config.Combo{
		ID: "c1", Name: "gs2", Strategy: "greedy-squirrel",
		Models: []string{"provA/model-a", "provB/model-b", "provC/model-c"},
	}
	r := New(testRegistryWithProviders(providers, c))

	plan, _ := r.Resolve("gs2")
	if plan == nil {
		t.Fatal("expected non-nil plan")
	}
	if len(plan.Targets) != 3 {
		t.Fatalf("expected 3 targets, got %d", len(plan.Targets))
	}
	// model-a is unlimited, model-b and model-c have empty quota → default to limited
	if plan.Targets[0].ProviderID != "p1" || plan.Targets[0].QuotaType != "unlimited" {
		t.Errorf("expected first target p1/unlimited, got %+v", plan.Targets[0])
	}
	if plan.Targets[1].QuotaType != "limited" {
		t.Errorf("expected second target limited, got %+v", plan.Targets[1])
	}
	if plan.Targets[2].QuotaType != "limited" {
		t.Errorf("expected third target limited, got %+v", plan.Targets[2])
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
