package httpx

import (
	"encoding/json"
	"math"
	"testing"
)

func TestJSON(t *testing.T) {
	tests := []struct {
		name     string
		status   int
		body     any
		wantBody string
		wantErr  bool
	}{
		{name: "object", status: 200, body: map[string]int{"version": 3}, wantBody: `{"version":3}`},
		{name: "slice", status: 201, body: []string{"a", "b"}, wantBody: `["a","b"]`},
		{name: "nil", status: 200, body: nil, wantBody: `null`},
		{name: "unmarshalable", status: 200, body: math.Inf(1), wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := JSON(tt.status, tt.body)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("JSON() error = nil, want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("JSON() error = %v", err)
			}
			if got.StatusCode != tt.status {
				t.Errorf("StatusCode = %d, want %d", got.StatusCode, tt.status)
			}
			if ct := got.Headers["Content-Type"]; ct != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}
			if got.Body != tt.wantBody {
				t.Errorf("Body = %s, want %s", got.Body, tt.wantBody)
			}
		})
	}
}

func TestError(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		code    string
		message string
	}{
		{name: "validation", status: 400, code: "validation", message: "name is required"},
		{name: "not a member", status: 403, code: "not-a-member", message: "not a member"},
		{name: "escapes quotes", status: 500, code: "internal", message: `bad "thing"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Error(tt.status, tt.code, tt.message)
			if got.StatusCode != tt.status {
				t.Errorf("StatusCode = %d, want %d", got.StatusCode, tt.status)
			}
			if ct := got.Headers["Content-Type"]; ct != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", ct)
			}
			var parsed struct {
				Error struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal([]byte(got.Body), &parsed); err != nil {
				t.Fatalf("body %q is not JSON: %v", got.Body, err)
			}
			if parsed.Error.Code != tt.code || parsed.Error.Message != tt.message {
				t.Errorf("error = %+v, want code %q message %q", parsed.Error, tt.code, tt.message)
			}
		})
	}
}
