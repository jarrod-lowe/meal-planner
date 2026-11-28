package main

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
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
	errNotMember    = errors.New("not a member")
	errLastMember   = errors.New("last member")
	errUnknownRoute = errors.New("unknown route")
	errNoCaller     = errors.New("no caller")
)

// Kinds accepted by DELETE /holidays/{holidayId}/{kind}/{id}, and the sort-key
// prefix of each. Later phases add trips and stock-changes.
var kindPrefixes = map[string]string{
	"attendees": model.AttendeePrefix,
	"meals":     model.MealPrefix,
}

// Static resources that DELETE may also arrive on, and the kind each means.
var staticDeleteKinds = map[string]string{
	"/holidays/{holidayId}/attendees/{id}": "attendees",
	"/holidays/{holidayId}/meals/{id}":     "meals",
}

type handler struct {
	store store.Store
	log   *slog.Logger
	now   func() time.Time
}

func newHandler(s store.Store, log *slog.Logger) *handler {
	return &handler{store: s, log: log, now: time.Now}
}

// call is one request, as the routes see it.
type call struct {
	req    events.APIGatewayProxyRequest
	caller auth.Caller
}

func (c call) param(name string) string { return c.req.PathParameters[name] }

type route func(ctx context.Context, c call) (httpx.Response, error)

