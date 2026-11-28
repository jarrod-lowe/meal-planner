package store

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"

	"github.com/jarrod-lowe/meal-planner/backend/internal/model"
)

// newCatalogueStore returns a store on a table of its own, so the CATALOGUE
// partition holds only this test's items.
func newCatalogueStore(t *testing.T) *DynamoDB {
	t.Helper()
	s := newTestStore(t)
	ctx := context.Background()
	table := "meal-planner-catalogue-test-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	if err := createTable(ctx, testClient, table); err != nil {
		t.Fatalf("creating table %s: %v", table, err)
	}
	t.Cleanup(func() {
		if _, err := testClient.DeleteTable(ctx, &dynamodb.DeleteTableInput{TableName: aws.String(table)}); err != nil {
			t.Errorf("deleting table %s: %v", table, err)
		}
	})
	s.table = table
	return s
}

func newIngredient(name string) *model.Ingredient {
	i := &model.Ingredient{ID: newID(), Name: name, Unit: "g", ShopSection: model.ShopSectionPantry}
	i.SetKeys()
	return i
}

func newRecipe(name string, lines ...model.RecipeLine) *model.Recipe {
	r := &model.Recipe{ID: newID(), Name: name, Servings: 4, Lines: lines, Notes: "Mix."}
	r.SetKeys()
	return r
}

func TestLoadCatalogue(t *testing.T) {
	ctx := context.Background()
	s := newCatalogueStore(t)
	s.pageSize = 2 // force pagination

	empty, err := s.LoadCatalogue(ctx)
	if err != nil {
		t.Fatalf("LoadCatalogue() of an empty catalogue error = %v", err)
	}
	if empty.Recipes == nil || empty.Ingredients == nil || len(empty.Recipes)+len(empty.Ingredients) != 0 {
		t.Errorf("empty catalogue = %+v, want empty slices", empty)
	}

	var ingredientIDs []string
	for _, n := range []string{"Flour", "Milk", "Eggs", "Sugar", "Salt"} {
		i := newIngredient(n)
		mustPut(t, s, i, "c")
		ingredientIDs = append(ingredientIDs, i.ID)
	}
	pancakes := newRecipe("Pancakes", model.RecipeLine{IngredientID: ingredientIDs[0], Quantity: 200}, model.RecipeLine{IngredientID: ingredientIDs[1], Quantity: 0.5})
	mustPut(t, s, pancakes, "c")
	mustPut(t, s, newRecipe("Toast"), "c")
	hidden := newRecipe("Old")
	hidden.Deleted = true
	mustPut(t, s, hidden, "c")
	if err := s.SoftDelete(ctx, &model.Ingredient{ID: ingredientIDs[4]}, "c"); err != nil {
		t.Fatalf("SoftDelete() error = %v", err)
	}
	// An item type the catalogue doesn't know is skipped.
	other := newAttendee("x", "Not catalogue", 0)
	other.PK, other.SK = model.CataloguePK, "OTHER#1"
	mustPut(t, s, other, "c")

	got, err := s.LoadCatalogue(ctx)
	if err != nil {
		t.Fatalf("LoadCatalogue() error = %v", err)
	}
	var names []string
	deleted := map[string]bool{}
	for _, i := range got.Ingredients {
		names = append(names, i.Name)
		deleted[i.Name] = i.Deleted
		if i.Unit != "g" || i.ShopSection != model.ShopSectionPantry || i.Version < 1 || i.PK != model.CataloguePK {
			t.Errorf("ingredient = %+v", i)
		}
	}
	sort.Strings(names)
	if fmt.Sprint(names) != "[Eggs Flour Milk Salt Sugar]" {
		t.Errorf("ingredients = %v", names)
	}
	if !deleted["Salt"] || deleted["Sugar"] {
		t.Errorf("deleted ingredients = %v, want only Salt", deleted)
	}

	names = nil
	for _, r := range got.Recipes {
		names = append(names, r.Name)
		deleted[r.Name] = r.Deleted
		if r.Name == "Pancakes" && (len(r.Lines) != 2 || r.Lines[1].IngredientID != ingredientIDs[1] || r.Lines[1].Quantity != 0.5 || r.Servings != 4 || r.Notes != "Mix.") {
			t.Errorf("pancakes = %+v", r)
		}
	}
	sort.Strings(names)
	if fmt.Sprint(names) != "[Old Pancakes Toast]" {
		t.Errorf("recipes = %v", names)
	}
	if !deleted["Old"] || deleted["Toast"] {
		t.Errorf("deleted recipes = %v, want only Old", deleted)
	}
}

