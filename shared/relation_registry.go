package shared

import (
	_ "embed"
	"encoding/json"
	"strings"
)

//go:embed relation_types.json
var relationTypesJSON []byte

// RelationDefinition describes one semantic edge type shared by the frontend
// and backend.
type RelationDefinition struct {
	Code                string `json:"code"`
	Label               string `json:"label"`
	IsHierarchical      bool   `json:"hierarchical"`
	IsAcyclic           bool   `json:"acyclic"`
	AllowsMultiParent   bool   `json:"allows_multi_parent"`
	CanCollapseChildren bool   `json:"can_collapse_children"`
}

var relationDefinitions = mustLoadRelationDefinitions()

func mustLoadRelationDefinitions() map[string]RelationDefinition {
	var definitions []RelationDefinition
	if err := json.Unmarshal(relationTypesJSON, &definitions); err != nil {
		panic(err)
	}

	result := make(map[string]RelationDefinition, len(definitions))
	for _, definition := range definitions {
		code := strings.ToUpper(strings.TrimSpace(definition.Code))
		if code == "" {
			continue
		}

		definition.Code = code
		result[code] = definition
	}

	return result
}

// LookupRelationDefinition returns the canonical definition for one relation code.
func LookupRelationDefinition(code string) (RelationDefinition, bool) {
	definition, ok := relationDefinitions[strings.ToUpper(strings.TrimSpace(code))]
	return definition, ok
}
