package model

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
)

var versioned = Versioned{Version: 3, UpdatedAt: "2026-01-02T03:04:05.000Z", UpdatedBy: "sub-1"}

// jsonRoundTrip marshals v, checks the JSON, and unmarshals it into a new
// value of the same type.
func jsonRoundTrip[T any](t *testing.T, v T, want string) T {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	if string(b) != want {
		t.Errorf("JSON =\n %s\nwant\n %s", b, want)
	}
	var got T
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	return got
}

func TestHolidayJSON(t *testing.T) {
	h := Holiday{ID: "h1", Name: "Summer", TimeZone: "Pacific/Auckland", StartDate: "2026-12-20", EndDate: "2027-01-05", Versioned: versioned}
	h.SetKeys()
	got := jsonRoundTrip(t, h,
		`{"id":"h1","name":"Summer","timeZone":"Pacific/Auckland","startDate":"2026-12-20","endDate":"2027-01-05","version":3,"updatedAt":"2026-01-02T03:04:05.000Z","updatedBy":"sub-1"}`)
	h.StorageKeys = StorageKeys{}
	if !reflect.DeepEqual(got, h) {
		t.Errorf("round trip = %+v, want %+v", got, h)
	}
}

func TestMemberJSON(t *testing.T) {
	m := Member{UserSub: "sub-2", Versioned: versioned}
	m.SetKeys("h1")
	got := jsonRoundTrip(t, m, `{"userSub":"sub-2","version":3,"updatedAt":"2026-01-02T03:04:05.000Z","updatedBy":"sub-1"}`)
	m.StorageKeys = StorageKeys{}
	m.GSI1PK, m.GSI1SK = "", ""
	if !reflect.DeepEqual(got, m) {
		t.Errorf("round trip = %+v, want %+v", got, m)
	}
}

func TestAttendeeJSON(t *testing.T) {
	a := Attendee{ID: "a1", Name: "Sam", Versioned: versioned}
	a.SetKeys("h1")
	got := jsonRoundTrip(t, a, `{"id":"a1","name":"Sam","version":3,"updatedAt":"2026-01-02T03:04:05.000Z","updatedBy":"sub-1"}`)
	a.StorageKeys = StorageKeys{}
	if !reflect.DeepEqual(got, a) {
		t.Errorf("round trip = %+v, want %+v", got, a)
	}
}

func TestInputJSON(t *testing.T) {
	hi := jsonRoundTrip(t, HolidayInput{Name: "S", TimeZone: "UTC", StartDate: "2026-01-01", EndDate: "2026-01-02", Version: 2},
		`{"name":"S","timeZone":"UTC","startDate":"2026-01-01","endDate":"2026-01-02","version":2}`)
	if hi.Version != 2 || hi.Name != "S" {
		t.Errorf("HolidayInput round trip = %+v", hi)
	}
	ai := jsonRoundTrip(t, AttendeeInput{Name: "Sam", Version: 0}, `{"name":"Sam","version":0}`)
	if ai.Name != "Sam" {
		t.Errorf("AttendeeInput round trip = %+v", ai)
	}
	mi := jsonRoundTrip(t, MemberInput{Version: 0}, `{"version":0}`)
	if mi.Version != 0 {
		t.Errorf("MemberInput round trip = %+v", mi)
	}
}

func TestHolidayFactsJSONEmptyArrays(t *testing.T) {
	f := HolidayFacts{Holiday: Holiday{ID: "h1"}}
	b, err := json.Marshal(f)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	for _, field := range []string{`"attendees":[]`, `"meals":[]`, `"trips":[]`, `"stockChanges":[]`, `"members":[]`} {
		if !strings.Contains(string(b), field) {
			t.Errorf("JSON %s lacks %s", b, field)
		}
	}
	if strings.Contains(string(b), "PK") {
		t.Errorf("JSON %s contains storage keys", b)
	}
	var got HolidayFacts
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if got.Holiday.ID != "h1" {
		t.Errorf("Holiday.ID = %q, want h1", got.Holiday.ID)
	}
}

func TestHolidayFactsJSONWithItems(t *testing.T) {
	f := HolidayFacts{
		Holiday:   Holiday{ID: "h1"},
		Attendees: []Attendee{{ID: "a1", Name: "Sam"}},
		Members:   []Member{{UserSub: "s1"}},
	}
	b, err := json.Marshal(f)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	var got HolidayFacts
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if len(got.Attendees) != 1 || got.Attendees[0].Name != "Sam" || len(got.Members) != 1 || got.Members[0].UserSub != "s1" {
		t.Errorf("round trip = %+v", got)
	}
}

