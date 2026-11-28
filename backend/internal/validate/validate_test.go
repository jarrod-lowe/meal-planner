package validate

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"testing"

	"github.com/jarrod-lowe/meal-planner/backend/internal/model"
)

func check(t *testing.T, err error, wantErr bool) {
	t.Helper()
	if wantErr {
		var verr *Error
		if !errors.As(err, &verr) {
			t.Fatalf("error = %v, want a *validate.Error", err)
		}
		if verr.Message == "" || verr.Error() != verr.Message {
			t.Errorf("error message = %q", verr.Message)
		}
		return
	}
	if err != nil {
		t.Fatalf("error = %v, want nil", err)
	}
}

func TestName(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		wantErr bool
	}{
		{name: "one character", in: "a"},
		{name: "100 characters", in: strings.Repeat("a", 100)},
		{name: "100 multi-byte characters", in: strings.Repeat("é", 100)},
		{name: "inner spaces", in: "Summer at the bach"},
		{name: "empty", in: "", wantErr: true},
		{name: "only whitespace", in: " \t ", wantErr: true},
		{name: "101 characters", in: strings.Repeat("a", 101), wantErr: true},
		{name: "101 multi-byte characters", in: strings.Repeat("é", 101), wantErr: true},
		{name: "invalid UTF-8", in: "\xff", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			check(t, Name("name", tt.in), tt.wantErr)
		})
	}
}

func TestLocalDate(t *testing.T) {
	tests := []struct {
		in      string
		wantErr bool
	}{
		{in: "2026-12-25"},
		{in: "2028-02-29"},
		{in: "0001-01-01"},
		{in: "2026-02-29", wantErr: true},
		{in: "2026-13-01", wantErr: true},
		{in: "2026-00-10", wantErr: true},
		{in: "2026-04-31", wantErr: true},
		{in: "2026-1-01", wantErr: true},
		{in: "26-01-01", wantErr: true},
		{in: "2026-01-01T00:00", wantErr: true},
		{in: " 2026-01-01", wantErr: true},
		{in: "", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			check(t, LocalDate("startDate", tt.in), tt.wantErr)
		})
	}
}

func TestDateRange(t *testing.T) {
	tests := []struct {
		name       string
		start, end string
		wantErr    bool
	}{
		{name: "same day", start: "2026-01-01", end: "2026-01-01"},
		{name: "ordered", start: "2026-12-31", end: "2027-01-01"},
		{name: "reversed", start: "2026-01-02", end: "2026-01-01", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			check(t, DateRange(tt.start, tt.end), tt.wantErr)
		})
	}
}

func TestTimeZone(t *testing.T) {
	tests := []struct {
		in      string
		wantErr bool
	}{
		{in: "Pacific/Auckland"},
		{in: "Australia/Sydney"},
		{in: "America/Argentina/Buenos_Aires"},
		{in: "UTC"},
		{in: "", wantErr: true},
		{in: "Local", wantErr: true},
		{in: "Pacific/Atlantis", wantErr: true},
		{in: "../etc/passwd", wantErr: true},
		{in: "/etc/localtime", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			check(t, TimeZone("timeZone", tt.in), tt.wantErr)
		})
	}
}

func TestID(t *testing.T) {
	tests := []struct {
		in      string
		wantErr bool
	}{
		{in: "01936b2e-7f1a-7c3d-8e4f-0123456789ab"},
		{in: "550e8400-e29b-41d4-a716-446655440000"},
		{in: "00000000-0000-0000-0000-000000000000"},
		{in: "01936B2E-7F1A-7C3D-8E4F-0123456789AB", wantErr: true},
		{in: "01936b2e7f1a7c3d8e4f0123456789ab", wantErr: true},
		{in: "01936b2e-7f1a-7c3d-8e4f-0123456789a", wantErr: true},
		{in: "01936b2e-7f1a-7c3d-8e4f-0123456789abc", wantErr: true},
		{in: "g1936b2e-7f1a-7c3d-8e4f-0123456789ab", wantErr: true},
		{in: "", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			check(t, ID("id", tt.in), tt.wantErr)
		})
	}
}

func TestVersion(t *testing.T) {
	check(t, Version(0), false)
	check(t, Version(7), false)
	check(t, Version(-1), true)
}

