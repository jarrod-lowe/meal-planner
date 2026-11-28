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
	me       = "11111111-1111-4111-8111-111111111111"
	friend   = "22222222-2222-4222-8222-222222222222"
	stranger = "33333333-3333-4333-8333-333333333333"

	hol      = "01936b2e-7f1a-7c3d-8e4f-000000000001"
	hol2     = "01936b2e-7f1a-7c3d-8e4f-000000000002"
	hol3     = "01936b2e-7f1a-7c3d-8e4f-000000000003"
	missing  = "01936b2e-7f1a-7c3d-8e4f-0000000000ff"
	att      = "01936b2e-7f1a-7c3d-8e4f-0000000000a1"
	newAtt   = "01936b2e-7f1a-7c3d-8e4f-0000000000a2"
	badID    = "not-a-uuid"
	holPK    = model.HolidayPrefix + hol
	meSK     = model.MemberPrefix + me
	friendSK = model.MemberPrefix + friend
	attSK    = model.AttendeePrefix + att
)

const validHoliday = `{"name":"Summer","timeZone":"Pacific/Auckland","startDate":"2026-12-20","endDate":"2027-01-05","version":0}`

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

// seeded returns a store with `hol` (members me and friend, one attendee),
// `hol2` (me only) and `hol3` (stranger only).
func seeded() *fakeStore {
	f := newFakeStore()
	f.addHoliday(hol, "Summer", "2026-12-20", "2027-01-05", me, friend)
	f.addAttendee(hol, att, "Sam", 2)
	f.addHoliday(hol2, "Autumn", "2026-04-01", "2026-04-05", me)
	f.addHoliday(hol3, "Winter", "2026-07-01", "2026-07-05", stranger)
	return f
}

func holidayParams(id string) map[string]string { return map[string]string{"holidayId": id} }

