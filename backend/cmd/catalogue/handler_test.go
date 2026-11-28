package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"

	"github.com/aws/aws-lambda-go/events"

	"github.com/jarrod-lowe/meal-planner/backend/internal/model"
)

const (
	me     = "11111111-1111-4111-8111-111111111111"
	friend = "22222222-2222-4222-8222-222222222222"

	sugar     = "01936b2e-7f1a-7c3d-8e4f-0000000000a1"
	flour     = "01936b2e-7f1a-7c3d-8e4f-0000000000a2"
	newIng    = "01936b2e-7f1a-7c3d-8e4f-0000000000a3"
	cake      = "01936b2e-7f1a-7c3d-8e4f-0000000000b1"
	oldRecipe = "01936b2e-7f1a-7c3d-8e4f-0000000000b2"
	newRecipe = "01936b2e-7f1a-7c3d-8e4f-0000000000b3"
	missing   = "01936b2e-7f1a-7c3d-8e4f-0000000000ff"
	badID     = "not-a-uuid"
)

const (
	validIngredient = `{"name":"Butter","unit":"g","shopSection":"dairy","deleted":false,"version":0}`
	validRecipe     = `{"name":"Scones","servings":8,"lines":[{"ingredientId":"` + flour + `","quantity":450},{"ingredientId":"` + newIng + `","quantity":0.5}],"notes":"Bake hot.","deleted":false,"version":0}`
)

type request struct {
	method   string
	resource string
	params   map[string]string
	body     string
	sub      string // empty: no claims
}

func (r request) event() events.APIGatewayProxyRequest {
	ev := events.APIGatewayProxyRequest{
		HTTPMethod:     r.method,
		Resource:       r.resource,
		PathParameters: r.params,
		Body:           r.body,
	}
	if r.sub != "" {
		ev.RequestContext.Authorizer = map[string]any{"claims": map[string]any{"sub": r.sub, "name": "Me", "email": "secret@example.com"}}
	}
	return ev
}

type result struct {
	status  int
	body    string
	errCode string
	log     map[string]any
}

func run(t *testing.T, f *fakeStore, r request) result {
	t.Helper()
	var logs bytes.Buffer
	h := newHandler(f, slog.New(slog.NewJSONHandler(&logs, nil)))
	h.now = fixedClock()
	resp, err := h.handle(context.Background(), r.event())
	if err != nil {
		t.Fatalf("handle() error = %v", err)
	}
	res := result{status: resp.StatusCode, body: resp.Body}
	if resp.StatusCode >= 400 {
		var e struct {
			Error struct{ Code, Message string } `json:"error"`
		}
		if err := json.Unmarshal([]byte(resp.Body), &e); err != nil {
			t.Fatalf("error body %q: %v", resp.Body, err)
		}
		if e.Error.Message == "" {
			t.Errorf("error body %s has no message", resp.Body)
		}
		res.errCode = e.Error.Code
	}
	if resp.StatusCode != 204 && resp.Headers["Content-Type"] != "application/json" {
		t.Errorf("Content-Type = %q", resp.Headers["Content-Type"])
	}
	if resp.StatusCode == 204 && resp.Body != "" {
		t.Errorf("204 with body %q", resp.Body)
	}
	lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1:\n%s", len(lines), logs.String())
	}
	if err := json.Unmarshal([]byte(lines[0]), &res.log); err != nil {
		t.Fatalf("log line %q isn't JSON: %v", lines[0], err)
	}
	return res
}

func decode[T any](t *testing.T, body string) T {
	t.Helper()
	var v T
	if err := json.Unmarshal([]byte(body), &v); err != nil {
		t.Fatalf("body %q: %v", body, err)
	}
	return v
}