func TestHolidayInput(t *testing.T) {
	good := model.HolidayInput{Name: "Summer", TimeZone: "Pacific/Auckland", StartDate: "2026-12-20", EndDate: "2027-01-05", Version: 0}
	tests := []struct {
		name    string
		mutate  func(*model.HolidayInput)
		wantErr bool
	}{
		{name: "valid", mutate: func(*model.HolidayInput) {}},
		{name: "empty name", mutate: func(in *model.HolidayInput) { in.Name = "" }, wantErr: true},
		{name: "bad time zone", mutate: func(in *model.HolidayInput) { in.TimeZone = "Nowhere/Land" }, wantErr: true},
		{name: "bad start", mutate: func(in *model.HolidayInput) { in.StartDate = "2026-02-30" }, wantErr: true},
		{name: "bad end", mutate: func(in *model.HolidayInput) { in.EndDate = "x" }, wantErr: true},
		{name: "end before start", mutate: func(in *model.HolidayInput) { in.EndDate = "2026-12-19" }, wantErr: true},
		{name: "negative version", mutate: func(in *model.HolidayInput) { in.Version = -1 }, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := good
			tt.mutate(&in)
			check(t, HolidayInput(in), tt.wantErr)
		})
	}
}

func TestAttendeeInput(t *testing.T) {
	check(t, AttendeeInput(model.AttendeeInput{Name: "Sam", Version: 2}), false)
	check(t, AttendeeInput(model.AttendeeInput{Name: " ", Version: 2}), true)
	check(t, AttendeeInput(model.AttendeeInput{Name: "Sam", Version: -1}), true)
}

func TestMemberInput(t *testing.T) {
	check(t, MemberInput(model.MemberInput{Version: 0}), false)
	check(t, MemberInput(model.MemberInput{Version: 1}), true)
	check(t, MemberInput(model.MemberInput{Version: -1}), true)
}

const (
	ing1 = "01936b2e-7f1a-7c3d-8e4f-000000000001"
	ing2 = "01936b2e-7f1a-7c3d-8e4f-000000000002"
)

func TestIngredientInput(t *testing.T) {
	good := model.IngredientInput{Name: "Sugar", Unit: "g", ShopSection: model.ShopSectionPantry, Version: 0}
	tests := []struct {
		name    string
		mutate  func(*model.IngredientInput)
		wantErr bool
	}{
		{name: "valid", mutate: func(*model.IngredientInput) {}},
		{name: "deleted, at a version", mutate: func(in *model.IngredientInput) { in.Deleted, in.Version = true, 3 }},
		{name: "100-character name", mutate: func(in *model.IngredientInput) { in.Name = strings.Repeat("é", 100) }},
		{name: "101-character name", mutate: func(in *model.IngredientInput) { in.Name = strings.Repeat("é", 101) }, wantErr: true},
		{name: "empty name", mutate: func(in *model.IngredientInput) { in.Name = "" }, wantErr: true},
		{name: "blank name", mutate: func(in *model.IngredientInput) { in.Name = "  " }, wantErr: true},
		{name: "1-character unit", mutate: func(in *model.IngredientInput) { in.Unit = "l" }},
		{name: "20-character unit", mutate: func(in *model.IngredientInput) { in.Unit = strings.Repeat("ü", 20) }},
		{name: "21-character unit", mutate: func(in *model.IngredientInput) { in.Unit = strings.Repeat("ü", 21) }, wantErr: true},
		{name: "empty unit", mutate: func(in *model.IngredientInput) { in.Unit = "" }, wantErr: true},
		{name: "blank unit", mutate: func(in *model.IngredientInput) { in.Unit = " " }, wantErr: true},
		{name: "invalid UTF-8 unit", mutate: func(in *model.IngredientInput) { in.Unit = "\xff" }, wantErr: true},
		{name: "first shop section", mutate: func(in *model.IngredientInput) { in.ShopSection = "produce" }},
		{name: "last shop section", mutate: func(in *model.IngredientInput) { in.ShopSection = "other" }},
		{name: "unknown shop section", mutate: func(in *model.IngredientInput) { in.ShopSection = "garden" }, wantErr: true},
		{name: "wrong-case shop section", mutate: func(in *model.IngredientInput) { in.ShopSection = "Pantry" }, wantErr: true},
		{name: "empty shop section", mutate: func(in *model.IngredientInput) { in.ShopSection = "" }, wantErr: true},
		{name: "negative version", mutate: func(in *model.IngredientInput) { in.Version = -1 }, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := good
			tt.mutate(&in)
			check(t, IngredientInput(in), tt.wantErr)
		})
	}
}