func TestSuccessPaths(t *testing.T) {
	tests := []struct {
		name       string
		req        request
		seed       func(*fakeStore)
		wantStatus int
		check      func(t *testing.T, f *fakeStore, body string)
	}{
		{
			name:       "list holidays, sorted by start date then name",
			req:        request{method: "GET", resource: "/holidays", sub: me},
			seed:       func(f *fakeStore) { f.addHoliday(missing, "Aardvark", "2026-12-20", "2026-12-21", me) },
			wantStatus: 200,
			check: func(t *testing.T, _ *fakeStore, body string) {
				got := decode[struct{ Holidays []model.Holiday }](t, body)
				var names []string
				for _, h := range got.Holidays {
					names = append(names, h.Name)
				}
				if strings.Join(names, ",") != "Autumn,Aardvark,Summer" {
					t.Errorf("holidays = %v, want Autumn, Aardvark, Summer", names)
				}
			},
		},
		{
			name:       "list holidays when there are none",
			req:        request{method: "GET", resource: "/holidays", sub: "44444444-4444-4444-8444-444444444444"},
			wantStatus: 200,
			check: func(t *testing.T, _ *fakeStore, body string) {
				if body != `{"holidays":[]}` {
					t.Errorf("body = %s, want an empty list", body)
				}
			},
		},
		{
			name:       "create a holiday",
			req:        request{method: "PUT", resource: "/holidays/{holidayId}", params: holidayParams(missing), body: validHoliday, sub: stranger},
			wantStatus: 200,
			check: func(t *testing.T, f *fakeStore, body string) {
				h := decode[model.Holiday](t, body)
				if h.ID != missing || h.Name != "Summer" || h.Version != 1 || h.UpdatedBy != stranger || h.TimeZone != "Pacific/Auckland" {
					t.Errorf("holiday = %+v", h)
				}
				if f.calls["IsMember"] != 0 {
					t.Errorf("create checked membership")
				}
				if !f.has(model.HolidayPK(missing), model.MemberPrefix+stranger) {
					t.Errorf("creator isn't a member")
				}
			},
		},
		{
			name: "update a holiday",
			req: request{method: "PUT", resource: "/holidays/{holidayId}", params: holidayParams(hol), sub: friend,
				body: `{"name":"Summer 2","timeZone":"Australia/Sydney","startDate":"2026-12-21","endDate":"2027-01-06","version":1}`},
			wantStatus: 200,
			check: func(t *testing.T, f *fakeStore, body string) {
				h := decode[model.Holiday](t, body)
				if h.ID != hol || h.Name != "Summer 2" || h.Version != 2 || h.UpdatedBy != friend || h.TimeZone != "Australia/Sydney" {
					t.Errorf("holiday = %+v", h)
				}
				stored, _ := f.GetHoliday(context.Background(), hol)
				if stored.Name != "Summer 2" || stored.StartDate != "2026-12-21" || stored.EndDate != "2027-01-06" {
					t.Errorf("stored = %+v", stored)
				}
			},
		},
		{
			name:       "get a holiday",
			req:        request{method: "GET", resource: "/holidays/{holidayId}", params: holidayParams(hol), sub: me},
			wantStatus: 200,
			check: func(t *testing.T, _ *fakeStore, body string) {
				for _, want := range []string{`"meals":[]`, `"trips":[]`, `"stockChanges":[]`, `"name":"Sam"`, `"userSub":"` + friend + `"`, `"holiday":{"id":"` + hol + `"`} {
					if !strings.Contains(body, want) {
						t.Errorf("body %s lacks %s", body, want)
					}
				}
				if strings.Contains(body, "PK") || strings.Contains(body, "GSI1") {
					t.Errorf("body %s has storage keys", body)
				}
			},
		},
		{
			name:       "delete a holiday",
			req:        request{method: "DELETE", resource: "/holidays/{holidayId}", params: holidayParams(hol), sub: me},
			wantStatus: 204,
			check: func(t *testing.T, f *fakeStore, body string) {
				if f.has(holPK, model.MetaSK) || f.has(holPK, attSK) || f.has(holPK, meSK) {
					t.Errorf("holiday items remain")
				}
				if body != "" {
					t.Errorf("body = %q, want none", body)
				}
			},
		},
		{
			name: "add a member",
			req: request{method: "PUT", resource: "/holidays/{holidayId}/members/{userSub}", sub: me, body: `{"version":0}`,
				params: map[string]string{"holidayId": hol, "userSub": stranger}},
			wantStatus: 200,
			check: func(t *testing.T, f *fakeStore, body string) {
				m := decode[model.Member](t, body)
				if m.UserSub != stranger || m.Version != 1 || m.UpdatedBy != me {
					t.Errorf("member = %+v", m)
				}
				var stored model.Member
				if !f.get(model.Key{PK: holPK, SK: model.MemberPrefix + stranger}, &stored) || stored.GSI1PK != model.UserPrefix+stranger || stored.GSI1SK != holPK {
					t.Errorf("stored member = %+v", stored)
				}
			},
		},
		{
			name: "remove another member",
			req: request{method: "DELETE", resource: "/holidays/{holidayId}/members/{userSub}", sub: me,
				params: map[string]string{"holidayId": hol, "userSub": friend}},
			wantStatus: 204,
			check: func(t *testing.T, f *fakeStore, _ string) {
				if f.has(holPK, friendSK) {
					t.Errorf("friend is still a member")
				}
			},
		},
		{
			name: "remove yourself",
			req: request{method: "DELETE", resource: "/holidays/{holidayId}/members/{userSub}", sub: me,
				params: map[string]string{"holidayId": hol, "userSub": me}},
			wantStatus: 204,
			check: func(t *testing.T, f *fakeStore, _ string) {
				if f.has(holPK, meSK) {
					t.Errorf("caller is still a member")
				}
			},
		},
		{
			name: "remove a sub that isn't a member",
			req: request{method: "DELETE", resource: "/holidays/{holidayId}/members/{userSub}", sub: me,
				params: map[string]string{"holidayId": hol2, "userSub": stranger}},
			wantStatus: 204,
			check: func(t *testing.T, f *fakeStore, _ string) {
				if !f.has(model.HolidayPK(hol2), meSK) {
					t.Errorf("the only member was removed")
				}
			},
		},
		{
			name: "create an attendee",
			req: request{method: "PUT", resource: "/holidays/{holidayId}/attendees/{id}", sub: me, body: `{"name":"Alex","version":0}`,
				params: map[string]string{"holidayId": hol, "id": newAtt}},
			wantStatus: 200,
			check: func(t *testing.T, f *fakeStore, body string) {
				a := decode[model.Attendee](t, body)
				if a.ID != newAtt || a.Name != "Alex" || a.Version != 1 || a.UpdatedBy != me {
					t.Errorf("attendee = %+v", a)
				}
				if !f.has(holPK, model.AttendeePrefix+newAtt) {
					t.Errorf("attendee not stored")
				}
			},
		},
		{
			name: "rename an attendee",
			req: request{method: "PUT", resource: "/holidays/{holidayId}/attendees/{id}", sub: friend, body: `{"name":"Samantha","version":2}`,
				params: map[string]string{"holidayId": hol, "id": att}},
			wantStatus: 200,
			check: func(t *testing.T, _ *fakeStore, body string) {
				a := decode[model.Attendee](t, body)
				if a.Name != "Samantha" || a.Version != 3 || a.UpdatedBy != friend {
					t.Errorf("attendee = %+v", a)
				}
			},
		},
		{
			name: "delete an attendee",
			req: request{method: "DELETE", resource: "/holidays/{holidayId}/{kind}/{id}", sub: me,
				params: map[string]string{"holidayId": hol, "kind": "attendees", "id": att}},
			wantStatus: 204,
			check: func(t *testing.T, f *fakeStore, _ string) {
				if f.has(holPK, attSK) {
					t.Errorf("attendee still stored")
				}
			},
		},
		{
			name: "delete a missing attendee",
			req: request{method: "DELETE", resource: "/holidays/{holidayId}/{kind}/{id}", sub: me,
				params: map[string]string{"holidayId": hol, "kind": "attendees", "id": newAtt}},
			wantStatus: 204,
		},
		{
			name: "delete an attendee by its own resource",
			req: request{method: "DELETE", resource: "/holidays/{holidayId}/attendees/{id}", sub: me,
				params: map[string]string{"holidayId": hol, "id": att}},
			wantStatus: 204,
			check: func(t *testing.T, f *fakeStore, _ string) {
				if f.has(holPK, attSK) {
					t.Errorf("attendee still stored")
				}
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := seeded()
			if tt.seed != nil {
				tt.seed(f)
			}
			res := run(t, f, tt.req)
			if res.status != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body %s)", res.status, tt.wantStatus, res.body)
			}
			if tt.check != nil {
				tt.check(t, f, res.body)
			}
		})
	}
}