// seeded returns a store with ingredients sugar (v2) and flour (v1), the
// recipe cake (v3) and the hidden recipe oldRecipe (v2).
func seeded() *fakeStore {
	f := newFakeStore()
	f.addIngredient(sugar, "Sugar", "g", 2)
	f.addIngredient(flour, "Flour", "kg", 1)
	f.addRecipe(cake, "Cake", 3, false, model.RecipeLine{IngredientID: sugar, Quantity: 200})
	f.addRecipe(oldRecipe, "Old", 2, true)
	return f
}

func idParam(id string) map[string]string { return map[string]string{"id": id} }

func kindParams(kind, id string) map[string]string { return map[string]string{"kind": kind, "id": id} }

// withField returns the JSON object body with one field replaced.
func withField(body, field, value string) string {
	var m map[string]any
	_ = json.Unmarshal([]byte(body), &m)
	var v any
	_ = json.Unmarshal([]byte(value), &v)
	m[field] = v
	b, _ := json.Marshal(m)
	return string(b)
}

func putRecipe(id, body string) request {
	return request{method: "PUT", resource: "/catalogue/recipes/{id}", params: idParam(id), body: body, sub: me}
}

func putIngredient(id, body string) request {
	return request{method: "PUT", resource: "/catalogue/ingredients/{id}", params: idParam(id), body: body, sub: me}
}

func TestGetCatalogue(t *testing.T) {
	res := run(t, seeded(), request{method: "GET", resource: "/catalogue", sub: friend})
	if res.status != 200 {
		t.Fatalf("status = %d, body %s", res.status, res.body)
	}
	got := decode[model.Catalogue](t, res.body)
	if len(got.Recipes) != 2 || len(got.Ingredients) != 2 {
		t.Fatalf("catalogue = %+v", got)
	}
	hidden := map[string]bool{}
	for _, r := range got.Recipes {
		hidden[r.Name] = r.Deleted
	}
	if !hidden["Old"] || hidden["Cake"] {
		t.Errorf("hidden = %v, want Old hidden and Cake shown", hidden)
	}
	for _, want := range []string{`"lines":[]`, `"shopSection":"pantry"`, `"quantity":200`} {
		if !strings.Contains(res.body, want) {
			t.Errorf("body %s lacks %s", res.body, want)
		}
	}
	if strings.Contains(res.body, "PK") || strings.Contains(res.body, "CATALOGUE") {
		t.Errorf("body %s has storage keys", res.body)
	}

	empty := run(t, newFakeStore(), request{method: "GET", resource: "/catalogue", sub: me})
	if empty.status != 200 || empty.body != `{"recipes":[],"ingredients":[]}` {
		t.Errorf("empty catalogue = %d %s", empty.status, empty.body)
	}
}

func TestPutIngredient(t *testing.T) {
	t.Run("create", func(t *testing.T) {
		f := seeded()
		res := run(t, f, putIngredient(newIng, validIngredient))
		if res.status != 200 {
			t.Fatalf("status = %d, body %s", res.status, res.body)
		}
		got := decode[model.Ingredient](t, res.body)
		if got.ID != newIng || got.Name != "Butter" || got.Unit != "g" || got.ShopSection != model.ShopSectionDairy || got.Version != 1 || got.UpdatedBy != me || got.Deleted {
			t.Errorf("ingredient = %+v", got)
		}
		stored, ok := f.getIngredient(newIng)
		if !ok || stored.Name != "Butter" || stored.Type != model.TypeIngredient {
			t.Errorf("stored = %+v", stored)
		}
		if strings.Contains(res.body, "PK") {
			t.Errorf("body %s has storage keys", res.body)
		}
	})
	t.Run("update", func(t *testing.T) {
		f := seeded()
		body := `{"name":"Caster sugar","unit":"kg","shopSection":"bakery","deleted":false,"version":2}`
		res := run(t, f, request{method: "PUT", resource: "/catalogue/ingredients/{id}", params: idParam(sugar), body: body, sub: friend})
		if res.status != 200 {
			t.Fatalf("status = %d, body %s", res.status, res.body)
		}
		got := decode[model.Ingredient](t, res.body)
		if got.Name != "Caster sugar" || got.Version != 3 || got.UpdatedBy != friend {
			t.Errorf("ingredient = %+v", got)
		}
		if stored, _ := f.getIngredient(sugar); stored.Unit != "kg" || stored.ShopSection != model.ShopSectionBakery {
			t.Errorf("stored = %+v", stored)
		}
	})
}

