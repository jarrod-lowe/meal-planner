package store

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/jarrod-lowe/meal-planner/backend/internal/model"
)

// The store tests run against DynamoDB Local (`make test-go` starts it).
// Each run uses its own table, with the keys and GSI of DESIGN §4.
var (
	testClient *dynamodb.Client
	testTable  string
)

var fixedNow = time.Date(2026, 11, 28, 1, 2, 3, 456_000_000, time.UTC)

const fixedNowString = "2026-11-28T01:02:03.456Z"

func TestMain(m *testing.M) {
	endpoint := os.Getenv("DYNAMODB_ENDPOINT")
	if endpoint == "" {
		fmt.Fprintln(os.Stderr, "DYNAMODB_ENDPOINT is not set. The store tests need DynamoDB Local: run `make test-go`.")
		os.Exit(1)
	}
	testClient = dynamodb.New(dynamodb.Options{
		Region:       "ap-southeast-2",
		BaseEndpoint: aws.String(endpoint),
		Credentials:  credentials.NewStaticCredentialsProvider("local", "local", ""),
	})
	testTable = "meal-planner-store-test-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	ctx := context.Background()
	if err := createTable(ctx, testClient, testTable); err != nil {
		fmt.Fprintf(os.Stderr, "creating table %s: %v\n", testTable, err)
		os.Exit(1)
	}
	code := m.Run()
	if _, err := testClient.DeleteTable(ctx, &dynamodb.DeleteTableInput{TableName: aws.String(testTable)}); err != nil {
		fmt.Fprintf(os.Stderr, "deleting table %s: %v\n", testTable, err)
	}
	os.Exit(code)
}

func createTable(ctx context.Context, client *dynamodb.Client, name string) error {
	attr := func(n string) types.AttributeDefinition {
		return types.AttributeDefinition{AttributeName: aws.String(n), AttributeType: types.ScalarAttributeTypeS}
	}
	key := func(n string, t types.KeyType) types.KeySchemaElement {
		return types.KeySchemaElement{AttributeName: aws.String(n), KeyType: t}
	}
	_, err := client.CreateTable(ctx, &dynamodb.CreateTableInput{
		TableName:            aws.String(name),
		BillingMode:          types.BillingModePayPerRequest,
		AttributeDefinitions: []types.AttributeDefinition{attr("PK"), attr("SK"), attr("GSI1PK"), attr("GSI1SK")},
		KeySchema:            []types.KeySchemaElement{key("PK", types.KeyTypeHash), key("SK", types.KeyTypeRange)},
		GlobalSecondaryIndexes: []types.GlobalSecondaryIndex{{
			IndexName:  aws.String(GSI1),
			KeySchema:  []types.KeySchemaElement{key("GSI1PK", types.KeyTypeHash), key("GSI1SK", types.KeyTypeRange)},
			Projection: &types.Projection{ProjectionType: types.ProjectionTypeKeysOnly},
		}},
	})
	if err != nil {
		return err
	}
	return dynamodb.NewTableExistsWaiter(client).Wait(ctx, &dynamodb.DescribeTableInput{TableName: aws.String(name)}, time.Minute)
}

func newTestStore(t *testing.T) *DynamoDB {
	t.Helper()
	// Read again here, not only in TestMain: go test's cache only notices
	// environment reads made while tests run, so this stops a cached pass
	// standing in for a run without DynamoDB Local.
	if os.Getenv("DYNAMODB_ENDPOINT") == "" {
		t.Fatal("DYNAMODB_ENDPOINT is not set; run `make test-go`")
	}
	s := New(testClient, testTable)
	s.now = func() time.Time { return fixedNow }
	return s
}

var idCounter atomic.Int64

// newID returns a UUID-shaped ID unique within the test run.
func newID() string {
	n := idCounter.Add(1)
	return fmt.Sprintf("01936b2e-7f1a-7c3d-8e4f-%012x", n)
}

func newHoliday(id, name, start string) *model.Holiday {
	return &model.Holiday{ID: id, Name: name, TimeZone: "Pacific/Auckland", StartDate: start, EndDate: "2027-01-31"}
}

func newAttendee(holidayID, name string, version int) *model.Attendee {
	a := &model.Attendee{ID: newID(), Name: name, Versioned: model.Versioned{Version: version}}
	a.SetKeys(holidayID)
	return a
}