func TestSoftDelete(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	r := newRecipe("Pancakes", model.RecipeLine{IngredientID: newID(), Quantity: 1})
	mustPut(t, s, r, "creator")

	s.now = func() time.Time { return fixedNow.Add(time.Hour) }
	item := &model.Recipe{ID: r.ID}
	if err := s.SoftDelete(ctx, item, "deleter"); err != nil {
		t.Fatalf("SoftDelete() error = %v", err)
	}
	if !item.Deleted || item.Version != 2 || item.UpdatedBy != "deleter" || item.UpdatedAt != "2026-11-28T02:02:03.456Z" {
		t.Errorf("returned item = %+v", item)
	}
	var stored model.Recipe
	if err := s.Get(ctx, model.Key{PK: r.PK, SK: r.SK}, &stored); err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !stored.Deleted || stored.Version != 2 || stored.UpdatedBy != "deleter" || stored.Name != "Pancakes" || len(stored.Lines) != 1 {
		t.Errorf("stored = %+v", stored)
	}

	// Deleting again succeeds without a write.
	again := &model.Recipe{ID: r.ID}
	if err := s.SoftDelete(ctx, again, "someone"); err != nil {
		t.Fatalf("second SoftDelete() error = %v", err)
	}
	if err := s.Get(ctx, model.Key{PK: r.PK, SK: r.SK}, &stored); err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if stored.Version != 2 || stored.UpdatedBy != "deleter" {
		t.Errorf("second delete wrote: %+v", stored)
	}

	// Shown again with a put, it can be hidden again.
	stored.Deleted = false
	mustPut(t, s, &stored, "creator")
	if err := s.SoftDelete(ctx, &model.Recipe{ID: r.ID}, "deleter"); err != nil {
		t.Fatalf("third SoftDelete() error = %v", err)
	}
	if err := s.Get(ctx, model.Key{PK: r.PK, SK: r.SK}, &stored); err != nil || !stored.Deleted || stored.Version != 4 {
		t.Errorf("after hiding again = %+v, %v", stored, err)
	}
}

func TestSoftDeleteIngredient(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	i := newIngredient("Sugar")
	mustPut(t, s, i, "creator")
	item := &model.Ingredient{ID: i.ID}
	if err := s.SoftDelete(ctx, item, "deleter"); err != nil {
		t.Fatalf("SoftDelete() error = %v", err)
	}
	var stored model.Ingredient
	if err := s.Get(ctx, model.Key{PK: i.PK, SK: i.SK}, &stored); err != nil || !stored.Deleted || stored.Version != 2 || stored.Unit != "g" {
		t.Errorf("stored = %+v, %v", stored, err)
	}
}

func TestSoftDeleteMissing(t *testing.T) {
	s := newTestStore(t)
	for _, item := range []Deletable{&model.Recipe{ID: newID()}, &model.Ingredient{ID: newID()}} {
		if err := s.SoftDelete(context.Background(), item, "c"); !errors.Is(err, ErrNotFound) {
			t.Errorf("SoftDelete(%T) of a missing item error = %v, want ErrNotFound", item, err)
		}
	}
}

