package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/jarrod-lowe/meal-planner/backend/internal/model"
)

// DynamoDB limits on batch sizes.
const (
	batchGetLimit      = 100
	batchWriteLimit    = 25
	transactWriteLimit = 100
)

// Retries of unprocessed batch keys and items.
const (
	maxBatchAttempts = 10
	baseBackoff      = 50 * time.Millisecond
	maxBackoff       = 2 * time.Second
)

// timestampLayout matches JavaScript's toISOString().
const timestampLayout = "2006-01-02T15:04:05.000Z"

// DynamoDB implements Store on one table.
type DynamoDB struct {
	client *dynamodb.Client
	table  string
	now    func() time.Time
	// pageSize, when set, limits each query page (tests use it to force
	// pagination).
	pageSize int32
	// beforeBatchWrite, when set, runs before each batch write, and its
	// error fails it (tests use it to inject failures).
	beforeBatchWrite func([]types.WriteRequest) error
}

var _ Store = (*DynamoDB)(nil)

// New returns a store on the given table.
func New(client *dynamodb.Client, table string) *DynamoDB {
	return &DynamoDB{client: client, table: table, now: time.Now}
}

// NewFromEnv returns a store on the table named by TABLE_NAME, using the
// default AWS configuration. DYNAMODB_ENDPOINT overrides the endpoint (for
// DynamoDB Local).
func NewFromEnv(ctx context.Context) (*DynamoDB, error) {
	table := os.Getenv("TABLE_NAME")
	if table == "" {
		return nil, errors.New("TABLE_NAME is not set")
	}
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("loading AWS config: %w", err)
	}
	client := dynamodb.NewFromConfig(cfg, func(o *dynamodb.Options) {
		if endpoint := os.Getenv("DYNAMODB_ENDPOINT"); endpoint != "" {
			o.BaseEndpoint = aws.String(endpoint)
		}
	})
	return New(client, table), nil
}

func (s *DynamoDB) limit() *int32 {
	if s.pageSize > 0 {
		return aws.Int32(s.pageSize)
	}
	return nil
}

func keyAttrs(k model.Key) map[string]types.AttributeValue {
	return map[string]types.AttributeValue{
		"PK": &types.AttributeValueMemberS{Value: k.PK},
		"SK": &types.AttributeValueMemberS{Value: k.SK},
	}
}

// stamp sets the item's stored version metadata, returning the previous
// values so a failed write can restore them.
func (s *DynamoDB) stamp(item Item, by string) model.Versioned {
	v := item.Versioning()
	old := *v
	*v = model.Versioned{Version: old.Version + 1, UpdatedAt: s.now().UTC().Format(timestampLayout), UpdatedBy: by}
	return old
}

// Get reads one item into out (a pointer to a model struct), or returns
// ErrNotFound.
func (s *DynamoDB) Get(ctx context.Context, key model.Key, out any) error {
	res, err := s.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:      aws.String(s.table),
		Key:            keyAttrs(key),
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return fmt.Errorf("getting %s %s: %w", key.PK, key.SK, err)
	}
	if res.Item == nil {
		return ErrNotFound
	}
	if err := attributevalue.UnmarshalMap(res.Item, out); err != nil {
		return fmt.Errorf("decoding %s %s: %w", key.PK, key.SK, err)
	}
	return nil
}

// Put implements Store.
func (s *DynamoDB) Put(ctx context.Context, item Item, by string) error {
	k := item.Keys()
	if k.PK == "" || k.SK == "" || k.Type == "" {
		return errors.New("item has no storage keys")
	}
	expected := item.Versioning().Version
	if expected < 0 {
		return fmt.Errorf("negative version %d", expected)
	}
	old := s.stamp(item, by)
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		*item.Versioning() = old
		return fmt.Errorf("encoding %s %s: %w", k.PK, k.SK, err)
	}
	in := &dynamodb.PutItemInput{TableName: aws.String(s.table), Item: av}
	if expected == 0 {
		in.ConditionExpression = aws.String("attribute_not_exists(PK)")
	} else {
		in.ConditionExpression = aws.String("#version = :expected")
		in.ExpressionAttributeNames = map[string]string{"#version": "version"}
		in.ExpressionAttributeValues = map[string]types.AttributeValue{
			":expected": &types.AttributeValueMemberN{Value: fmt.Sprint(expected)},
		}
		in.ReturnValuesOnConditionCheckFailure = types.ReturnValuesOnConditionCheckFailureAllOld
	}
	_, err = s.client.PutItem(ctx, in)
	if err == nil {
		return nil
	}
	*item.Versioning() = old
	var failed *types.ConditionalCheckFailedException
	if !errors.As(err, &failed) {
		return fmt.Errorf("putting %s %s: %w", k.PK, k.SK, err)
	}
	if expected == 0 {
		return ErrAlreadyExists
	}
	conflict := &VersionConflictError{}
	if len(failed.Item) > 0 {
		current := reflect.New(reflect.TypeOf(item).Elem()).Interface().(Item)
		if err := attributevalue.UnmarshalMap(failed.Item, current); err != nil {
			return fmt.Errorf("decoding current %s %s: %w", k.PK, k.SK, err)
		}
		conflict.Current = current
	}
	return conflict
}