func TestPutRecipe(t *testing.T) {
	t.Run("create", func(t *testing.T) {
		f := seeded()
		res := run(t, f, putRecipe(newRecipe, validRecipe))
		if res.status != 200 {
			t.Fatalf("status = %d, body %s", res.status, res.body)
		}
		got := decode[model.Recipe](t, res.body)
		if got.ID != newRecipe || got.Name != "Scones" || got.Servings != 8 || got.Notes != "Bake hot." || got.Version != 1 || got.UpdatedBy != me {
			t.Errorf("recipe = %+v", got)
		}
		if len(got.Lines) != 2 || got.Lines[1].IngredientID != newIng || got.Lines[1].Quantity != 0.5 {
			t.Errorf("lines = %+v", got.Lines)
		}
		if stored, ok := f.getRecipe(newRecipe); !ok || stored.Type != model.TypeRecipe || len(stored.Lines) != 2 {
			t.Errorf("stored = %+v", stored)
		}
	})
	t.Run("create with no lines", func(t *testing.T) {
		res := run(t, seeded(), putRecipe(newRecipe, `{"name":"Toast","servings":1,"notes":"","deleted":false,"version":0}`))
		if res.status != 200 || !strings.Contains(res.body, `"lines":[]`) {
			t.Errorf("got %d %s, want 200 with empty lines", res.status, res.body)
		}
	})
	t.Run("update", func(t *testing.T) {
		f := seeded()
		res := run(t, f, putRecipe(cake, withField(validRecipe, "version", "3")))
		if res.status != 200 {
			t.Fatalf("status = %d, body %s", res.status, res.body)
		}
		if got := decode[model.Recipe](t, res.body); got.ID != cake || got.Name != "Scones" || got.Version != 4 {
			t.Errorf("recipe = %+v", got)
		}
	})
	t.Run("show a hidden recipe again", func(t *testing.T) {
		f := seeded()
		res := run(t, f, putRecipe(oldRecipe, withField(validRecipe, "version", "2")))
		if res.status != 200 {
			t.Fatalf("status = %d, body %s", res.status, res.body)
		}
		if stored, _ := f.getRecipe(oldRecipe); stored.Deleted || stored.Version != 3 {
			t.Errorf("stored = %+v, want shown at version 3", stored)
		}
	})
}