func mustCreateHoliday(t *testing.T, s *DynamoDB, creator string) *model.Holiday {
	t.Helper()
	h := newHoliday(newID(), "Summer", "2026-12-20")
	if err := s.CreateHoliday(context.Background(), h, creator); err != nil {
		t.Fatalf("CreateHoliday() error = %v", err)
	}
	return h
}

func mustPut(t *testing.T, s *DynamoDB, item Item, by string) {
	t.Helper()
	if err := s.Put(context.Background(), item, by); err != nil {
		t.Fatalf("Put(%+v) error = %v", item.Keys(), err)
	}
}

func addMember(t *testing.T, s *DynamoDB, holidayID, sub string) {
	t.Helper()
	m := &model.Member{UserSub: sub}
	m.SetKeys(holidayID)
	mustPut(t, s, m, "creator")
}

func TestPutVersionConditions(t *testing.T) {
	ctx := context.Background()
	tests := []struct {
		name string
		// setup stores the item first, at version 1, when true.
		existing    bool
		bumps       int // extra updates after setup
		putVersion  int
		wantErr     error
		wantVersion int
		// wantCurrent is the stored version a conflict should report, or 0
		// for none.
		wantCurrent int
	}{
		{name: "create", putVersion: 0, wantVersion: 1},
		{name: "create existing", existing: true, putVersion: 0, wantErr: ErrAlreadyExists},
		{name: "update at the stored version", existing: true, putVersion: 1, wantVersion: 2},
		{name: "update after other updates", existing: true, bumps: 2, putVersion: 3, wantVersion: 4},
		{name: "update with a stale version", existing: true, bumps: 2, putVersion: 1, wantErr: ErrVersionConflict, wantCurrent: 3},
		{name: "update with a future version", existing: true, putVersion: 5, wantErr: ErrVersionConflict, wantCurrent: 1},
		{name: "update a missing item", putVersion: 1, wantErr: ErrVersionConflict},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newTestStore(t)
			holidayID := newID()
			a := newAttendee(holidayID, "Sam", 0)
			if tt.existing {
				mustPut(t, s, a, "setup")
				for range tt.bumps {
					mustPut(t, s, a, "setup")
				}
			}
			put := &model.Attendee{ID: a.ID, Name: "Sam renamed", Versioned: model.Versioned{Version: tt.putVersion}}
			put.SetKeys(holidayID)
			err := s.Put(ctx, put, "caller")

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("Put() error = %v, want %v", err, tt.wantErr)
				}
				if tt.wantErr == ErrVersionConflict {
					var conflict *VersionConflictError
					if !errors.As(err, &conflict) {
						t.Fatalf("error %v is not a *VersionConflictError", err)
					}
					if tt.wantCurrent == 0 {
						if conflict.Current != nil {
							t.Errorf("Current = %+v, want nil", conflict.Current)
						}
					} else {
						cur, ok := conflict.Current.(*model.Attendee)
						if !ok {
							t.Fatalf("Current = %T, want *model.Attendee", conflict.Current)
						}
						if cur.Version != tt.wantCurrent || cur.Name != "Sam" || cur.ID != a.ID {
							t.Errorf("Current = %+v, want version %d of %q", cur, tt.wantCurrent, "Sam")
						}
					}
				}
				var stored model.Attendee
				switch err := s.Get(ctx, model.Key{PK: a.PK, SK: a.SK}, &stored); {
				case tt.existing && err != nil:
					t.Fatalf("Get() error = %v", err)
				case tt.existing && stored.Name != "Sam":
					t.Errorf("stored name = %q, want it unchanged", stored.Name)
				case !tt.existing && !errors.Is(err, ErrNotFound):
					t.Errorf("Get() error = %v, want ErrNotFound", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("Put() error = %v", err)
			}
			want := model.Versioned{Version: tt.wantVersion, UpdatedAt: fixedNowString, UpdatedBy: "caller"}
			if put.Versioned != want {
				t.Errorf("item after Put() = %+v, want %+v", put.Versioned, want)
			}
			var stored model.Attendee
			if err := s.Get(ctx, model.Key{PK: a.PK, SK: a.SK}, &stored); err != nil {
				t.Fatalf("Get() error = %v", err)
			}
			if stored.Versioned != want || stored.Name != "Sam renamed" || stored.Type != model.TypeAttendee {
				t.Errorf("stored = %+v, want %+v named %q", stored, want, "Sam renamed")
			}
		})
	}
}

