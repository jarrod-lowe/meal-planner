// Package auth reads the caller from the Cognito authoriser's claims in an
// API Gateway proxy event. The client sends the ID token, so the claims
// include `name` and `email`.
package auth

import (
	"errors"
	"strings"

	"github.com/aws/aws-lambda-go/events"
)

// ErrNoCaller means the event has no usable `sub` claim.
var ErrNoCaller = errors.New("no sub claim in the request's authoriser context")

// Caller is the signed-in user making a request.
type Caller struct {
	Sub  string
	Name string
}

// CallerFromRequest returns the caller from the authoriser's claims. The
// name falls back to the email's local part, then to the sub.
func CallerFromRequest(req events.APIGatewayProxyRequest) (Caller, error) {
	claims, ok := req.RequestContext.Authorizer["claims"].(map[string]any)
	if !ok {
		return Caller{}, ErrNoCaller
	}
	sub, _ := claims["sub"].(string)
	if sub == "" {
		return Caller{}, ErrNoCaller
	}
	name, _ := claims["name"].(string)
	name = strings.TrimSpace(name)
	if name == "" {
		email, _ := claims["email"].(string)
		name = EmailLocalPart(email)
	}
	if name == "" {
		name = sub
	}
	return Caller{Sub: sub, Name: name}, nil
}

// EmailLocalPart returns the part of an email address before the `@`.
func EmailLocalPart(email string) string {
	local, _, _ := strings.Cut(email, "@")
	return local
}