func TestDynamoDBAttributes(t *testing.T) {
	m := Member{UserSub: "sub-2", Versioned: versioned}
	m.SetKeys("h1")
	av, err := attributevalue.MarshalMap(m)
	if err != nil {
		t.Fatalf("MarshalMap() error = %v", err)
	}
	want := map[string]string{
		"PK": "HOLIDAY#h1", "SK": "MEMBER#sub-2", "type": "member",
		"GSI1PK": "USER#sub-2", "GSI1SK": "HOLIDAY#h1",
		"userSub": "sub-2", "updatedAt": "2026-01-02T03:04:05.000Z", "updatedBy": "sub-1",
	}
	for k, v := range want {
		var got string
		if err := attributevalue.Unmarshal(av[k], &got); err != nil || got != v {
			t.Errorf("attribute %s = %q (%v), want %q", k, got, err, v)
		}
	}
	if _, ok := av["version"]; !ok {
		t.Errorf("no version attribute in %v", av)
	}
	var back Member
	if err := attributevalue.UnmarshalMap(av, &back); err != nil {
		t.Fatalf("UnmarshalMap() error = %v", err)
	}
	if !reflect.DeepEqual(back, m) {
		t.Errorf("DynamoDB round trip = %+v, want %+v", back, m)
	}

	a := Attendee{ID: "a1", Name: "Sam"}
	a.SetKeys("h1")
	av, err = attributevalue.MarshalMap(a)
	if err != nil {
		t.Fatalf("MarshalMap() error = %v", err)
	}
	if _, ok := av["GSI1PK"]; ok {
		t.Errorf("attendee has GSI1PK")
	}
	if a.SK != "ATTENDEE#a1" || a.Type != "attendee" {
		t.Errorf("attendee keys = %+v", a.StorageKeys)
	}

	h := Holiday{ID: "h1"}
	h.SetKeys()
	if h.PK != "HOLIDAY#h1" || h.SK != "META" || h.Type != "holiday" {
		t.Errorf("holiday keys = %+v", h.StorageKeys)
	}
}

func TestIngredientJSON(t *testing.T) {
	i := Ingredient{ID: "i1", Name: "Sugar", Unit: "g", ShopSection: ShopSectionPantry, Deleted: true, Versioned: versioned}
	i.SetKeys()
	if i.PK != "CATALOGUE" || i.SK != "INGREDIENT#i1" || i.Type != "ingredient" {
		t.Errorf("ingredient keys = %+v", i.StorageKeys)
	}
	got := jsonRoundTrip(t, i,
		`{"id":"i1","name":"Sugar","unit":"g","shopSection":"pantry","deleted":true,"version":3,"updatedAt":"2026-01-02T03:04:05.000Z","updatedBy":"sub-1"}`)
	i.StorageKeys = StorageKeys{}
	if !reflect.DeepEqual(got, i) {
		t.Errorf("round trip = %+v, want %+v", got, i)
	}
}

func TestRecipeJSON(t *testing.T) {
	r := Recipe{ID: "r1", Name: "Pancakes", Servings: 4, Lines: []RecipeLine{{IngredientID: "i1", Quantity: 1.5}},
		Notes: "Mix.", Versioned: versioned}
	r.SetKeys()
	if r.PK != "CATALOGUE" || r.SK != "RECIPE#r1" || r.Type != "recipe" {
		t.Errorf("recipe keys = %+v", r.StorageKeys)
	}
	got := jsonRoundTrip(t, r,
		`{"id":"r1","name":"Pancakes","servings":4,"lines":[{"ingredientId":"i1","quantity":1.5}],"notes":"Mix.","deleted":false,"version":3,"updatedAt":"2026-01-02T03:04:05.000Z","updatedBy":"sub-1"}`)
	r.StorageKeys = StorageKeys{}
	if !reflect.DeepEqual(got, r) {
		t.Errorf("round trip = %+v, want %+v", got, r)
	}
	// A recipe with no lines writes an empty array, never null.
	empty := jsonRoundTrip(t, Recipe{ID: "r2"},
		`{"id":"r2","name":"","servings":0,"lines":[],"notes":"","deleted":false,"version":0,"updatedAt":"","updatedBy":""}`)
	if empty.ID != "r2" {
		t.Errorf("round trip = %+v", empty)
	}
	var p *Recipe = &r
	if b, _ := json.Marshal(p); !strings.Contains(string(b), `"lines":[{`) {
		t.Errorf("pointer JSON = %s", b)
	}
}