func TestDelete(t *testing.T) {
	tests := []struct {
		name string
		req  request
		id   string
		kind string
	}{
		{name: "recipe by kind", req: request{method: "DELETE", resource: "/catalogue/{kind}/{id}", params: kindParams("recipes", cake)}, id: cake, kind: "recipes"},
		{name: "recipe on its own resource", req: request{method: "DELETE", resource: "/catalogue/recipes/{id}", params: idParam(cake)}, id: cake, kind: "recipes"},
		{name: "ingredient by kind", req: request{method: "DELETE", resource: "/catalogue/{kind}/{id}", params: kindParams("ingredients", sugar)}, id: sugar, kind: "ingredients"},
		{name: "ingredient on its own resource", req: request{method: "DELETE", resource: "/catalogue/ingredients/{id}", params: idParam(sugar)}, id: sugar, kind: "ingredients"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := seeded()
			tt.req.sub = friend
			for i := range 2 { // deleting twice succeeds
				res := run(t, f, tt.req)
				if res.status != 204 {
					t.Fatalf("delete #%d: got %d %s, want 204", i+1, res.status, res.body)
				}
			}
			var deleted bool
			var v model.Versioned
			if tt.kind == "recipes" {
				r, _ := f.getRecipe(tt.id)
				deleted, v = r.Deleted, r.Versioned
				if r.Name != "Cake" {
					t.Errorf("stored = %+v", r)
				}
			} else {
				i, _ := f.getIngredient(tt.id)
				deleted, v = i.Deleted, i.Versioned
			}
			if !deleted || v.Version != 4-boolToInt(tt.kind == "ingredients") || v.UpdatedBy != friend {
				t.Errorf("stored deleted = %v, %+v", deleted, v)
			}
		})
	}
	t.Run("missing", func(t *testing.T) {
		for _, req := range []request{
			{method: "DELETE", resource: "/catalogue/{kind}/{id}", params: kindParams("recipes", missing), sub: me},
			{method: "DELETE", resource: "/catalogue/ingredients/{id}", params: idParam(missing), sub: me},
			// A recipe's ID isn't an ingredient's.
			{method: "DELETE", resource: "/catalogue/{kind}/{id}", params: kindParams("ingredients", cake), sub: me},
		} {
			res := run(t, seeded(), req)
			if res.status != 404 || res.errCode != "not-found" {
				t.Errorf("%s %v: got %d %s, want 404 not-found", req.resource, req.params, res.status, res.errCode)
			}
		}
	})
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func TestConflicts(t *testing.T) {
	tests := []struct {
		name        string
		req         request
		wantCode    string
		wantCurrent string // a substring of the `current` JSON, or "null"
	}{
		{name: "create an existing ingredient", req: putIngredient(sugar, validIngredient), wantCode: "already-exists"},
		{name: "create an existing recipe", req: putRecipe(cake, validRecipe), wantCode: "already-exists"},
		{name: "update an ingredient at a stale version", req: putIngredient(sugar, withField(validIngredient, "version", "1")),
			wantCode: "version-conflict", wantCurrent: `"name":"Sugar"`},
		{name: "update a recipe at a stale version", req: putRecipe(cake, withField(validRecipe, "version", "2")),
			wantCode: "version-conflict", wantCurrent: `"lines":[{"ingredientId":"` + sugar + `","quantity":200}]`},
		{name: "update a missing recipe", req: putRecipe(missing, withField(validRecipe, "version", "1")),
			wantCode: "version-conflict", wantCurrent: "null"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := run(t, seeded(), tt.req)
			if res.status != 409 || res.errCode != tt.wantCode {
				t.Fatalf("got %d %s, want 409 %s (body %s)", res.status, res.errCode, tt.wantCode, res.body)
			}
			body := decode[map[string]json.RawMessage](t, res.body)
			current, ok := body["current"]
			switch {
			case tt.wantCurrent == "" && ok:
				t.Errorf("body %s has current", res.body)
			case tt.wantCurrent == "null" && string(current) != "null":
				t.Errorf("current = %s, want null", current)
			case tt.wantCurrent != "" && !strings.Contains(string(current), tt.wantCurrent):
				t.Errorf("current = %s, want it to contain %s", current, tt.wantCurrent)
			}
			if strings.Contains(string(current), "PK") {
				t.Errorf("current %s has storage keys", current)
			}
		})
	}
}

