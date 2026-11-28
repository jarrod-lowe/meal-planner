// Package validate holds the Lambda's semantic checks (DESIGN §5.2). API
// Gateway enforces the schemas first; these repeat the field checks so the
// Lambda never trusts its input, and add the ones a schema can't express.
package validate

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
	"time"
	_ "time/tzdata" // provided.al2023 has no zoneinfo
	"unicode/utf8"

	"github.com/jarrod-lowe/meal-planner/backend/internal/model"
)

// Limits, in characters for text (DESIGN §5.2).
const (
	MaxNameLength  = 100
	MaxUnitLength  = 20
	MaxNotesLength = 10000
	MaxRecipeLines = 200
)

// Error is a validation failure. Its message is safe to return to the
// client in a 400 response.
type Error struct {
	Message string
}

func (e *Error) Error() string { return e.Message }

func errorf(format string, args ...any) error {
	return &Error{Message: fmt.Sprintf(format, args...)}
}

var (
	localDatePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	idPattern        = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
)

// Name checks a name is 1–100 characters and not only whitespace.
func Name(field, s string) error { return text(field, s, true, MaxNameLength) }

// text checks s is valid UTF-8 of at most limit characters, and, when
// required, not only whitespace.
func text(field, s string, required bool, limit int) error {
	if !utf8.ValidString(s) {
		return errorf("%s must be valid UTF-8", field)
	}
	if required && strings.TrimSpace(s) == "" {
		return errorf("%s is required", field)
	}
	if n := utf8.RuneCountInString(s); n > limit {
		return errorf("%s must be at most %d characters", field, limit)
	}
	return nil
}

// LocalDate checks s is a real calendar date written YYYY-MM-DD.
func LocalDate(field, s string) error {
	if !localDatePattern.MatchString(s) {
		return errorf("%s must be a date in the form YYYY-MM-DD", field)
	}
	if _, err := time.Parse(time.DateOnly, s); err != nil {
		return errorf("%s is not a real date", field)
	}
	return nil
}

// DateRange checks start is on or before end. Both must already be valid
// local dates, which sort lexically.
func DateRange(start, end string) error {
	if start > end {
		return errorf("startDate must be on or before endDate")
	}
	return nil
}

// TimeZone checks s is an IANA time zone name.
func TimeZone(field, s string) error {
	// LoadLocation treats "" as UTC and "Local" as the host's zone; neither
	// is a name the holiday should store.
	if s == "" || s == "Local" || strings.HasPrefix(s, "/") {
		return errorf("%s must be an IANA time zone name", field)
	}
	if _, err := time.LoadLocation(s); err != nil {
		return errorf("%s must be an IANA time zone name", field)
	}
	return nil
}

// ID checks s is a lowercase hyphenated UUID (any version).
func ID(field, s string) error {
	if !idPattern.MatchString(s) {
		return errorf("%s must be a lowercase UUID", field)
	}
	return nil
}

// Version checks a request's version is not negative.
func Version(v int) error {
	if v < 0 {
		return errorf("version must not be negative")
	}
	return nil
}

// HolidayInput checks the body of PUT /holidays/{holidayId}.
func HolidayInput(in model.HolidayInput) error {
	return first(
		Name("name", in.Name),
		TimeZone("timeZone", in.TimeZone),
		LocalDate("startDate", in.StartDate),
		LocalDate("endDate", in.EndDate),
		func() error {
			// Only meaningful once both dates are valid.
			if LocalDate("startDate", in.StartDate) != nil || LocalDate("endDate", in.EndDate) != nil {
				return nil
			}
			return DateRange(in.StartDate, in.EndDate)
		}(),
		Version(in.Version),
	)
}

// AttendeeInput checks the body of PUT /holidays/{holidayId}/attendees/{id}.
func AttendeeInput(in model.AttendeeInput) error {
	return first(Name("name", in.Name), Version(in.Version))
}

// MemberInput checks the body of PUT /holidays/{holidayId}/members/{userSub}.
// A member has nothing to update, so only a create (version 0) is valid.
func MemberInput(in model.MemberInput) error {
	if in.Version != 0 {
		return errorf("version must be 0: members can only be added")
	}
	return nil
}

// Positive checks a number is finite and greater than zero.
func Positive(field string, v float64) error {
	if math.IsNaN(v) || math.IsInf(v, 0) || v <= 0 {
		return errorf("%s must be greater than 0", field)
	}
	return nil
}

// ShopSection checks s is one of the fixed shop sections (DESIGN §2.1).
func ShopSection(field string, s model.ShopSection) error {
	if !slices.Contains(model.ShopSections, s) {
		return errorf("%s must be a known shop section", field)
	}
	return nil
}

// IngredientInput checks the body of PUT /catalogue/ingredients/{id}.
func IngredientInput(in model.IngredientInput) error {
	return first(
		Name("name", in.Name),
		text("unit", in.Unit, true, MaxUnitLength),
		ShopSection("shopSection", in.ShopSection),
		Version(in.Version),
	)
}

// RecipeInput checks the body of PUT /catalogue/recipes/{id}. A recipe may
// have no lines, and each ingredient may appear in only one line. Whether
// the ingredients exist isn't checked (DESIGN §5.2).
func RecipeInput(in model.RecipeInput) error {
	if err := first(
		Name("name", in.Name),
		Positive("servings", in.Servings),
		text("notes", in.Notes, false, MaxNotesLength),
		Version(in.Version),
	); err != nil {
		return err
	}
	if len(in.Lines) > MaxRecipeLines {
		return errorf("lines must have at most %d entries", MaxRecipeLines)
	}
	seen := make(map[string]bool, len(in.Lines))
	for i, line := range in.Lines {
		if err := first(
			ID(fmt.Sprintf("lines[%d].ingredientId", i), line.IngredientID),
			Positive(fmt.Sprintf("lines[%d].quantity", i), line.Quantity),
		); err != nil {
			return err
		}
		if seen[line.IngredientID] {
			return errorf("lines[%d] repeats an ingredient: each may appear in only one line", i)
		}
		seen[line.IngredientID] = true
	}
	return nil
}

func first(errs ...error) error {
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}