func TestRecipeDynamoDBRoundTrip(t *testing.T) {
	for _, r := range []Recipe{
		{ID: "r1", Name: "Pancakes", Servings: 2, Lines: []RecipeLine{{IngredientID: "i1", Quantity: 0.25}}, Deleted: true, Versioned: versioned},
		{ID: "r2", Name: "Nothing", Servings: 1, Versioned: versioned},
	} {
		r.SetKeys()
		av, err := attributevalue.MarshalMap(r)
		if err != nil {
			t.Fatalf("MarshalMap() error = %v", err)
		}
		for _, attr := range []string{"PK", "SK", "type", "id", "name", "servings", "lines", "notes", "deleted", "version"} {
			if _, ok := av[attr]; !ok {
				t.Errorf("%s: no %s attribute in %v", r.ID, attr, av)
			}
		}
		var back Recipe
		if err := attributevalue.UnmarshalMap(av, &back); err != nil {
			t.Fatalf("UnmarshalMap() error = %v", err)
		}
		if back.ID != r.ID || back.Deleted != r.Deleted || len(back.Lines) != len(r.Lines) || back.PK != "CATALOGUE" {
			t.Errorf("DynamoDB round trip = %+v, want %+v", back, r)
		}
	}
}

func TestCatalogueJSONEmptyArrays(t *testing.T) {
	b, err := json.Marshal(Catalogue{})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	if string(b) != `{"recipes":[],"ingredients":[]}` {
		t.Errorf("JSON = %s", b)
	}
	c := Catalogue{Recipes: []Recipe{{ID: "r1"}}, Ingredients: []Ingredient{{ID: "i1", ShopSection: ShopSectionOther}}}
	c.Recipes[0].SetKeys()
	b, err = json.Marshal(c)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	if strings.Contains(string(b), "PK") || !strings.Contains(string(b), `"lines":[]`) || !strings.Contains(string(b), `"shopSection":"other"`) {
		t.Errorf("JSON = %s", b)
	}
}

func TestCatalogueInputJSON(t *testing.T) {
	ri := jsonRoundTrip(t, RecipeInput{Name: "P", Servings: 2, Lines: []RecipeLine{{IngredientID: "i1", Quantity: 3}}, Notes: "n", Deleted: true, Version: 4},
		`{"name":"P","servings":2,"lines":[{"ingredientId":"i1","quantity":3}],"notes":"n","deleted":true,"version":4}`)
	if ri.Version != 4 || !ri.Deleted || len(ri.Lines) != 1 {
		t.Errorf("RecipeInput round trip = %+v", ri)
	}
	ii := jsonRoundTrip(t, IngredientInput{Name: "Milk", Unit: "l", ShopSection: ShopSectionDairy, Version: 0},
		`{"name":"Milk","unit":"l","shopSection":"dairy","deleted":false,"version":0}`)
	if ii.ShopSection != ShopSectionDairy {
		t.Errorf("IngredientInput round trip = %+v", ii)
	}
}

func TestShopSectionsOrder(t *testing.T) {
	want := []ShopSection{"produce", "bakery", "meat-fish", "dairy", "frozen", "pantry", "drinks", "household", "other"}
	if !reflect.DeepEqual(ShopSections, want) {
		t.Errorf("ShopSections = %v, want %v", ShopSections, want)
	}
}

func TestMealSlotsOrder(t *testing.T) {
	want := []MealSlot{"breakfast", "lunch", "dinner", "snacks", "other"}
	if !reflect.DeepEqual(MealSlots, want) {
		t.Errorf("MealSlots = %v, want %v", MealSlots, want)
	}
}