func TestValidation(t *testing.T) {
	lines := func(n int) string {
		parts := make([]string, n)
		for i := range parts {
			parts[i] = `{"ingredientId":"01936b2e-7f1a-7c3d-8e4f-` + strings.Repeat("0", 8) + hex4(i) + `","quantity":1}`
		}
		return "[" + strings.Join(parts, ",") + "]"
	}
	tests := []struct {
		name string
		req  request
	}{
		{name: "ingredient: bad id", req: putIngredient(badID, validIngredient)},
		{name: "ingredient: not JSON", req: putIngredient(newIng, `{`)},
		{name: "ingredient: wrong JSON type", req: putIngredient(newIng, withField(validIngredient, "name", "7"))},
		{name: "ingredient: empty name", req: putIngredient(newIng, withField(validIngredient, "name", `""`))},
		{name: "ingredient: blank name", req: putIngredient(newIng, withField(validIngredient, "name", `"  "`))},
		{name: "ingredient: long name", req: putIngredient(newIng, withField(validIngredient, "name", `"`+strings.Repeat("é", 101)+`"`))},
		{name: "ingredient: empty unit", req: putIngredient(newIng, withField(validIngredient, "unit", `""`))},
		{name: "ingredient: long unit", req: putIngredient(newIng, withField(validIngredient, "unit", `"`+strings.Repeat("u", 21)+`"`))},
		{name: "ingredient: unknown shop section", req: putIngredient(newIng, withField(validIngredient, "shopSection", `"garden"`))},
		{name: "ingredient: negative version", req: putIngredient(newIng, withField(validIngredient, "version", "-1"))},
		{name: "recipe: bad id", req: putRecipe(badID, validRecipe)},
		{name: "recipe: not JSON", req: putRecipe(newRecipe, `[]`)},
		{name: "recipe: empty name", req: putRecipe(newRecipe, withField(validRecipe, "name", `""`))},
		{name: "recipe: long name", req: putRecipe(newRecipe, withField(validRecipe, "name", `"`+strings.Repeat("x", 101)+`"`))},
		{name: "recipe: zero servings", req: putRecipe(newRecipe, withField(validRecipe, "servings", "0"))},
		{name: "recipe: negative servings", req: putRecipe(newRecipe, withField(validRecipe, "servings", "-2"))},
		{name: "recipe: long notes", req: putRecipe(newRecipe, withField(validRecipe, "notes", `"`+strings.Repeat("n", 10001)+`"`))},
		{name: "recipe: 201 lines", req: putRecipe(newRecipe, withField(validRecipe, "lines", lines(201)))},
		{name: "recipe: zero quantity", req: putRecipe(newRecipe, withField(validRecipe, "lines", `[{"ingredientId":"`+sugar+`","quantity":0}]`))},
		{name: "recipe: bad ingredient id", req: putRecipe(newRecipe, withField(validRecipe, "lines", `[{"ingredientId":"sugar","quantity":1}]`))},
		{name: "recipe: repeated ingredient", req: putRecipe(newRecipe, withField(validRecipe, "lines",
			`[{"ingredientId":"`+sugar+`","quantity":1},{"ingredientId":"`+sugar+`","quantity":2}]`))},
		{name: "recipe: negative version", req: putRecipe(newRecipe, withField(validRecipe, "version", "-1"))},
		{name: "delete: unknown kind", req: request{method: "DELETE", resource: "/catalogue/{kind}/{id}", params: kindParams("meals", cake), sub: me}},
		{name: "delete: no kind", req: request{method: "DELETE", resource: "/catalogue/{kind}/{id}", params: idParam(cake), sub: me}},
		{name: "delete: bad id", req: request{method: "DELETE", resource: "/catalogue/{kind}/{id}", params: kindParams("recipes", badID), sub: me}},
		{name: "delete recipe: bad id", req: request{method: "DELETE", resource: "/catalogue/recipes/{id}", params: idParam(badID), sub: me}},
		{name: "delete ingredient: bad id", req: request{method: "DELETE", resource: "/catalogue/ingredients/{id}", params: idParam(badID), sub: me}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := seeded()
			res := run(t, f, tt.req)
			if res.status != 400 || res.errCode != "validation" {
				t.Errorf("got %d %s, want 400 validation (body %s)", res.status, res.errCode, res.body)
			}
			if f.calls["Put"]+f.calls["SoftDelete"] != 0 {
				t.Errorf("wrote to the store: %v", f.calls)
			}
		})
	}
	t.Run("200 lines is allowed", func(t *testing.T) {
		res := run(t, seeded(), putRecipe(newRecipe, withField(validRecipe, "lines", lines(200))))
		if res.status != 200 {
			t.Errorf("got %d %s, want 200", res.status, res.body)
		}
	})
}