// Delete implements Store.
func (s *DynamoDB) Delete(ctx context.Context, key model.Key) error {
	_, err := s.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(s.table),
		Key:       keyAttrs(key),
	})
	if err != nil {
		return fmt.Errorf("deleting %s %s: %w", key.PK, key.SK, err)
	}
	return nil
}

// GetHoliday implements Store.
func (s *DynamoDB) GetHoliday(ctx context.Context, holidayID string) (model.Holiday, error) {
	var h model.Holiday
	err := s.Get(ctx, model.Key{PK: model.HolidayPK(holidayID), SK: model.MetaSK}, &h)
	return h, err
}

// query runs a paginated query, calling page for each page of items.
func (s *DynamoDB) query(ctx context.Context, in *dynamodb.QueryInput, page func(*dynamodb.QueryOutput) error) error {
	in.TableName = aws.String(s.table)
	in.Limit = s.limit()
	p := dynamodb.NewQueryPaginator(s.client, in)
	for p.HasMorePages() {
		out, err := p.NextPage(ctx)
		if err != nil {
			return err
		}
		if err := page(out); err != nil {
			return err
		}
	}
	return nil
}

func partitionQuery(pk string) *dynamodb.QueryInput {
	return &dynamodb.QueryInput{
		KeyConditionExpression:    aws.String("PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":pk": &types.AttributeValueMemberS{Value: pk}},
		ConsistentRead:            aws.Bool(true),
	}
}

// QueryPartition returns every item with the partition key pk.
func (s *DynamoDB) QueryPartition(ctx context.Context, pk string) ([]map[string]types.AttributeValue, error) {
	var items []map[string]types.AttributeValue
	err := s.query(ctx, partitionQuery(pk), func(out *dynamodb.QueryOutput) error {
		items = append(items, out.Items...)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("querying %s: %w", pk, err)
	}
	return items, nil
}

// LoadHoliday implements Store. Item types later phases add are skipped.
func (s *DynamoDB) LoadHoliday(ctx context.Context, holidayID string) (model.HolidayFacts, error) {
	items, err := s.QueryPartition(ctx, model.HolidayPK(holidayID))
	if err != nil {
		return model.HolidayFacts{}, err
	}
	facts := model.HolidayFacts{
		Attendees:    []model.Attendee{},
		Meals:        []json.RawMessage{},
		Trips:        []json.RawMessage{},
		StockChanges: []json.RawMessage{},
		Members:      []model.Member{},
	}
	found := false
	for _, av := range items {
		var keys model.StorageKeys
		if err := attributevalue.UnmarshalMap(av, &keys); err != nil {
			return model.HolidayFacts{}, fmt.Errorf("decoding keys in %s: %w", holidayID, err)
		}
		var target any
		switch keys.Type {
		case model.TypeHoliday:
			target, found = &facts.Holiday, true
		case model.TypeMember:
			facts.Members = append(facts.Members, model.Member{})
			target = &facts.Members[len(facts.Members)-1]
		case model.TypeAttendee:
			facts.Attendees = append(facts.Attendees, model.Attendee{})
			target = &facts.Attendees[len(facts.Attendees)-1]
		default:
			continue
		}
		if err := attributevalue.UnmarshalMap(av, target); err != nil {
			return model.HolidayFacts{}, fmt.Errorf("decoding %s %s: %w", keys.PK, keys.SK, err)
		}
	}
	if !found {
		return model.HolidayFacts{}, ErrNotFound
	}
	return facts, nil
}

// IsMember implements Store.
func (s *DynamoDB) IsMember(ctx context.Context, holidayID, sub string) (bool, error) {
	res, err := s.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName:            aws.String(s.table),
		Key:                  keyAttrs(model.Key{PK: model.HolidayPK(holidayID), SK: model.MemberPrefix + sub}),
		ConsistentRead:       aws.Bool(true),
		ProjectionExpression: aws.String("PK"),
	})
	if err != nil {
		return false, fmt.Errorf("checking membership of %s: %w", holidayID, err)
	}
	return res.Item != nil, nil
}