// Every route under /holidays/{holidayId}, except creating a holiday.
func memberRoutes(holidayID string) map[string]request {
	return map[string]request{
		"update holiday": {method: "PUT", resource: "/holidays/{holidayId}", params: holidayParams(holidayID),
			body: strings.Replace(validHoliday, `"version":0`, `"version":1`, 1)},
		"get holiday":    {method: "GET", resource: "/holidays/{holidayId}", params: holidayParams(holidayID)},
		"delete holiday": {method: "DELETE", resource: "/holidays/{holidayId}", params: holidayParams(holidayID)},
		"add member": {method: "PUT", resource: "/holidays/{holidayId}/members/{userSub}", body: `{"version":0}`,
			params: map[string]string{"holidayId": holidayID, "userSub": friend}},
		"remove member": {method: "DELETE", resource: "/holidays/{holidayId}/members/{userSub}",
			params: map[string]string{"holidayId": holidayID, "userSub": friend}},
		"put attendee": {method: "PUT", resource: "/holidays/{holidayId}/attendees/{id}", body: `{"name":"A","version":0}`,
			params: map[string]string{"holidayId": holidayID, "id": newAtt}},
		"delete attendee": {method: "DELETE", resource: "/holidays/{holidayId}/{kind}/{id}",
			params: map[string]string{"holidayId": holidayID, "kind": "attendees", "id": att}},
	}
}