func hex4(i int) string {
	const digits = "0123456789abcdef"
	return string([]byte{digits[i>>12&15], digits[i>>8&15], digits[i>>4&15], digits[i&15]})
}

func TestInternalErrors(t *testing.T) {
	routes := map[string]request{
		"get catalogue":     {method: "GET", resource: "/catalogue"},
		"put ingredient":    putIngredient(newIng, validIngredient),
		"put recipe":        putRecipe(newRecipe, validRecipe),
		"delete by kind":    {method: "DELETE", resource: "/catalogue/{kind}/{id}", params: kindParams("recipes", cake)},
		"delete recipe":     {method: "DELETE", resource: "/catalogue/recipes/{id}", params: idParam(cake)},
		"delete ingredient": {method: "DELETE", resource: "/catalogue/ingredients/{id}", params: idParam(sugar)},
	}
	secret := errors.New("dynamodb exploded: table meal-planner-test-data PK=CATALOGUE secret")
	for route, req := range routes {
		t.Run(route, func(t *testing.T) {
			f := seeded()
			f.err = secret
			req.sub = me
			res := run(t, f, req)
			if res.status != 500 || res.errCode != "internal" {
				t.Fatalf("got %d %s, want 500 internal", res.status, res.errCode)
			}
			if strings.Contains(res.body, "dynamodb") || strings.Contains(res.body, "secret") || strings.Contains(res.body, "CATALOGUE") {
				t.Errorf("body %s leaks the error", res.body)
			}
			if !strings.Contains(res.log["error"].(string), "exploded") || res.log["level"] != "ERROR" {
				t.Errorf("log %v lacks the error", res.log)
			}
		})
	}
}

func TestUnauthenticated(t *testing.T) {
	for _, req := range []request{
		{method: "GET", resource: "/catalogue"},
		putIngredient(newIng, validIngredient),
	} {
		req.sub = ""
		f := seeded()
		res := run(t, f, req)
		if res.status != 401 || res.errCode != "unauthorized" {
			t.Errorf("%s %s: got %d %s, want 401 unauthorized", req.method, req.resource, res.status, res.errCode)
		}
		if f.calls["Put"]+f.calls["LoadCatalogue"] != 0 {
			t.Errorf("used the store: %v", f.calls)
		}
	}
}

func TestUnknownRoute(t *testing.T) {
	for _, req := range []request{
		{method: "POST", resource: "/catalogue", sub: me},
		{method: "GET", resource: "/catalogue/recipes/{id}", params: idParam(cake), sub: me},
		{method: "GET", resource: "/holidays", sub: me},
	} {
		res := run(t, seeded(), req)
		if res.status != 404 || res.errCode != "not-found" {
			t.Errorf("%s %s: got %d %s, want 404 not-found", req.method, req.resource, res.status, res.errCode)
		}
	}
}

func TestLogLine(t *testing.T) {
	res := run(t, seeded(), putRecipe(newRecipe, withField(validRecipe, "notes", `"Very Private Notes"`)))
	want := map[string]any{
		"msg": "request", "level": "INFO", "route": "PUT /catalogue/recipes/{id}", "id": newRecipe,
		"sub": me, "status": float64(200), "durationMs": float64(5),
	}
	for k, v := range want {
		if res.log[k] != v {
			t.Errorf("log %s = %v, want %v", k, res.log[k], v)
		}
	}
	line, _ := json.Marshal(res.log)
	for _, leak := range []string{"Very Private Notes", "Scones", "secret@example.com"} {
		if strings.Contains(string(line), leak) {
			t.Errorf("log line %s contains %q", line, leak)
		}
	}
}
