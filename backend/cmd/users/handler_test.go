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
	"github.com/aws/aws-sdk-go-v2/aws"
	cip "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
	"github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider/types"
)

// fakeCognito serves ListUsers from fixed pages, chained by token.
type fakeCognito struct {
	pages  [][]types.UserType
	err    error
	inputs []*cip.ListUsersInput
}

func (f *fakeCognito) ListUsers(_ context.Context, in *cip.ListUsersInput, _ ...func(*cip.Options)) (*cip.ListUsersOutput, error) {
	f.inputs = append(f.inputs, in)
	if f.err != nil {
		return nil, f.err
	}
	page := 0
	if in.PaginationToken != nil {
		page = int(aws.ToString(in.PaginationToken)[0] - '0')
	}
	out := &cip.ListUsersOutput{Users: f.pages[page]}
	if page+1 < len(f.pages) {
		out.PaginationToken = aws.String(string(rune('0' + page + 1)))
	}
	return out, nil
}

func user(attrs ...string) types.UserType {
	u := types.UserType{Username: aws.String("username-" + attrs[1])}
	for i := 0; i < len(attrs); i += 2 {
		u.Attributes = append(u.Attributes, types.AttributeType{Name: aws.String(attrs[i]), Value: aws.String(attrs[i+1])})
	}
	return u
}

func event(sub string) events.APIGatewayProxyRequest {
	ev := events.APIGatewayProxyRequest{HTTPMethod: "GET", Resource: "/users"}
	if sub != "" {
		ev.RequestContext.Authorizer = map[string]any{"claims": map[string]any{"sub": sub}}
	}
	return ev
}

func run(t *testing.T, f *fakeCognito, ev events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, map[string]any) {
	t.Helper()
	var logs bytes.Buffer
	h := newHandler(f, "pool-1", slog.New(slog.NewJSONHandler(&logs, nil)))
	resp, err := h.handle(context.Background(), ev)
	if err != nil {
		t.Fatalf("handle() error = %v", err)
	}
	lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1:\n%s", len(lines), logs.String())
	}
	var line map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &line); err != nil {
		t.Fatalf("log line %q: %v", lines[0], err)
	}
	return resp, line
}

func TestListUsers(t *testing.T) {
	f := &fakeCognito{pages: [][]types.UserType{
		{
			user("sub", "s1", "name", "Zoe", "email", "zoe@example.com"),
			user("sub", "s2", "email", "bob.smith@example.com"),
		},
		{
			user("sub", "s3", "name", "  ", "email", "amy@example.com"),
		},
		{
			user("sub", "s4", "name", "Cat"),
			user("sub", "s5"),
		},
	}}
	resp, line := run(t, f, event("s1"))
	if resp.StatusCode != 200 || resp.Headers["Content-Type"] != "application/json" {
		t.Fatalf("response = %d %v %s", resp.StatusCode, resp.Headers, resp.Body)
	}
	want := `{"users":[{"sub":"s3","name":"amy"},{"sub":"s2","name":"bob.smith"},{"sub":"s4","name":"Cat"},{"sub":"s5","name":"s5"},{"sub":"s1","name":"Zoe"}]}`
	if resp.Body != want {
		t.Errorf("body =\n %s\nwant\n %s", resp.Body, want)
	}
	if strings.Contains(resp.Body, "@") {
		t.Errorf("body %s contains an email address", resp.Body)
	}
	if len(f.inputs) != 3 {
		t.Errorf("ListUsers called %d times, want 3", len(f.inputs))
	}
	for _, in := range f.inputs {
		if aws.ToString(in.UserPoolId) != "pool-1" {
			t.Errorf("UserPoolId = %q", aws.ToString(in.UserPoolId))
		}
	}
	if line["route"] != "GET /users" || line["sub"] != "s1" || line["status"] != float64(200) {
		t.Errorf("log line = %v", line)
	}
	if b, _ := json.Marshal(line); strings.Contains(string(b), "@") {
		t.Errorf("log line %s contains an email address", b)
	}
}

func TestListUsersEmpty(t *testing.T) {
	resp, _ := run(t, &fakeCognito{pages: [][]types.UserType{{}}}, event("s1"))
	if resp.StatusCode != 200 || resp.Body != `{"users":[]}` {
		t.Errorf("response = %d %s", resp.StatusCode, resp.Body)
	}
}

func TestListUsersSkipsUsersWithoutSub(t *testing.T) {
	resp, _ := run(t, &fakeCognito{pages: [][]types.UserType{{user("name", "Ghost")}}}, event("s1"))
	if resp.Body != `{"users":[]}` {
		t.Errorf("body = %s", resp.Body)
	}
}

func TestListUsersError(t *testing.T) {
	resp, line := run(t, &fakeCognito{err: errors.New("cognito exploded")}, event("s1"))
	if resp.StatusCode != 500 || !strings.Contains(resp.Body, `"code":"internal"`) || strings.Contains(resp.Body, "exploded") {
		t.Errorf("response = %d %s", resp.StatusCode, resp.Body)
	}
	if !strings.Contains(line["error"].(string), "exploded") {
		t.Errorf("log line = %v", line)
	}
}

func TestUnauthenticated(t *testing.T) {
	f := &fakeCognito{pages: [][]types.UserType{{}}}
	resp, _ := run(t, f, event(""))
	if resp.StatusCode != 401 || len(f.inputs) != 0 {
		t.Errorf("response = %d %s; %d ListUsers calls", resp.StatusCode, resp.Body, len(f.inputs))
	}
}

func TestUnknownRoute(t *testing.T) {
	ev := event("s1")
	ev.HTTPMethod = "POST"
	resp, _ := run(t, &fakeCognito{pages: [][]types.UserType{{}}}, ev)
	if resp.StatusCode != 404 {
		t.Errorf("response = %d %s", resp.StatusCode, resp.Body)
	}
}