func TestRecipeInput(t *testing.T) {
	good := func() model.RecipeInput {
		return model.RecipeInput{Name: "Pancakes", Servings: 4, Notes: "Mix.", Version: 0,
			Lines: []model.RecipeLine{{IngredientID: ing1, Quantity: 2}, {IngredientID: ing2, Quantity: 0.5}}}
	}
	lines := func(n int) []model.RecipeLine {
		out := make([]model.RecipeLine, n)
		for i := range out {
			out[i] = model.RecipeLine{IngredientID: fmt.Sprintf("01936b2e-7f1a-7c3d-8e4f-%012x", i+1), Quantity: 1}
		}
		return out
	}
	tests := []struct {
		name    string
		mutate  func(*model.RecipeInput)
		wantErr bool
	}{
		{name: "valid", mutate: func(*model.RecipeInput) {}},
		{name: "deleted, at a version", mutate: func(in *model.RecipeInput) { in.Deleted, in.Version = true, 5 }},
		{name: "no lines", mutate: func(in *model.RecipeInput) { in.Lines = nil }},
		{name: "empty lines", mutate: func(in *model.RecipeInput) { in.Lines = []model.RecipeLine{} }},
		{name: "200 lines", mutate: func(in *model.RecipeInput) { in.Lines = lines(200) }},
		{name: "201 lines", mutate: func(in *model.RecipeInput) { in.Lines = lines(201) }, wantErr: true},
		{name: "100-character name", mutate: func(in *model.RecipeInput) { in.Name = strings.Repeat("a", 100) }},
		{name: "101-character name", mutate: func(in *model.RecipeInput) { in.Name = strings.Repeat("a", 101) }, wantErr: true},
		{name: "empty name", mutate: func(in *model.RecipeInput) { in.Name = "" }, wantErr: true},
		{name: "blank name", mutate: func(in *model.RecipeInput) { in.Name = "\t" }, wantErr: true},
		{name: "empty notes", mutate: func(in *model.RecipeInput) { in.Notes = "" }},
		{name: "10,000-character notes", mutate: func(in *model.RecipeInput) { in.Notes = strings.Repeat("é", 10000) }},
		{name: "10,001-character notes", mutate: func(in *model.RecipeInput) { in.Notes = strings.Repeat("é", 10001) }, wantErr: true},
		{name: "invalid UTF-8 notes", mutate: func(in *model.RecipeInput) { in.Notes = "\xff" }, wantErr: true},
		{name: "fractional servings", mutate: func(in *model.RecipeInput) { in.Servings = 0.5 }},
		{name: "zero servings", mutate: func(in *model.RecipeInput) { in.Servings = 0 }, wantErr: true},
		{name: "negative servings", mutate: func(in *model.RecipeInput) { in.Servings = -1 }, wantErr: true},
		{name: "infinite servings", mutate: func(in *model.RecipeInput) { in.Servings = math.Inf(1) }, wantErr: true},
		{name: "NaN servings", mutate: func(in *model.RecipeInput) { in.Servings = math.NaN() }, wantErr: true},
		{name: "tiny quantity", mutate: func(in *model.RecipeInput) { in.Lines[0].Quantity = 0.001 }},
		{name: "zero quantity", mutate: func(in *model.RecipeInput) { in.Lines[1].Quantity = 0 }, wantErr: true},
		{name: "negative quantity", mutate: func(in *model.RecipeInput) { in.Lines[0].Quantity = -2 }, wantErr: true},
		{name: "infinite quantity", mutate: func(in *model.RecipeInput) { in.Lines[0].Quantity = math.Inf(1) }, wantErr: true},
		{name: "NaN quantity", mutate: func(in *model.RecipeInput) { in.Lines[0].Quantity = math.NaN() }, wantErr: true},
		{name: "bad ingredient ID", mutate: func(in *model.RecipeInput) { in.Lines[1].IngredientID = "sugar" }, wantErr: true},
		{name: "empty ingredient ID", mutate: func(in *model.RecipeInput) { in.Lines[0].IngredientID = "" }, wantErr: true},
		{name: "repeated ingredient", mutate: func(in *model.RecipeInput) { in.Lines[1].IngredientID = ing1 }, wantErr: true},
		{name: "negative version", mutate: func(in *model.RecipeInput) { in.Version = -1 }, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			in := good()
			tt.mutate(&in)
			check(t, RecipeInput(in), tt.wantErr)
		})
	}
}

func TestRecipeInputMessages(t *testing.T) {
	in := model.RecipeInput{Name: "P", Servings: 1, Lines: []model.RecipeLine{{IngredientID: ing1, Quantity: 1}, {IngredientID: ing1, Quantity: 2}}}
	err := RecipeInput(in)
	if err == nil || !strings.Contains(err.Error(), "lines[1]") {
		t.Errorf("error = %v, want it to name lines[1]", err)
	}
	in.Lines = []model.RecipeLine{{IngredientID: ing1, Quantity: 1}, {IngredientID: ing2, Quantity: 0}}
	if err := RecipeInput(in); err == nil || !strings.Contains(err.Error(), "lines[1].quantity") {
		t.Errorf("error = %v, want it to name lines[1].quantity", err)
	}
}
