// Command catalogue is the Lambda behind /api/catalogue (DESIGN §5.1, §6).
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/aws/aws-lambda-go/lambda"

	"github.com/jarrod-lowe/meal-planner/backend/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	s, err := store.NewFromEnv(context.Background())
	if err != nil {
		log.Error("starting", "error", err.Error())
		os.Exit(1)
	}
	lambda.Start(newHandler(s, log).handle)
}