func TestPutRejectsBadItems(t *testing.T) {
	s := newTestStore(t)
	noKeys := &model.Attendee{ID: newID(), Name: "x"}
	if err := s.Put(context.Background(), noKeys, "c"); err == nil {
		t.Errorf("Put() without keys succeeded")
	}
	negative := newAttendee(newID(), "x", -1)
	if err := s.Put(context.Background(), negative, "c"); err == nil {
		t.Errorf("Put() with a negative version succeeded")
	}
}

func TestGetAndDelete(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	holidayID := newID()
	a := newAttendee(holidayID, "Sam", 0)
	key := model.Key{PK: a.PK, SK: a.SK}

	var got model.Attendee
	if err := s.Get(ctx, key, &got); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get() of a missing item error = %v, want ErrNotFound", err)
	}
	mustPut(t, s, a, "c")
	if err := s.Get(ctx, key, &got); err != nil || got.Name != "Sam" {
		t.Fatalf("Get() = %+v, %v", got, err)
	}
	for i := range 2 { // the second delete is of a missing item
		if err := s.Delete(ctx, key); err != nil {
			t.Fatalf("Delete() #%d error = %v", i+1, err)
		}
	}
	if err := s.Get(ctx, key, &got); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get() after Delete() error = %v, want ErrNotFound", err)
	}
}

func TestCreateHoliday(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	h := newHoliday(newID(), "Summer", "2026-12-20")
	if err := s.CreateHoliday(ctx, h, "creator"); err != nil {
		t.Fatalf("CreateHoliday() error = %v", err)
	}
	want := model.Versioned{Version: 1, UpdatedAt: fixedNowString, UpdatedBy: "creator"}
	if h.Versioned != want {
		t.Errorf("holiday after CreateHoliday() = %+v, want %+v", h.Versioned, want)
	}

	got, err := s.GetHoliday(ctx, h.ID)
	if err != nil {
		t.Fatalf("GetHoliday() error = %v", err)
	}
	if got.Name != "Summer" || got.Versioned != want || got.Type != model.TypeHoliday {
		t.Errorf("GetHoliday() = %+v", got)
	}

	var member model.Member
	if err := s.Get(ctx, model.Key{PK: model.HolidayPK(h.ID), SK: model.MemberPrefix + "creator"}, &member); err != nil {
		t.Fatalf("Get(member) error = %v", err)
	}
	if member.UserSub != "creator" || member.GSI1PK != "USER#creator" || member.GSI1SK != model.HolidayPK(h.ID) || member.Versioned != want {
		t.Errorf("member = %+v", member)
	}

	again := newHoliday(h.ID, "Other", "2026-12-21")
	if err := s.CreateHoliday(ctx, again, "someone-else"); !errors.Is(err, ErrAlreadyExists) {
		t.Errorf("second CreateHoliday() error = %v, want ErrAlreadyExists", err)
	}
	if got, _ := s.GetHoliday(ctx, h.ID); got.Name != "Summer" {
		t.Errorf("holiday after a failed create = %+v, want it unchanged", got)
	}
	if ok, _ := s.IsMember(ctx, h.ID, "someone-else"); ok {
		t.Errorf("failed create added its caller as a member")
	}
}

func TestGetHolidayNotFound(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.GetHoliday(context.Background(), newID()); !errors.Is(err, ErrNotFound) {
		t.Errorf("GetHoliday() error = %v, want ErrNotFound", err)
	}
}