func (h *handler) routes() map[string]route {
	return map[string]route{
		"GET /holidays":                                  h.listHolidays,
		"PUT /holidays/{holidayId}":                      h.putHoliday,
		"GET /holidays/{holidayId}":                      h.getHoliday,
		"DELETE /holidays/{holidayId}":                   h.deleteHoliday,
		"PUT /holidays/{holidayId}/members/{userSub}":    h.putMember,
		"DELETE /holidays/{holidayId}/members/{userSub}": h.deleteMember,
		"PUT /holidays/{holidayId}/attendees/{id}":       h.putAttendee,
		"DELETE /holidays/{holidayId}/attendees/{id}":    h.deleteItem,
		"PUT /holidays/{holidayId}/meals/{id}":           h.putMeal,
		"DELETE /holidays/{holidayId}/meals/{id}":        h.deleteItem,
		"DELETE /holidays/{holidayId}/{kind}/{id}":       h.deleteItem,
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
		"holidayId", c.param("holidayId"),
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
	case errors.Is(err, errNotMember):
		return httpx.Error(http.StatusForbidden, "not-a-member", "you aren't a member of this holiday")
	case errors.Is(err, store.ErrNotFound):
		return httpx.Error(http.StatusNotFound, "not-found", "the holiday doesn't exist")
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
	case errors.Is(err, errLastMember):
		return httpx.Error(http.StatusConflict, "last-member", "a holiday must keep at least one member")
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

// requireMember checks the caller is a member of the holiday: a missing
// member item is 404 when the holiday is gone too, else 403.
func (h *handler) requireMember(ctx context.Context, holidayID, sub string) error {
	ok, err := h.store.IsMember(ctx, holidayID, sub)
	if err != nil || ok {
		return err
	}
	if _, err := h.store.GetHoliday(ctx, holidayID); err != nil {
		return err
	}
	return errNotMember
}

func ok(v any) (httpx.Response, error) {
	return httpx.JSON(http.StatusOK, v)
}

func (h *handler) listHolidays(ctx context.Context, c call) (httpx.Response, error) {
	holidays, err := h.store.ListHolidays(ctx, c.caller.Sub)
	if err != nil {
		return httpx.Response{}, err
	}
	if holidays == nil {
		holidays = []model.Holiday{}
	}
	slices.SortFunc(holidays, func(a, b model.Holiday) int {
		return cmp.Or(cmp.Compare(a.StartDate, b.StartDate), cmp.Compare(a.Name, b.Name), cmp.Compare(a.ID, b.ID))
	})
	return ok(struct {
		Holidays []model.Holiday `json:"holidays"`
	}{holidays})
}

func (h *handler) putHoliday(ctx context.Context, c call) (httpx.Response, error) {
	id := c.param("holidayId")
	var in model.HolidayInput
	if err := first(validate.ID("holidayId", id), decodeBody(c, &in)); err != nil {
		return httpx.Response{}, err
	}
	if err := validate.HolidayInput(in); err != nil {
		return httpx.Response{}, err
	}
	holiday := &model.Holiday{
		ID: id, Name: in.Name, TimeZone: in.TimeZone, StartDate: in.StartDate, EndDate: in.EndDate,
		Versioned: model.Versioned{Version: in.Version},
	}
	if in.Version == 0 {
		// Creating needs no membership; the transaction's conditions reject
		// an existing holiday.
		if err := h.store.CreateHoliday(ctx, holiday, c.caller.Sub); err != nil {
			return httpx.Response{}, err
		}
		return ok(holiday)
	}
	if err := h.requireMember(ctx, id, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	holiday.SetKeys()
	if err := h.store.Put(ctx, holiday, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	return ok(holiday)
}

func (h *handler) getHoliday(ctx context.Context, c call) (httpx.Response, error) {
	id := c.param("holidayId")
	if err := validate.ID("holidayId", id); err != nil {
		return httpx.Response{}, err
	}
	if err := h.requireMember(ctx, id, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	facts, err := h.store.LoadHoliday(ctx, id)
	if err != nil {
		return httpx.Response{}, err
	}
	return ok(facts)
}

func (h *handler) deleteHoliday(ctx context.Context, c call) (httpx.Response, error) {
	id := c.param("holidayId")
	if err := validate.ID("holidayId", id); err != nil {
		return httpx.Response{}, err
	}
	if err := h.requireMember(ctx, id, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	if err := h.store.DeleteHoliday(ctx, id); err != nil {
		return httpx.Response{}, err
	}
	return httpx.NoContent(), nil
}

func (h *handler) putMember(ctx context.Context, c call) (httpx.Response, error) {
	id, sub := c.param("holidayId"), c.param("userSub")
	var in model.MemberInput
	if err := first(validate.ID("holidayId", id), validate.ID("userSub", sub), decodeBody(c, &in)); err != nil {
		return httpx.Response{}, err
	}
	if err := validate.MemberInput(in); err != nil {
		return httpx.Response{}, err
	}
	if err := h.requireMember(ctx, id, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	member := &model.Member{UserSub: sub}
	member.SetKeys(id)
	if err := h.store.Put(ctx, member, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	return ok(member)
}

func (h *handler) deleteMember(ctx context.Context, c call) (httpx.Response, error) {
	id, sub := c.param("holidayId"), c.param("userSub")
	if err := first(validate.ID("holidayId", id), validate.ID("userSub", sub)); err != nil {
		return httpx.Response{}, err
	}
	if err := h.requireMember(ctx, id, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	isMember, err := h.store.IsMember(ctx, id, sub)
	if err != nil {
		return httpx.Response{}, err
	}
	if !isMember {
		return httpx.NoContent(), nil // already gone
	}
	// Count, then delete: two members removing each other at once could
	// both pass, which is accepted at this scale.
	n, err := h.store.CountMembers(ctx, id)
	if err != nil {
		return httpx.Response{}, err
	}
	if n <= 1 {
		return httpx.Response{}, errLastMember
	}
	if err := h.store.Delete(ctx, model.Key{PK: model.HolidayPK(id), SK: model.MemberPrefix + sub}); err != nil {
		return httpx.Response{}, err
	}
	return httpx.NoContent(), nil
}

func (h *handler) putAttendee(ctx context.Context, c call) (httpx.Response, error) {
	holidayID, id := c.param("holidayId"), c.param("id")
	var in model.AttendeeInput
	if err := first(validate.ID("holidayId", holidayID), validate.ID("id", id), decodeBody(c, &in)); err != nil {
		return httpx.Response{}, err
	}
	if err := validate.AttendeeInput(in); err != nil {
		return httpx.Response{}, err
	}
	if err := h.requireMember(ctx, holidayID, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	attendee := &model.Attendee{ID: id, Name: in.Name, Versioned: model.Versioned{Version: in.Version}}
	attendee.SetKeys(holidayID)
	if err := h.store.Put(ctx, attendee, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	return ok(attendee)
}

// putMeal serves PUT /holidays/{holidayId}/meals/{id}. Mealtimes are stored
// sorted by `at`, then by ID so equal times have a fixed order.
func (h *handler) putMeal(ctx context.Context, c call) (httpx.Response, error) {
	holidayID, id := c.param("holidayId"), c.param("id")
	var in model.MealInput
	if err := first(validate.ID("holidayId", holidayID), validate.ID("id", id), decodeBody(c, &in)); err != nil {
		return httpx.Response{}, err
	}
	if err := validate.MealInput(in); err != nil {
		return httpx.Response{}, err
	}
	if err := h.requireMember(ctx, holidayID, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	mealtimes := slices.Clone(in.Mealtimes)
	for i := range mealtimes {
		if mealtimes[i].AttendeeIDs == nil {
			mealtimes[i].AttendeeIDs = []string{} // stored as an empty list, not NULL
		}
	}
	slices.SortFunc(mealtimes, func(a, b model.Mealtime) int {
		return cmp.Or(cmp.Compare(a.At, b.At), cmp.Compare(a.ID, b.ID))
	})
	meal := &model.Meal{ID: id, Name: in.Name, Slot: in.Slot, RecipeID: in.RecipeID, Mealtimes: mealtimes,
		Versioned: model.Versioned{Version: in.Version}}
	meal.SetKeys(holidayID)
	if err := h.store.Put(ctx, meal, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	return ok(meal)
}

// deleteItem serves DELETE /holidays/{holidayId}/{kind}/{id}. API Gateway
// may also route a delete to the item's own static resource, which has no
// {kind}.
func (h *handler) deleteItem(ctx context.Context, c call) (httpx.Response, error) {
	holidayID, kind, id := c.param("holidayId"), c.param("kind"), c.param("id")
	if k, ok := staticDeleteKinds[c.req.Resource]; ok {
		kind = k
	}
	prefix, ok := kindPrefixes[kind]
	if !ok {
		return httpx.Response{}, &validate.Error{Message: "kind must be attendees or meals"}
	}
	if err := first(validate.ID("holidayId", holidayID), validate.ID("id", id)); err != nil {
		return httpx.Response{}, err
	}
	if err := h.requireMember(ctx, holidayID, c.caller.Sub); err != nil {
		return httpx.Response{}, err
	}
	key := model.Key{PK: model.HolidayPK(holidayID), SK: prefix + id}
	if err := h.store.Delete(ctx, key); err != nil {
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
