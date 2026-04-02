package graph

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"gorm.io/gorm"
)

const (
	// NodeLayoutBackfillMigrationID identifies the one-time migration that
	// backfills canonical node layout fields from legacy node properties.
	NodeLayoutBackfillMigrationID = "20260402_node_layout_backfill_v1"
)

// AppMigration marks one migration as applied to keep startup migrations
// idempotent across process restarts.
type AppMigration struct {
	ID        string    `gorm:"column:id;type:varchar(128);primaryKey;not null"`
	AppliedAt time.Time `gorm:"column:applied_at;type:datetime;not null;autoCreateTime:milli"`
}

// TableName binds AppMigration to the app_migrations table.
func (AppMigration) TableName() string {
	return "app_migrations"
}

// NodeLayoutBackfillResult summarizes one run of legacy layout backfill.
type NodeLayoutBackfillResult struct {
	MigrationID         string
	Skipped             bool
	TotalNodes          int
	UpdatedNodes        int
	InvalidPropertyRows int
}

// BackfillLegacyNodeLayoutColumns migrates legacy layout keys from
// properties.x/properties.y/properties.collapsed into canonical node columns.
//
// The migration is guarded by app_migrations so it only runs once.
func BackfillLegacyNodeLayoutColumns(ctx context.Context, database *gorm.DB) (NodeLayoutBackfillResult, error) {
	result := NodeLayoutBackfillResult{
		MigrationID: NodeLayoutBackfillMigrationID,
	}

	if ctx == nil {
		return result, fmt.Errorf("graph: nil context")
	}
	if database == nil {
		return result, fmt.Errorf("graph: nil database handle")
	}

	err := database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var migration AppMigration
		if err := tx.WithContext(ctx).
			First(&migration, "id = ?", NodeLayoutBackfillMigrationID).Error; err == nil {
			result.Skipped = true
			return nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		var nodes []Node
		if err := tx.WithContext(ctx).Find(&nodes).Error; err != nil {
			return err
		}

		result.TotalNodes = len(nodes)
		for _, node := range nodes {
			layout, hasLegacyKeys, hasInvalidValues := extractLegacyNodeLayout(node.Properties)
			if hasInvalidValues {
				result.InvalidPropertyRows++
			}
			if !hasLegacyKeys {
				continue
			}

			updateFields := make(map[string]any, 3)
			if layout.hasX {
				updateFields["x"] = layout.x
			}
			if layout.hasY {
				updateFields["y"] = layout.y
			}
			if layout.hasCollapsed {
				updateFields["collapsed"] = layout.collapsed
			}

			if len(updateFields) == 0 {
				continue
			}

			updateResult := tx.WithContext(ctx).
				Model(&Node{}).
				Where("id = ?", node.ID).
				Updates(updateFields)
			if updateResult.Error != nil {
				return updateResult.Error
			}
			if updateResult.RowsAffected > 0 {
				result.UpdatedNodes++
			}
		}

		return tx.WithContext(ctx).Create(&AppMigration{
			ID: NodeLayoutBackfillMigrationID,
		}).Error
	})

	if err != nil {
		return result, err
	}

	return result, nil
}

type legacyNodeLayout struct {
	x            float64
	y            float64
	collapsed    bool
	hasX         bool
	hasY         bool
	hasCollapsed bool
}

func extractLegacyNodeLayout(document JSONDocument) (legacyNodeLayout, bool, bool) {
	if len(document) == 0 {
		return legacyNodeLayout{}, false, false
	}

	var properties map[string]any
	if err := json.Unmarshal(document, &properties); err != nil {
		return legacyNodeLayout{}, false, true
	}

	layout := legacyNodeLayout{}
	hasLegacyKeys := false
	hasInvalidValues := false

	if rawX, exists := properties["x"]; exists {
		hasLegacyKeys = true
		x, ok := parseFiniteFloat(rawX)
		if ok {
			layout.x = x
			layout.hasX = true
		} else {
			hasInvalidValues = true
		}
	}

	if rawY, exists := properties["y"]; exists {
		hasLegacyKeys = true
		y, ok := parseFiniteFloat(rawY)
		if ok {
			layout.y = y
			layout.hasY = true
		} else {
			hasInvalidValues = true
		}
	}

	if rawCollapsed, exists := properties["collapsed"]; exists {
		hasLegacyKeys = true
		collapsed, ok := rawCollapsed.(bool)
		if ok {
			layout.collapsed = collapsed
			layout.hasCollapsed = true
		} else {
			hasInvalidValues = true
		}
	}

	return layout, hasLegacyKeys, hasInvalidValues
}

func parseFiniteFloat(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return 0, false
		}
		return v, true
	case float32:
		fv := float64(v)
		if math.IsNaN(fv) || math.IsInf(fv, 0) {
			return 0, false
		}
		return fv, true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case int32:
		return float64(v), true
	case uint:
		return float64(v), true
	case uint64:
		return float64(v), true
	case uint32:
		return float64(v), true
	default:
		return 0, false
	}
}