// CountMembers implements Store.
func (s *DynamoDB) CountMembers(ctx context.Context, holidayID string) (int, error) {
	in := &dynamodb.QueryInput{
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :member)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: model.HolidayPK(holidayID)},
			":member": &types.AttributeValueMemberS{Value: model.MemberPrefix},
		},
		ConsistentRead: aws.Bool(true),
		Select:         types.SelectCount,
	}
	n := 0
	err := s.query(ctx, in, func(out *dynamodb.QueryOutput) error {
		n += int(out.Count)
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("counting members of %s: %w", holidayID, err)
	}
	return n, nil
}

// CreateHoliday implements Store.
func (s *DynamoDB) CreateHoliday(ctx context.Context, h *model.Holiday, by string) error {
	h.SetKeys()
	h.Version = 0
	member := &model.Member{UserSub: by}
	member.SetKeys(h.ID)
	old := s.stamp(h, by)
	s.stamp(member, by)
	holidayAV, err := attributevalue.MarshalMap(h)
	if err != nil {
		*h.Versioning() = old
		return fmt.Errorf("encoding holiday %s: %w", h.ID, err)
	}
	memberAV, err := attributevalue.MarshalMap(member)
	if err != nil {
		*h.Versioning() = old
		return fmt.Errorf("encoding member of %s: %w", h.ID, err)
	}
	put := func(av map[string]types.AttributeValue) types.TransactWriteItem {
		return types.TransactWriteItem{Put: &types.Put{
			TableName:           aws.String(s.table),
			Item:                av,
			ConditionExpression: aws.String("attribute_not_exists(PK)"),
		}}
	}
	_, err = s.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{put(holidayAV), put(memberAV)},
	})
	if err == nil {
		return nil
	}
	*h.Versioning() = old
	var cancelled *types.TransactionCanceledException
	if errors.As(err, &cancelled) {
		for _, r := range cancelled.CancellationReasons {
			if aws.ToString(r.Code) == "ConditionalCheckFailed" {
				return ErrAlreadyExists
			}
		}
	}
	return fmt.Errorf("creating holiday %s: %w", h.ID, err)
}