func TestSoftDeleteRacingAnUpdate(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	r := newRecipe("Pancakes")
	mustPut(t, s, r, "creator")

	// Another writer renames the recipe between the delete's get and put.
	var attempts []int
	s.beforeSoftDeletePut = func(attempt int) {
		attempts = append(attempts, attempt)
		if attempt == 0 {
			var cur model.Recipe
			if err := s.Get(ctx, model.Key{PK: r.PK, SK: r.SK}, &cur); err != nil {
				t.Fatalf("Get() error = %v", err)
			}
			cur.Name = "Crêpes"
			mustPut(t, s, &cur, "editor")
		}
	}
	if err := s.SoftDelete(ctx, &model.Recipe{ID: r.ID}, "deleter"); err != nil {
		t.Fatalf("SoftDelete() error = %v", err)
	}
	if fmt.Sprint(attempts) != "[0 1]" {
		t.Errorf("attempts = %v, want [0 1]", attempts)
	}
	var stored model.Recipe
	if err := s.Get(ctx, model.Key{PK: r.PK, SK: r.SK}, &stored); err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !stored.Deleted || stored.Name != "Crêpes" || stored.Version != 3 || stored.UpdatedBy != "deleter" {
		t.Errorf("stored = %+v, want the rename kept, deleted at version 3", stored)
	}
}

func TestSoftDeleteRacingAHide(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	r := newRecipe("Pancakes")
	mustPut(t, s, r, "creator")
	// Another writer hides it first: the retry sees it hidden and stops.
	s.beforeSoftDeletePut = func(attempt int) {
		if attempt == 0 {
			s.beforeSoftDeletePut = nil // the inner delete runs without the race
			if err := s.SoftDelete(ctx, &model.Recipe{ID: r.ID}, "other"); err != nil {
				t.Fatalf("inner SoftDelete() error = %v", err)
			}
		}
	}
	if err := s.SoftDelete(ctx, &model.Recipe{ID: r.ID}, "deleter"); err != nil {
		t.Fatalf("SoftDelete() error = %v", err)
	}
	var stored model.Recipe
	if err := s.Get(ctx, model.Key{PK: r.PK, SK: r.SK}, &stored); err != nil || stored.Version != 2 || stored.UpdatedBy != "other" {
		t.Errorf("stored = %+v, %v", stored, err)
	}
}

func TestSoftDeleteRacingARemoval(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	r := newRecipe("Pancakes")
	mustPut(t, s, r, "creator")
	s.beforeSoftDeletePut = func(int) {
		if err := s.Delete(ctx, model.Key{PK: r.PK, SK: r.SK}); err != nil {
			t.Fatalf("Delete() error = %v", err)
		}
	}
	if err := s.SoftDelete(ctx, &model.Recipe{ID: r.ID}, "deleter"); !errors.Is(err, ErrNotFound) {
		t.Errorf("SoftDelete() error = %v, want ErrNotFound", err)
	}
}

func TestSoftDeleteGivesUp(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	r := newRecipe("Pancakes")
	mustPut(t, s, r, "creator")
	// Every attempt loses to another writer.
	calls := 0
	s.beforeSoftDeletePut = func(int) {
		calls++
		var cur model.Recipe
		if err := s.Get(ctx, model.Key{PK: r.PK, SK: r.SK}, &cur); err != nil {
			t.Fatalf("Get() error = %v", err)
		}
		mustPut(t, s, &cur, "editor")
	}
	err := s.SoftDelete(ctx, &model.Recipe{ID: r.ID}, "deleter")
	if err == nil {
		t.Fatal("SoftDelete() succeeded, want an error after the retries")
	}
	var conflict *VersionConflictError
	if errors.As(err, &conflict) {
		t.Errorf("error = %v, want a plain error, not a version conflict", err)
	}
	if calls != maxSoftDeleteAttempts {
		t.Errorf("attempts = %d, want %d", calls, maxSoftDeleteAttempts)
	}
	var stored model.Recipe
	if err := s.Get(ctx, model.Key{PK: r.PK, SK: r.SK}, &stored); err != nil || stored.Deleted {
		t.Errorf("stored = %+v, %v; want not deleted", stored, err)
	}
}
