package auth

import (
	"testing"

	"github.com/aws/aws-lambda-go/events"
)

func request(authorizer map[string]any) events.APIGatewayProxyRequest {
	return events.APIGatewayProxyRequest{
		RequestContext: events.APIGatewayProxyRequestContext{Authorizer: authorizer},
	}
}

func TestCallerFromRequest(t *testing.T) {
	tests := []struct {
		name       string
		authorizer map[string]any
		want       Caller
		wantErr    bool
	}{
		{
			name:       "sub and name",
			authorizer: map[string]any{"claims": map[string]any{"sub": "s1", "name": "Sam Smith", "email": "sam@example.com"}},
			want:       Caller{Sub: "s1", Name: "Sam Smith"},
		},
		{
			name:       "no name falls back to the email's local part",
			authorizer: map[string]any{"claims": map[string]any{"sub": "s1", "email": "sam@example.com"}},
			want:       Caller{Sub: "s1", Name: "sam"},
		},
		{
			name:       "blank name falls back to the email's local part",
			authorizer: map[string]any{"claims": map[string]any{"sub": "s1", "name": " ", "email": "sam@example.com"}},
			want:       Caller{Sub: "s1", Name: "sam"},
		},
		{
			name:       "no name or email falls back to the sub",
			authorizer: map[string]any{"claims": map[string]any{"sub": "s1"}},
			want:       Caller{Sub: "s1", Name: "s1"},
		},
		{name: "missing sub", authorizer: map[string]any{"claims": map[string]any{"name": "Sam"}}, wantErr: true},
		{name: "empty sub", authorizer: map[string]any{"claims": map[string]any{"sub": ""}}, wantErr: true},
		{name: "non-string sub", authorizer: map[string]any{"claims": map[string]any{"sub": 7}}, wantErr: true},
		{name: "no claims", authorizer: map[string]any{}, wantErr: true},
		{name: "claims of the wrong type", authorizer: map[string]any{"claims": "x"}, wantErr: true},
		{name: "no authorizer", authorizer: nil, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := CallerFromRequest(request(tt.authorizer))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("CallerFromRequest() = %+v, want error", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("CallerFromRequest() error = %v", err)
			}
			if got != tt.want {
				t.Errorf("CallerFromRequest() = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestEmailLocalPart(t *testing.T) {
	for in, want := range map[string]string{"sam@example.com": "sam", "no-at": "no-at", "": "", "@example.com": ""} {
		if got := EmailLocalPart(in); got != want {
			t.Errorf("EmailLocalPart(%q) = %q, want %q", in, got, want)
		}
	}
}
