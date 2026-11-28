package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/aws/aws-lambda-go/events"

	"github.com/jarrod-lowe/meal-planner/backend/internal/auth"
	"github.com/jarrod-lowe/meal-planner/backend/internal/httpx"
	"github.com/jarrod-lowe/meal-planner/backend/internal/model"
	"github.com/jarrod-lowe/meal-planner/backend/internal/store"
	"github.com/jarrod-lowe/meal-planner/backend/internal/validate"
)

// Errors the routes return, mapped to responses by respond.
var (
	errUnknownRoute = errors.New("unknown route")
	errNoCaller     = errors.New("no caller")
)

// Kinds accepted by DELETE /catalogue/{kind}/{id}.
const (
	kindRecipes     = "recipes"
	kindIngredients = "ingredients"
)

// The static resources API Gateway may route a delete to instead of
// /catalogue/{kind}/{id}, since it prefers static path segments.
const (
	recipeResource     = "/catalogue/recipes/{id}"
	ingredientResource = "/catalogue/ingredients/{id}"
)

type handler struct {
	store store.CatalogueStore
	log   *slog.Logger
	now   func() time.Time
}

func newHandler(s store.CatalogueStore, log *slog.Logger) *handler {
	return &handler{store: s, log: log, now: time.Now}
}

// call is one request, as the routes see it.
type call struct {
	req    events.APIGatewayProxyRequest
	caller auth.Caller
}

func (c call) param(name string) string { return c.req.PathParameters[name] }

type route func(ctx context.Context, c call) (httpx.Response, error)

// routes are open to every signed-in user: the catalogue is shared, with
// no membership check.
func (h *handler) routes() map[string]route {
	return map[string]route{
		"GET /catalogue":                h.getCatalogue,
		"PUT " + recipeResource:         h.putRecipe,
		"PUT " + ingredientResource:     h.putIngredient,
		"DELETE " + recipeResource:      h.deleteItem,
		"DELETE " + ingredientResource:  h.deleteItem,
		"DELETE /catalogue/{kind}/{id}": h.deleteItem,
	}
}

// handle serves one API Gateway proxy event, and logs one line for it.
func (h *handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	start := h.now()
	routeName := req.HTTPMethod + " " + req.Resource
	c := call{req: req}

	var res httpx.Response
	var err error
	if caller, cerr := auth.CallerFromRequest(req); cerr != nil {
		err = errNoCaller
	} else if r, ok := h.routes()[routeName]; !ok {
		err = errUnknownRoute
	} else {
		c.caller = caller
		res, err = r(ctx, c)
	}
	if err != nil {
		res = respond(err)
	}

	attrs := []any{
		"route", routeName,
		"id", c.param("id"),
		"sub", c.caller.Sub,
		"status", res.StatusCode,
		"durationMs", h.now().Sub(start).Milliseconds(),
	}
	if res.StatusCode >= 500 {
		attrs = append(attrs, "error", err.Error())
		h.log.ErrorContext(ctx, "request", attrs...)
	} else {
		h.log.InfoContext(ctx, "request", attrs...)
	}
	return httpx.Proxy(res), nil
}

// respond maps a route's error to an API error response (DESIGN §5.3).
func respond(err error) httpx.Response {
	var verr *validate.Error
	var conflict *store.VersionConflictError
	switch {
	case errors.As(err, &verr):
		return httpx.Error(http.StatusBadRequest, "validation", verr.Message)
	case errors.Is(err, errNoCaller):
		return httpx.Error(http.StatusUnauthorized, "unauthorized", "the request has no signed-in user")
	case errors.Is(err, store.ErrNotFound):
		return httpx.Error(http.StatusNotFound, "not-found", "the item doesn't exist")
	case errors.Is(err, errUnknownRoute):
		return httpx.Error(http.StatusNotFound, "not-found", "no such route")
	case errors.As(err, &conflict):
		// A nil Current (the item is gone) is written as null.
		res, merr := httpx.Conflict("version-conflict", "the item has changed since you read it", conflict.Current)
		if merr == nil {
			return res
		}
	case errors.Is(err, store.ErrAlreadyExists):
		return httpx.Error(http.StatusConflict, "already-exists", "an item with this ID already exists")
	}
	return httpx.Error(http.StatusInternalServerError, "internal", "something went wrong")
}

// decodeBody parses the request body into v, as a validation failure when
// it isn't the expected JSON.
func decodeBody(c call, v any) error {
	if err := json.Unmarshal([]byte(c.req.Body), v); err != nil {
		return &validate.Error{Message: "the request body isn't valid JSON for this route"}
	}
	return nil
}

func ok(v any) (httpx.Response, error) {
	return httpx.JSON(http.StatusOK, v)
}

func (h *handler) getCatalogue(ctx context.Context, _ call) (httpx.Response, error) {
	c, err := h.store.LoadCatalogue(ctx)
	if err != nil {
		return httpx.Response{}, err
	}
	return ok(c)
}

// put writes a catalogue item: version 0 creates, anything else updates.
func (h *handler) put(ctx context.Context, c call, item store.Deletable) (httpx.Response, error) {
	item.SetKeys()
	if err := h.store.Put(ctx, item, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	return ok(item)
}

func (h *handler) putRecipe(ctx context.Context, c call) (httpx.Response, error) {
	id := c.param("id")
	var in model.RecipeInput
	if err := first(validate.ID("id", id), decodeBody(c, &in)); err != nil {
		return httpx.Response{}, err
	}
	if err := validate.RecipeInput(in); err != nil {
		return httpx.Response{}, err
	}
	lines := in.Lines
	if lines == nil {
		lines = []model.RecipeLine{}
	}
	return h.put(ctx, c, &model.Recipe{
		ID: id, Name: in.Name, Servings: in.Servings, Lines: lines, Notes: in.Notes, Deleted: in.Deleted,
		Versioned: model.Versioned{Version: in.Version},
	})
}

func (h *handler) putIngredient(ctx context.Context, c call) (httpx.Response, error) {
	id := c.param("id")
	var in model.IngredientInput
	if err := first(validate.ID("id", id), decodeBody(c, &in)); err != nil {
		return httpx.Response{}, err
	}
	if err := validate.IngredientInput(in); err != nil {
		return httpx.Response{}, err
	}
	return h.put(ctx, c, &model.Ingredient{
		ID: id, Name: in.Name, Unit: in.Unit, ShopSection: in.ShopSection, Deleted: in.Deleted,
		Versioned: model.Versioned{Version: in.Version},
	})
}

// deleteItem serves DELETE /catalogue/{kind}/{id}, and the same delete
// routed to a recipe's or an ingredient's own resource, which has no
// {kind}. It hides the item (a soft delete).
func (h *handler) deleteItem(ctx context.Context, c call) (httpx.Response, error) {
	kind, id := c.param("kind"), c.param("id")
	switch c.req.Resource {
	case recipeResource:
		kind = kindRecipes
	case ingredientResource:
		kind = kindIngredients
	}
	var item store.Deletable
	switch kind {
	case kindRecipes:
		item = &model.Recipe{ID: id}
	case kindIngredients:
		item = &model.Ingredient{ID: id}
	default:
		return httpx.Response{}, &validate.Error{Message: "kind must be recipes or ingredients"}
	}
	if err := validate.ID("id", id); err != nil {
		return httpx.Response{}, err
	}
	if err := h.store.SoftDelete(ctx, item, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	return httpx.NoContent(), nil
}

func first(errs ...error) error {
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}
