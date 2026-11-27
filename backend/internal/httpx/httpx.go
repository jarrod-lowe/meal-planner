// Package httpx builds JSON HTTP responses for the API Lambdas.
package httpx

import "encoding/json"

// Response is a protocol-neutral HTTP response, mapped to the Lambda proxy
// response by the handlers.
type Response struct {
	StatusCode int
	Headers    map[string]string
	Body       string
}

type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// JSON marshals v into a response with the given status and a JSON
// content type.
func JSON(status int, v any) (Response, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return Response{}, err
	}
	return Response{
		StatusCode: status,
		Headers:    map[string]string{"Content-Type": "application/json"},
		Body:       string(b),
	}, nil
}

// Error builds a response in the API error shape
// {"error": {"code": ..., "message": ...}} (DESIGN §5.3).
func Error(status int, code, message string) Response {
	// Marshalling two strings cannot fail.
	r, _ := JSON(status, errorBody{Error: errorDetail{Code: code, Message: message}})
	return r
}