func TestMealJSON(t *testing.T) {
	recipe := "r1"
	m := Meal{ID: "m1", Name: "1 Jan Dinner", Slot: MealSlotDinner, RecipeID: &recipe,
		Mealtimes: []Mealtime{{ID: "t1", At: "2027-01-01T18:00", AttendeeIDs: []string{"a1", "a2"}}}, Versioned: versioned}
	m.SetKeys("h1")
	if m.PK != "HOLIDAY#h1" || m.SK != "MEAL#m1" || m.Type != "meal" {
		t.Errorf("meal keys = %+v", m.StorageKeys)
	}
	got := jsonRoundTrip(t, m,
		`{"id":"m1","name":"1 Jan Dinner","slot":"dinner","recipeId":"r1","mealtimes":[{"id":"t1","at":"2027-01-01T18:00","attendeeIds":["a1","a2"]}],"version":3,"updatedAt":"2026-01-02T03:04:05.000Z","updatedBy":"sub-1"}`)
	m.StorageKeys = StorageKeys{}
	if !reflect.DeepEqual(got, m) {
		t.Errorf("round trip = %+v, want %+v", got, m)
	}

	// No recipe is written as null, and no attendees as an empty array.
	none := Meal{ID: "m2", Name: "Snacks", Slot: MealSlotSnacks, Mealtimes: []Mealtime{{ID: "t2", At: "2027-01-02T15:00"}}}
	got = jsonRoundTrip(t, none,
		`{"id":"m2","name":"Snacks","slot":"snacks","recipeId":null,"mealtimes":[{"id":"t2","at":"2027-01-02T15:00","attendeeIds":[]}],"version":0,"updatedAt":"","updatedBy":""}`)
	if got.RecipeID != nil || got.Mealtimes[0].AttendeeIDs == nil {
		t.Errorf("round trip = %+v", got)
	}
	var p = &none
	if b, _ := json.Marshal(p); !strings.Contains(string(b), `"attendeeIds":[]`) || !strings.Contains(string(b), `"recipeId":null`) {
		t.Errorf("pointer JSON = %s", b)
	}
}

func TestMealDynamoDBRoundTrip(t *testing.T) {
	recipe := "r1"
	for _, m := range []Meal{
		{ID: "m1", Name: "Dinner", Slot: MealSlotDinner, RecipeID: &recipe,
			Mealtimes: []Mealtime{{ID: "t1", At: "2027-01-01T18:00", AttendeeIDs: []string{"a1"}}}, Versioned: versioned},
		{ID: "m2", Name: "Lunch", Slot: MealSlotLunch,
			Mealtimes: []Mealtime{{ID: "t2", At: "2027-01-01T12:00", AttendeeIDs: []string{}}}, Versioned: versioned},
	} {
		m.SetKeys("h1")
		av, err := attributevalue.MarshalMap(m)
		if err != nil {
			t.Fatalf("MarshalMap() error = %v", err)
		}
		for _, attr := range []string{"PK", "SK", "type", "id", "name", "slot", "recipeId", "mealtimes", "version"} {
			if _, ok := av[attr]; !ok {
				t.Errorf("%s: no %s attribute in %v", m.ID, attr, av)
			}
		}
		var back Meal
		if err := attributevalue.UnmarshalMap(av, &back); err != nil {
			t.Fatalf("UnmarshalMap() error = %v", err)
		}
		if (back.RecipeID == nil) != (m.RecipeID == nil) || (back.RecipeID != nil && *back.RecipeID != recipe) {
			t.Errorf("%s: recipeId = %v, want %v", m.ID, back.RecipeID, m.RecipeID)
		}
		if back.SK != "MEAL#"+m.ID || len(back.Mealtimes) != 1 || back.Mealtimes[0].At != m.Mealtimes[0].At {
			t.Errorf("DynamoDB round trip = %+v, want %+v", back, m)
		}
	}
}

func TestMealInputJSON(t *testing.T) {
	var in MealInput
	if err := json.Unmarshal([]byte(`{"name":"D","slot":"dinner","recipeId":null,"mealtimes":[{"id":"t1","at":"2027-01-01T18:00","attendeeIds":["a1"]}],"version":2}`), &in); err != nil {
		t.Fatalf("Unmarshal() error = %v", err)
	}
	if in.Name != "D" || in.Slot != MealSlotDinner || in.RecipeID != nil || len(in.Mealtimes) != 1 || in.Version != 2 {
		t.Errorf("MealInput = %+v", in)
	}
	if err := json.Unmarshal([]byte(`{"recipeId":"r1"}`), &in); err != nil || in.RecipeID == nil || *in.RecipeID != "r1" {
		t.Errorf("MealInput recipeId = %v (%v)", in.RecipeID, err)
	}
}

func TestHolidayFactsJSONWithMeals(t *testing.T) {
	f := HolidayFacts{Holiday: Holiday{ID: "h1"}, Meals: []Meal{{ID: "m1", Slot: MealSlotOther, Mealtimes: []Mealtime{{ID: "t1"}}}}}
	b, err := json.Marshal(f)
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	if !strings.Contains(string(b), `"meals":[{"id":"m1","name":"","slot":"other","recipeId":null,"mealtimes":[{"id":"t1","at":"","attendeeIds":[]}]`) {
		t.Errorf("JSON = %s", b)
	}
	var got HolidayFacts
	if err := json.Unmarshal(b, &got); err != nil || len(got.Meals) != 1 || got.Meals[0].ID != "m1" {
		t.Errorf("round trip = %+v (%v)", got, err)
	}
}
