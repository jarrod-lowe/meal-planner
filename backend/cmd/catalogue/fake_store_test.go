package main

import (
	"context"
	"reflect"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/jarrod-lowe/meal-planner/backend/internal/model"
	"github.com/jarrod-lowe/meal-planner/backend/internal/store"
)

const fakeNow = "2026-11-28T00:00:00.000Z"

// fakeStore is an in-memory store.CatalogueStore with the same version
// rules as the DynamoDB one. Items are kept as DynamoDB attribute maps, so
// stored values are copies.
type fakeStore struct {
	items map[model.Key]map[string]types.AttributeValue
	// err, when set, is returned by every method.
	err error
	// calls counts calls by method name.
	calls map[string]int
}

var _ store.CatalogueStore = (*fakeStore)(nil)

func newFakeStore() *fakeStore {
	return &fakeStore{items: map[model.Key]map[string]types.AttributeValue{}, calls: map[string]int{}}
}

func (f *fakeStore) call(name string) error {
	f.calls[name]++
	return f.err
}

func (f *fakeStore) Put(_ context.Context, item store.Item, by string) error {
	if err := f.call("Put"); err != nil {
		return err
	}
	return f.put(item, by)
}

func (f *fakeStore) put(item store.Item, by string) error {
	k := item.Keys()
	key := model.Key{PK: k.PK, SK: k.SK}
	v := item.Versioning()
	existing, ok := f.items[key]
	if v.Version == 0 && ok {
		return store.ErrAlreadyExists
	}
	if v.Version > 0 {
		if !ok {
			return &store.VersionConflictError{}
		}
		var cur model.Versioned
		_ = attributevalue.UnmarshalMap(existing, &cur)
		if cur.Version != v.Version {
			current := reflect.New(reflect.TypeOf(item).Elem()).Interface().(store.Item)
			_ = attributevalue.UnmarshalMap(existing, current)
			return &store.VersionConflictError{Current: current}
		}
	}
	*v = model.Versioned{Version: v.Version + 1, UpdatedAt: fakeNow, UpdatedBy: by}
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		return err
	}
	f.items[key] = av
	return nil
}

func (f *fakeStore) LoadCatalogue(context.Context) (model.Catalogue, error) {
	if err := f.call("LoadCatalogue"); err != nil {
		return model.Catalogue{}, err
	}
	var c model.Catalogue
	for key, av := range f.items {
		switch {
		case strings.HasPrefix(key.SK, model.RecipePrefix):
			var r model.Recipe
			_ = attributevalue.UnmarshalMap(av, &r)
			c.Recipes = append(c.Recipes, r)
		case strings.HasPrefix(key.SK, model.IngredientPrefix):
			var i model.Ingredient
			_ = attributevalue.UnmarshalMap(av, &i)
			c.Ingredients = append(c.Ingredients, i)
		}
	}
	return c, nil
}

func (f *fakeStore) SoftDelete(_ context.Context, item store.Deletable, by string) error {
	if err := f.call("SoftDelete"); err != nil {
		return err
	}
	item.SetKeys()
	k := item.Keys()
	av, ok := f.items[model.Key{PK: k.PK, SK: k.SK}]
	if !ok {
		return store.ErrNotFound
	}
	_ = attributevalue.UnmarshalMap(av, item)
	if *item.Deletion() {
		return nil
	}
	*item.Deletion() = true
	return f.put(item, by)
}

// Seeding helpers.

func (f *fakeStore) addIngredient(id, name, unit string, version int) {
	i := model.Ingredient{ID: id, Name: name, Unit: unit, ShopSection: model.ShopSectionPantry,
		Versioned: model.Versioned{Version: version, UpdatedAt: fakeNow, UpdatedBy: "seed"}}
	i.SetKeys()
	f.items[model.Key{PK: i.PK, SK: i.SK}], _ = attributevalue.MarshalMap(i)
}

func (f *fakeStore) addRecipe(id, name string, version int, deleted bool, lines ...model.RecipeLine) {
	r := model.Recipe{ID: id, Name: name, Servings: 4, Lines: lines, Notes: "Mix.", Deleted: deleted,
		Versioned: model.Versioned{Version: version, UpdatedAt: fakeNow, UpdatedBy: "seed"}}
	r.SetKeys()
	f.items[model.Key{PK: r.PK, SK: r.SK}], _ = attributevalue.MarshalMap(r)
}

func (f *fakeStore) getRecipe(id string) (model.Recipe, bool) {
	var r model.Recipe
	av, ok := f.items[model.Key{PK: model.CataloguePK, SK: model.RecipePrefix + id}]
	if ok {
		_ = attributevalue.UnmarshalMap(av, &r)
	}
	return r, ok
}

func (f *fakeStore) getIngredient(id string) (model.Ingredient, bool) {
	var i model.Ingredient
	av, ok := f.items[model.Key{PK: model.CataloguePK, SK: model.IngredientPrefix + id}]
	if ok {
		_ = attributevalue.UnmarshalMap(av, &i)
	}
	return i, ok
}

// fixedClock steps by 5 ms per call, so durations are predictable.
func fixedClock() func() time.Time {
	t := time.Date(2026, 11, 28, 0, 0, 0, 0, time.UTC)
	return func() time.Time {
		t = t.Add(5 * time.Millisecond)
		return t
	}
}