func TestMembership(t *testing.T) {
	cases := []struct {
		name       string
		holidayID  string
		wantStatus int
		wantCode   string
	}{
		{name: "not a member", holidayID: hol3, wantStatus: 403, wantCode: "not-a-member"},
		{name: "missing holiday", holidayID: missing, wantStatus: 404, wantCode: "not-found"},
	}
	for _, c := range cases {
		for route, req := range memberRoutes(c.holidayID) {
			t.Run(c.name+"/"+route, func(t *testing.T) {
				f := seeded()
				req.sub = me
				res := run(t, f, req)
				if res.status != c.wantStatus || res.errCode != c.wantCode {
					t.Errorf("got %d %s, want %d %s", res.status, res.errCode, c.wantStatus, c.wantCode)
				}
				if f.calls["Put"]+f.calls["Delete"]+f.calls["DeleteHoliday"]+f.calls["CreateHoliday"] != 0 {
					t.Errorf("wrote to the store: %v", f.calls)
				}
				if c.holidayID == hol3 && !f.has(model.HolidayPK(hol3), model.MetaSK) {
					t.Errorf("holiday was changed")
				}
			})
		}
	}
}

func TestConflicts(t *testing.T) {
	tests := []struct {
		name        string
		req         request
		seed        func(*fakeStore)
		wantCode    string
		wantCurrent string // a substring of the `current` JSON, or "null"
	}{
		{
			name:     "create an existing holiday",
			req:      request{method: "PUT", resource: "/holidays/{holidayId}", params: holidayParams(hol3), body: validHoliday, sub: me},
			wantCode: "already-exists",
		},
		{
			name: "update a holiday at a stale version",
			req: request{method: "PUT", resource: "/holidays/{holidayId}", params: holidayParams(hol), sub: me,
				body: strings.Replace(validHoliday, `"version":0`, `"version":7`, 1)},
			wantCode:    "version-conflict",
			wantCurrent: `"name":"Summer"`,
		},
		{
			name: "add an existing member",
			req: request{method: "PUT", resource: "/holidays/{holidayId}/members/{userSub}", sub: me, body: `{"version":0}`,
				params: map[string]string{"holidayId": hol, "userSub": friend}},
			wantCode: "already-exists",
		},
		{
			name: "create an existing attendee",
			req: request{method: "PUT", resource: "/holidays/{holidayId}/attendees/{id}", sub: me, body: `{"name":"A","version":0}`,
				params: map[string]string{"holidayId": hol, "id": att}},
			wantCode: "already-exists",
		},
		{
			name: "rename an attendee at a stale version",
			req: request{method: "PUT", resource: "/holidays/{holidayId}/attendees/{id}", sub: me, body: `{"name":"A","version":1}`,
				params: map[string]string{"holidayId": hol, "id": att}},
			wantCode:    "version-conflict",
			wantCurrent: `"version":2`,
		},
		{
			name: "rename a deleted attendee",
			req: request{method: "PUT", resource: "/holidays/{holidayId}/attendees/{id}", sub: me, body: `{"name":"A","version":1}`,
				params: map[string]string{"holidayId": hol, "id": newAtt}},
			wantCode:    "version-conflict",
			wantCurrent: "null",
		},
		{
			name: "remove the last member (yourself)",
			req: request{method: "DELETE", resource: "/holidays/{holidayId}/members/{userSub}", sub: me,
				params: map[string]string{"holidayId": hol2, "userSub": me}},
			wantCode: "last-member",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := seeded()
			res := run(t, f, tt.req)
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
	t.Run("last member stays", func(t *testing.T) {
		f := seeded()
		run(t, f, request{method: "DELETE", resource: "/holidays/{holidayId}/members/{userSub}", sub: me,
			params: map[string]string{"holidayId": hol2, "userSub": me}})
		if !f.has(model.HolidayPK(hol2), meSK) {
			t.Errorf("the last member was removed")
		}
	})
}

func TestValidation(t *testing.T) {
	holidayBody := func(field, value string) string {
		var m map[string]any
		_ = json.Unmarshal([]byte(validHoliday), &m)
		var v any
		_ = json.Unmarshal([]byte(value), &v)
		m[field] = v
		b, _ := json.Marshal(m)
		return string(b)
	}
	putHoliday := func(body string) request {
		return request{method: "PUT", resource: "/holidays/{holidayId}", params: holidayParams(missing), body: body, sub: me}
	}
	putAttendee := func(id, body string) request {
		return request{method: "PUT", resource: "/holidays/{holidayId}/attendees/{id}", body: body, sub: me,
			params: map[string]string{"holidayId": hol, "id": id}}
	}
	tests := []struct {
		name string
		req  request
	}{
		{name: "holiday: bad id", req: request{method: "PUT", resource: "/holidays/{holidayId}", params: holidayParams(badID), body: validHoliday, sub: me}},
		{name: "holiday: not JSON", req: putHoliday(`{`)},
		{name: "holiday: empty name", req: putHoliday(holidayBody("name", `""`))},
		{name: "holiday: whitespace name", req: putHoliday(holidayBody("name", `"   "`))},
		{name: "holiday: long name", req: putHoliday(holidayBody("name", `"`+strings.Repeat("x", 101)+`"`))},
		{name: "holiday: bad time zone", req: putHoliday(holidayBody("timeZone", `"Mars/Olympus"`))},
		{name: "holiday: bad start date", req: putHoliday(holidayBody("startDate", `"2026-02-30"`))},
		{name: "holiday: bad end date", req: putHoliday(holidayBody("endDate", `"2026/12/01"`))},
		{name: "holiday: end before start", req: putHoliday(holidayBody("endDate", `"2026-12-19"`))},
		{name: "holiday: negative version", req: putHoliday(holidayBody("version", `-1`))},
		{name: "get holiday: bad id", req: request{method: "GET", resource: "/holidays/{holidayId}", params: holidayParams(badID), sub: me}},
		{name: "delete holiday: bad id", req: request{method: "DELETE", resource: "/holidays/{holidayId}", params: holidayParams(badID), sub: me}},
		{name: "member: bad sub", req: request{method: "PUT", resource: "/holidays/{holidayId}/members/{userSub}", body: `{"version":0}`, sub: me,
			params: map[string]string{"holidayId": hol, "userSub": "nope"}}},
		{name: "member: version not 0", req: request{method: "PUT", resource: "/holidays/{holidayId}/members/{userSub}", body: `{"version":1}`, sub: me,
			params: map[string]string{"holidayId": hol, "userSub": stranger}}},
		{name: "member: not JSON", req: request{method: "PUT", resource: "/holidays/{holidayId}/members/{userSub}", body: `x`, sub: me,
			params: map[string]string{"holidayId": hol, "userSub": stranger}}},
		{name: "remove member: bad sub", req: request{method: "DELETE", resource: "/holidays/{holidayId}/members/{userSub}", sub: me,
			params: map[string]string{"holidayId": hol, "userSub": "nope"}}},
		{name: "attendee: bad id", req: putAttendee(badID, `{"name":"A","version":0}`)},
		{name: "attendee: bad holiday id", req: request{method: "PUT", resource: "/holidays/{holidayId}/attendees/{id}", body: `{"name":"A","version":0}`, sub: me,
			params: map[string]string{"holidayId": badID, "id": newAtt}}},
		{name: "attendee: empty name", req: putAttendee(newAtt, `{"name":"","version":0}`)},
		{name: "attendee: long name", req: putAttendee(newAtt, `{"name":"`+strings.Repeat("é", 101)+`","version":0}`)},
		{name: "attendee: negative version", req: putAttendee(newAtt, `{"name":"A","version":-2}`)},
		{name: "attendee: not JSON", req: putAttendee(newAtt, `[]`)},
		{name: "delete: unsupported kind", req: request{method: "DELETE", resource: "/holidays/{holidayId}/{kind}/{id}", sub: me,
			params: map[string]string{"holidayId": hol, "kind": "meals", "id": att}}},
		{name: "delete: unknown kind", req: request{method: "DELETE", resource: "/holidays/{holidayId}/{kind}/{id}", sub: me,
			params: map[string]string{"holidayId": hol, "kind": "members", "id": att}}},
		{name: "delete: bad id", req: request{method: "DELETE", resource: "/holidays/{holidayId}/{kind}/{id}", sub: me,
			params: map[string]string{"holidayId": hol, "kind": "attendees", "id": badID}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := seeded()
			res := run(t, f, tt.req)
			if res.status != 400 || res.errCode != "validation" {
				t.Errorf("got %d %s, want 400 validation (body %s)", res.status, res.errCode, res.body)
			}
			if f.calls["Put"]+f.calls["Delete"]+f.calls["CreateHoliday"]+f.calls["DeleteHoliday"] != 0 {
				t.Errorf("wrote to the store: %v", f.calls)
			}
		})
	}
}

func TestInternalErrors(t *testing.T) {
	routes := memberRoutes(hol)
	routes["list holidays"] = request{method: "GET", resource: "/holidays"}
	routes["create holiday"] = request{method: "PUT", resource: "/holidays/{holidayId}", params: holidayParams(missing), body: validHoliday}
	secret := errors.New("dynamodb exploded: table meal-planner-test-data PK=HOLIDAY#secret")
	for route, req := range routes {
		t.Run(route, func(t *testing.T) {
			f := seeded()
			f.err = secret
			req.sub = me
			res := run(t, f, req)
			if res.status != 500 || res.errCode != "internal" {
				t.Fatalf("got %d %s, want 500 internal", res.status, res.errCode)
			}
			if strings.Contains(res.body, "dynamodb") || strings.Contains(res.body, "secret") {
				t.Errorf("body %s leaks the error", res.body)
			}
			if !strings.Contains(res.log["error"].(string), "exploded") {
				t.Errorf("log %v lacks the error", res.log)
			}
		})
	}
}

func TestUnauthenticated(t *testing.T) {
	res := run(t, seeded(), request{method: "GET", resource: "/holidays"})
	if res.status != 401 || res.errCode != "unauthorized" {
		t.Errorf("got %d %s, want 401 unauthorized", res.status, res.errCode)
	}
}

func TestUnknownRoute(t *testing.T) {
	for _, req := range []request{
		{method: "POST", resource: "/holidays", sub: me},
		{method: "GET", resource: "/nope", sub: me},
	} {
		res := run(t, seeded(), req)
		if res.status != 404 || res.errCode != "not-found" {
			t.Errorf("%s %s: got %d %s, want 404 not-found", req.method, req.resource, res.status, res.errCode)
		}
	}
}

func TestLogLine(t *testing.T) {
	f := seeded()
	res := run(t, f, request{method: "PUT", resource: "/holidays/{holidayId}/attendees/{id}", sub: me,
		body: `{"name":"Very Private Name","version":0}`, params: map[string]string{"holidayId": hol, "id": newAtt}})
	want := map[string]any{
		"msg": "request", "route": "PUT /holidays/{holidayId}/attendees/{id}", "holidayId": hol,
		"sub": me, "status": float64(200), "durationMs": float64(5),
	}
	for k, v := range want {
		if res.log[k] != v {
			t.Errorf("log %s = %v, want %v", k, res.log[k], v)
		}
	}
	line, _ := json.Marshal(res.log)
	for _, leak := range []string{"Very Private Name", "secret@example.com"} {
		if strings.Contains(string(line), leak) {
			t.Errorf("log line %s contains %q", line, leak)
		}
	}
}
