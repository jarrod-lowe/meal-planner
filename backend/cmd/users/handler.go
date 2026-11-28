package main

import (
	"cmp"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-sdk-go-v2/aws"
	cip "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"

	"github.com/jarrod-lowe/meal-planner/backend/internal/auth"
	"github.com/jarrod-lowe/meal-planner/backend/internal/httpx"
)

// User is one entry of GET /users. It never includes an email address.
type User struct {
	Sub  string `json:"sub"`
	Name string `json:"name"`
}

type handler struct {
	cognito    cip.ListUsersAPIClient
	userPoolID string
	log        *slog.Logger
	now        func() time.Time
}

func newHandler(c cip.ListUsersAPIClient, userPoolID string, log *slog.Logger) *handler {
	return &handler{cognito: c, userPoolID: userPoolID, log: log, now: time.Now}
}

// handle serves GET /users, and logs one line per request.
func (h *handler) handle(ctx context.Context, req events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	start := h.now()
	route := req.HTTPMethod + " " + req.Resource
	caller, cerr := auth.CallerFromRequest(req)

	var res httpx.Response
	var err error
	switch {
	case cerr != nil:
		res = httpx.Error(http.StatusUnauthorized, "unauthorized", "the request has no signed-in user")
	case route != "GET /users":
		res = httpx.Error(http.StatusNotFound, "not-found", "no such route")
	default:
		var users []User
		if users, err = h.listUsers(ctx); err == nil {
			res, err = httpx.JSON(http.StatusOK, struct {
				Users []User `json:"users"`
			}{users})
		}
		if err != nil {
			res = httpx.Error(http.StatusInternalServerError, "internal", "something went wrong")
		}
	}

	attrs := []any{
		"route", route,
		"sub", caller.Sub,
		"status", res.StatusCode,
		"durationMs", h.now().Sub(start).Milliseconds(),
	}
	if err != nil {
		attrs = append(attrs, "error", err.Error())
		h.log.ErrorContext(ctx, "request", attrs...)
	} else {
		h.log.InfoContext(ctx, "request", attrs...)
	}
	return httpx.Proxy(res), nil
}

// listUsers returns every user in the pool, sorted by name. The name falls
// back to the email's local part, then the sub.
func (h *handler) listUsers(ctx context.Context) ([]User, error) {
	users := []User{}
	p := cip.NewListUsersPaginator(h.cognito, &cip.ListUsersInput{
		UserPoolId:      aws.String(h.userPoolID),
		AttributesToGet: []string{"sub", "name", "email"},
	})
	for p.HasMorePages() {
		out, err := p.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("listing users: %w", err)
		}
		for _, u := range out.Users {
			attrs := map[string]string{}
			for _, a := range u.Attributes {
				attrs[aws.ToString(a.Name)] = aws.ToString(a.Value)
			}
			sub := attrs["sub"]
			if sub == "" {
				continue
			}
			name := strings.TrimSpace(attrs["name"])
			if name == "" {
				name = auth.EmailLocalPart(attrs["email"])
			}
			if name == "" {
				name = sub
			}
			users = append(users, User{Sub: sub, Name: name})
		}
	}
	slices.SortFunc(users, func(a, b User) int {
		return cmp.Or(cmp.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)), cmp.Compare(a.Sub, b.Sub))
	})
	return users, nil
}
