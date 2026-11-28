// Command users is the Lambda behind GET /api/users (DESIGN §5.1, §6).
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/config"
	cip "github.com/aws/aws-sdk-go-v2/service/cognitoidentityprovider"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	poolID := os.Getenv("USER_POOL_ID")
	if poolID == "" {
		log.Error("starting", "error", "USER_POOL_ID is not set")
		os.Exit(1)
	}
	cfg, err := config.LoadDefaultConfig(context.Background())
	if err != nil {
		log.Error("starting", "error", err.Error())
		os.Exit(1)
	}
	lambda.Start(newHandler(cip.NewFromConfig(cfg), poolID, log).handle)
}
