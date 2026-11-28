package store

import (
	"context"
	"errors"
	"fmt"
	"reflect"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"

	"github.com/jarrod-lowe/meal-planner/backend/internal/model"
)

// maxSoftDeleteAttempts bounds a soft delete's get-then-put retries when
// other writes keep winning the version check.
const maxSoftDeleteAttempts = 5

// LoadCatalogue implements CatalogueStore. Item types it doesn't know are
// skipped.
func (s *DynamoDB) LoadCatalogue(ctx context.Context) (model.Catalogue, error) {
	items, err := s.QueryPartition(ctx, model.CataloguePK)
	if err != nil {
		return model.Catalogue{}, err
	}
	c := model.Catalogue{Recipes: []model.Recipe{}, Ingredients: []model.Ingredient{}}
	for _, av := range items {
		var keys model.StorageKeys
		if err := attributevalue.UnmarshalMap(av, &keys); err != nil {
			return model.Catalogue{}, fmt.Errorf("decoding keys in the catalogue: %w", err)
		}
		var target any
		switch keys.Type {
		case model.TypeRecipe:
			c.Recipes = append(c.Recipes, model.Recipe{})
			target = &c.Recipes[len(c.Recipes)-1]
		case model.TypeIngredient:
			c.Ingredients = append(c.Ingredients, model.Ingredient{})
			target = &c.Ingredients[len(c.Ingredients)-1]
		default:
			continue
		}
		if err := attributevalue.UnmarshalMap(av, target); err != nil {
			return model.Catalogue{}, fmt.Errorf("decoding %s %s: %w", keys.PK, keys.SK, err)
		}
	}
	return c, nil
}

// SoftDelete implements CatalogueStore: get, then put with `deleted: true`
// and the version just read, again from the get when the put loses.
func (s *DynamoDB) SoftDelete(ctx context.Context, item Deletable, by string) error {
	item.SetKeys()
	k := item.Keys()
	key := model.Key{PK: k.PK, SK: k.SK}
	for attempt := range maxSoftDeleteAttempts {
		// Start from an empty item, so nothing from an earlier read is left.
		reflect.ValueOf(item).Elem().SetZero()
		if err := s.Get(ctx, key, item); err != nil {
			return err
		}
		if *item.Deletion() {
			return nil
		}
		*item.Deletion() = true
		if s.beforeSoftDeletePut != nil {
			s.beforeSoftDeletePut(attempt)
		}
		err := s.Put(ctx, item, by)
		if !errors.Is(err, ErrVersionConflict) {
			return err
		}
	}
	return fmt.Errorf("soft-deleting %s %s: other writes won %d times", key.PK, key.SK, maxSoftDeleteAttempts)
}
