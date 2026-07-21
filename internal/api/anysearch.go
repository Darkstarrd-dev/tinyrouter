package api

import (
	"encoding/json"
	"net/http"

	"github.com/tinyrouter/tinyrouter/internal/anysearch"
)

// anySearchHandler proxies a search request to the AnySearch API.
// POST /api/anysearch/search
func (rt *Router) anySearchHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Query            string                 `json:"query"`
		Domain           string                 `json:"domain,omitempty"`
		SubDomain        string                 `json:"sub_domain,omitempty"`
		SubDomainParams  map[string]interface{} `json:"sub_domain_params,omitempty"`
		MaxResults       int                    `json:"max_results,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Query == "" {
		writeAPIError(w, http.StatusBadRequest, "query is required")
		return
	}

	cfg := rt.reg.Config()
	maxResults := req.MaxResults
	if maxResults == 0 {
		maxResults = cfg.AnySearch.MaxResults
	}

	client := anysearch.New(cfg.AnySearch.APIKey)
	text, err := client.Search(req.Query, req.Domain, req.SubDomain, req.SubDomainParams, maxResults)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"result": text})
}

// anySearchSubDomainsHandler proxies a get_sub_domains request to the AnySearch API.
// POST /api/anysearch/subdomains
func (rt *Router) anySearchSubDomainsHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Domain string `json:"domain"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.Domain == "" {
		writeAPIError(w, http.StatusBadRequest, "domain is required")
		return
	}

	cfg := rt.reg.Config()
	client := anysearch.New(cfg.AnySearch.APIKey)
	text, err := client.GetSubDomains(req.Domain)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"result": text})
}

// anySearchExtractHandler proxies an extract request to the AnySearch API.
// POST /api/anysearch/extract
func (rt *Router) anySearchExtractHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if req.URL == "" {
		writeAPIError(w, http.StatusBadRequest, "url is required")
		return
	}

	cfg := rt.reg.Config()
	client := anysearch.New(cfg.AnySearch.APIKey)
	text, err := client.Extract(req.URL)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"result": text})
}