// ListHolidays implements Store.
func (s *DynamoDB) ListHolidays(ctx context.Context, sub string) ([]model.Holiday, error) {
	in := &dynamodb.QueryInput{
		IndexName:                 aws.String(GSI1),
		KeyConditionExpression:    aws.String("GSI1PK = :user"),
		ExpressionAttributeValues: map[string]types.AttributeValue{":user": &types.AttributeValueMemberS{Value: model.UserPrefix + sub}},
	}
	var keys []map[string]types.AttributeValue
	seen := map[string]bool{}
	err := s.query(ctx, in, func(out *dynamodb.QueryOutput) error {
		for _, av := range out.Items {
			var k model.StorageKeys
			if err := attributevalue.UnmarshalMap(av, &k); err != nil {
				return err
			}
			if !seen[k.PK] {
				seen[k.PK] = true
				keys = append(keys, keyAttrs(model.Key{PK: k.PK, SK: model.MetaSK}))
			}
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("listing memberships: %w", err)
	}

	holidays := []model.Holiday{}
	for start := 0; start < len(keys); start += batchGetLimit {
		chunk := keys[start:min(start+batchGetLimit, len(keys))]
		items, err := s.batchGet(ctx, chunk)
		if err != nil {
			return nil, err
		}
		for _, av := range items {
			var h model.Holiday
			if err := attributevalue.UnmarshalMap(av, &h); err != nil {
				return nil, fmt.Errorf("decoding holiday: %w", err)
			}
			holidays = append(holidays, h)
		}
	}
	return holidays, nil
}

// batchGet gets up to 100 items, retrying unprocessed keys with backoff.
func (s *DynamoDB) batchGet(ctx context.Context, keys []map[string]types.AttributeValue) ([]map[string]types.AttributeValue, error) {
	var items []map[string]types.AttributeValue
	request := map[string]types.KeysAndAttributes{s.table: {Keys: keys}}
	for attempt := 0; ; attempt++ {
		out, err := s.client.BatchGetItem(ctx, &dynamodb.BatchGetItemInput{RequestItems: request})
		if err != nil {
			return nil, fmt.Errorf("getting holidays: %w", err)
		}
		items = append(items, out.Responses[s.table]...)
		if len(out.UnprocessedKeys[s.table].Keys) == 0 {
			return items, nil
		}
		if err := backoff(ctx, attempt); err != nil {
			return nil, fmt.Errorf("getting holidays: %w", err)
		}
		request = out.UnprocessedKeys
	}
}

// DeleteHoliday implements Store. Everything but META and the members goes
// first, in batches; then the members and META go together in one
// transaction, so a failure part way through leaves every membership in
// place, and a member can delete again. A holiday with more members than one
// transaction holds loses the surplus members in batches just before it.
func (s *DynamoDB) DeleteHoliday(ctx context.Context, holidayID string) error {
	pk := model.HolidayPK(holidayID)
	in := partitionQuery(pk)
	in.ProjectionExpression = aws.String("PK, SK")
	var others, members []map[string]types.AttributeValue
	var meta map[string]types.AttributeValue
	err := s.query(ctx, in, func(out *dynamodb.QueryOutput) error {
		for _, av := range out.Items {
			sk, _ := av["SK"].(*types.AttributeValueMemberS)
			switch {
			case sk != nil && sk.Value == model.MetaSK:
				meta = av
			case sk != nil && strings.HasPrefix(sk.Value, model.MemberPrefix):
				members = append(members, av)
			default:
				others = append(others, av)
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("listing items of %s: %w", holidayID, err)
	}
	// Leave room in the transaction for META.
	keep := min(len(members), transactWriteLimit-1)
	if err := s.batchDelete(ctx, append(others, members[keep:]...)); err != nil {
		return fmt.Errorf("deleting items of %s: %w", holidayID, err)
	}
	final := members[:keep:keep]
	if meta != nil {
		final = append(final, meta)
	}
	if len(final) == 0 {
		return nil
	}
	actions := make([]types.TransactWriteItem, len(final))
	for i, key := range final {
		actions[i] = types.TransactWriteItem{Delete: &types.Delete{TableName: aws.String(s.table), Key: key}}
	}
	if _, err := s.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{TransactItems: actions}); err != nil {
		return fmt.Errorf("deleting members and META of %s: %w", holidayID, err)
	}
	return nil
}

// batchDelete deletes the keys in batches of 25.
func (s *DynamoDB) batchDelete(ctx context.Context, keys []map[string]types.AttributeValue) error {
	for start := 0; start < len(keys); start += batchWriteLimit {
		batch := keys[start:min(start+batchWriteLimit, len(keys))]
		requests := make([]types.WriteRequest, len(batch))
		for i, key := range batch {
			requests[i] = types.WriteRequest{DeleteRequest: &types.DeleteRequest{Key: key}}
		}
		if err := s.batchWrite(ctx, requests); err != nil {
			return err
		}
	}
	return nil
}

// batchWrite writes up to 25 requests, retrying unprocessed items with
// backoff.
func (s *DynamoDB) batchWrite(ctx context.Context, requests []types.WriteRequest) error {
	if s.beforeBatchWrite != nil {
		if err := s.beforeBatchWrite(requests); err != nil {
			return err
		}
	}
	request := map[string][]types.WriteRequest{s.table: requests}
	for attempt := 0; ; attempt++ {
		out, err := s.client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{RequestItems: request})
		if err != nil {
			return err
		}
		if len(out.UnprocessedItems[s.table]) == 0 {
			return nil
		}
		if err := backoff(ctx, attempt); err != nil {
			return err
		}
		request = out.UnprocessedItems
	}
}

// backoff waits before retry attempt+1, or fails once the attempts are used
// up or the context ends.
func backoff(ctx context.Context, attempt int) error {
	if attempt+1 >= maxBatchAttempts {
		return fmt.Errorf("unprocessed after %d attempts", maxBatchAttempts)
	}
	delay := min(baseBackoff<<attempt, maxBackoff)
	t := time.NewTimer(delay)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}