func TestIsMember(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	h := mustCreateHoliday(t, s, "creator")
	addMember(t, s, h.ID, "friend")
	tests := []struct {
		name      string
		holidayID string
		sub       string
		want      bool
	}{
		{name: "creator", holidayID: h.ID, sub: "creator", want: true},
		{name: "added member", holidayID: h.ID, sub: "friend", want: true},
		{name: "stranger", holidayID: h.ID, sub: "stranger"},
		{name: "missing holiday", holidayID: newID(), sub: "creator"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := s.IsMember(ctx, tt.holidayID, tt.sub)
			if err != nil {
				t.Fatalf("IsMember() error = %v", err)
			}
			if got != tt.want {
				t.Errorf("IsMember() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestCountMembers(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	s.pageSize = 2 // force pagination
	h := mustCreateHoliday(t, s, "creator")
	// Attendees share the partition but aren't members.
	for range 3 {
		mustPut(t, s, newAttendee(h.ID, "Sam", 0), "creator")
	}
	count := func() int {
		t.Helper()
		n, err := s.CountMembers(ctx, h.ID)
		if err != nil {
			t.Fatalf("CountMembers() error = %v", err)
		}
		return n
	}
	if n := count(); n != 1 {
		t.Errorf("CountMembers() = %d, want 1", n)
	}
	for _, sub := range []string{"a", "b", "c", "d"} {
		addMember(t, s, h.ID, sub)
	}
	if n := count(); n != 5 {
		t.Errorf("CountMembers() = %d, want 5", n)
	}
	if err := s.Delete(ctx, model.Key{PK: model.HolidayPK(h.ID), SK: model.MemberPrefix + "a"}); err != nil {
		t.Fatal(err)
	}
	if n := count(); n != 4 {
		t.Errorf("CountMembers() after a delete = %d, want 4", n)
	}
	if n, err := s.CountMembers(ctx, newID()); err != nil || n != 0 {
		t.Errorf("CountMembers() of a missing holiday = %d, %v; want 0", n, err)
	}
}

func TestLoadHoliday(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	s.pageSize = 3 // force pagination
	h := mustCreateHoliday(t, s, "creator")
	addMember(t, s, h.ID, "friend")
	names := []string{"Ann", "Bob", "Cat", "Dan", "Eve"}
	for _, n := range names {
		mustPut(t, s, newAttendee(h.ID, n, 0), "creator")
	}

	facts, err := s.LoadHoliday(ctx, h.ID)
	if err != nil {
		t.Fatalf("LoadHoliday() error = %v", err)
	}
	if facts.Holiday.ID != h.ID || facts.Holiday.Name != "Summer" || facts.Holiday.Version != 1 {
		t.Errorf("Holiday = %+v", facts.Holiday)
	}
	var gotNames []string
	for _, a := range facts.Attendees {
		gotNames = append(gotNames, a.Name)
	}
	sort.Strings(gotNames)
	if fmt.Sprint(gotNames) != fmt.Sprint(names) {
		t.Errorf("attendees = %v, want %v", gotNames, names)
	}
	var subs []string
	for _, m := range facts.Members {
		subs = append(subs, m.UserSub)
	}
	sort.Strings(subs)
	if fmt.Sprint(subs) != "[creator friend]" {
		t.Errorf("members = %v, want [creator friend]", subs)
	}
	if facts.Meals == nil || facts.Trips == nil || facts.StockChanges == nil {
		t.Errorf("empty kinds should be empty slices: %+v", facts)
	}

	if _, err := s.LoadHoliday(ctx, newID()); !errors.Is(err, ErrNotFound) {
		t.Errorf("LoadHoliday() of a missing holiday error = %v, want ErrNotFound", err)
	}
}

func TestDeleteHoliday(t *testing.T) {
	ctx := context.Background()
	tests := []struct {
		name      string
		attendees int
		members   int
	}{
		{name: "just created", attendees: 0, members: 0},
		{name: "exactly one batch", attendees: 23, members: 0}, // + META + creator = 25
		{name: "several batches", attendees: 60, members: 5},
		{name: "a full transaction", attendees: 3, members: 98}, // + creator = 99, + META = 100
		{name: "one member over a transaction", attendees: 3, members: 99},
		{name: "more members than one transaction", attendees: 30, members: 120},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newTestStore(t)
			s.pageSize = 7 // force query pagination too
			h := mustCreateHoliday(t, s, "creator")
			for range tt.attendees {
				mustPut(t, s, newAttendee(h.ID, "Sam", 0), "creator")
			}
			for i := range tt.members {
				addMember(t, s, h.ID, "member-"+strconv.Itoa(i))
			}
			// Another holiday, which must survive.
			other := mustCreateHoliday(t, s, "creator")

			if err := s.DeleteHoliday(ctx, h.ID); err != nil {
				t.Fatalf("DeleteHoliday() error = %v", err)
			}
			items, err := s.QueryPartition(ctx, model.HolidayPK(h.ID))
			if err != nil {
				t.Fatalf("QueryPartition() error = %v", err)
			}
			if len(items) != 0 {
				t.Errorf("%d items left after DeleteHoliday()", len(items))
			}
			if _, err := s.GetHoliday(ctx, other.ID); err != nil {
				t.Errorf("other holiday: GetHoliday() error = %v", err)
			}
			// Deleting again is a no-op.
			if err := s.DeleteHoliday(ctx, h.ID); err != nil {
				t.Errorf("second DeleteHoliday() error = %v", err)
			}
		})
	}
}

// TestDeleteHolidayKeepsMembershipsUntilLast checks that a delete failing
// part way through leaves META and every member, so a member can retry it.
func TestDeleteHolidayKeepsMembershipsUntilLast(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	h := mustCreateHoliday(t, s, "creator")
	for range 60 {
		mustPut(t, s, newAttendee(h.ID, "Sam", 0), "creator")
	}
	const members = 5
	for i := range members {
		addMember(t, s, h.ID, "member-"+strconv.Itoa(i))
	}

	calls := 0
	s.beforeBatchWrite = func(requests []types.WriteRequest) error {
		for _, r := range requests {
			sk := r.DeleteRequest.Key["SK"].(*types.AttributeValueMemberS).Value
			if sk == model.MetaSK || strings.HasPrefix(sk, model.MemberPrefix) {
				t.Errorf("batch write deletes %s before the final transaction", sk)
			}
		}
		calls++
		if calls == 3 { // the last batch: 60 attendees = 25 + 25 + 10
			return errors.New("injected failure")
		}
		return nil
	}
	if err := s.DeleteHoliday(ctx, h.ID); err == nil {
		t.Fatal("DeleteHoliday() error = nil, want the injected failure")
	}
	if _, err := s.GetHoliday(ctx, h.ID); err != nil {
		t.Errorf("META after a failed delete: GetHoliday() error = %v", err)
	}
	n, err := s.CountMembers(ctx, h.ID)
	if err != nil || n != members+1 {
		t.Errorf("CountMembers() after a failed delete = %d, %v, want %d", n, err, members+1)
	}
	if ok, err := s.IsMember(ctx, h.ID, "creator"); err != nil || !ok {
		t.Errorf("IsMember(creator) after a failed delete = %v, %v", ok, err)
	}

	s.beforeBatchWrite = nil
	if err := s.DeleteHoliday(ctx, h.ID); err != nil {
		t.Fatalf("retried DeleteHoliday() error = %v", err)
	}
	items, err := s.QueryPartition(ctx, model.HolidayPK(h.ID))
	if err != nil {
		t.Fatalf("QueryPartition() error = %v", err)
	}
	if len(items) != 0 {
		t.Errorf("%d items left after the retried DeleteHoliday()", len(items))
	}
}

func TestListHolidays(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	s.pageSize = 40 // force GSI query pagination
	user := "lister-" + newID()

	const n = 130 // more than one BatchGetItem (100 keys)
	want := map[string]bool{}
	for range n {
		h := mustCreateHoliday(t, s, user)
		want[h.ID] = true
	}
	// A holiday the user was added to, rather than created.
	shared := mustCreateHoliday(t, s, "someone-else")
	addMember(t, s, shared.ID, user)
	want[shared.ID] = true
	// A holiday the user isn't in.
	mustCreateHoliday(t, s, "someone-else")
	// A membership whose META is gone, which is skipped.
	orphan := mustCreateHoliday(t, s, user)
	if err := s.Delete(ctx, model.Key{PK: model.HolidayPK(orphan.ID), SK: model.MetaSK}); err != nil {
		t.Fatal(err)
	}

	got, err := s.ListHolidays(ctx, user)
	if err != nil {
		t.Fatalf("ListHolidays() error = %v", err)
	}
	if len(got) != len(want) {
		t.Errorf("ListHolidays() returned %d holidays, want %d", len(got), len(want))
	}
	seen := map[string]bool{}
	for _, h := range got {
		if !want[h.ID] {
			t.Errorf("unexpected holiday %s", h.ID)
		}
		if seen[h.ID] {
			t.Errorf("holiday %s listed twice", h.ID)
		}
		seen[h.ID] = true
		if h.Name != "Summer" || h.Version != 1 {
			t.Errorf("holiday = %+v", h)
		}
	}

	none, err := s.ListHolidays(ctx, "nobody-"+newID())
	if err != nil || len(none) != 0 {
		t.Errorf("ListHolidays() for a user with no holidays = %v, %v", none, err)
	}
}
