// Package httpx builds JSON HTTP responses for the API Lambdas.
package httpx

import (
	"encoding/json"
	"net/http"

	"github.com/aws/aws-lambda-go/events"
)

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

type conflictBody struct {
	Error   errorDetail `json:"error"`
	Current any         `json:"current"`
}

// Conflict builds a 409 in the error shape plus `current`, the stored item
// (DESIGN §5.3). A nil current (the item is gone) is written as null.
func Conflict(code, message string, current any) (Response, error) {
	return JSON(http.StatusConflict, conflictBody{Error: errorDetail{Code: code, Message: message}, Current: current})
}

// NoContent is a 204 with no body.
func NoContent() Response {
	return Response{StatusCode: http.StatusNoContent}
}

// Proxy converts a Response to an API Gateway proxy response.
func Proxy(r Response) events.APIGatewayProxyResponse {
	return events.APIGatewayProxyResponse{StatusCode: r.StatusCode, Headers: r.Headers, Body: r.Body}
}
