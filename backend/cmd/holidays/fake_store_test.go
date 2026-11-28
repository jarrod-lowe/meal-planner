package main

import (
	"context"
	"reflect"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"

	"github.com/jarrod-lowe/meal-planner/backend/internal/model"
	"github.com/jarrod-lowe/meal-planner/backend/internal/store"
)

const fakeNow = "2026-11-28T00:00:00.000Z"

// fakeStore is an in-memory store.Store with the same version rules as the
// DynamoDB one. Items are kept as DynamoDB attribute maps, so stored values
// are copies.
type fakeStore struct {
	items map[model.Key]map[string]types.AttributeValue
	// err, when set, is returned by every method.
	err error
	// calls counts calls by method name.
	calls map[string]int
}

var _ store.Store = (*fakeStore)(nil)

func newFakeStore() *fakeStore {
	return &fakeStore{items: map[model.Key]map[string]types.AttributeValue{}, calls: map[string]int{}}
}

func (f *fakeStore) call(name string) error {
	f.calls[name]++
	return f.err
}

func (f *fakeStore) Put(_ context.Context, item store.Item, by string) error {
	if err := f.call("Put"); err != nil {
		return err
	}
	k := item.Keys()
	key := model.Key{PK: k.PK, SK: k.SK}
	v := item.Versioning()
	existing, ok := f.items[key]
	if v.Version == 0 && ok {
		return store.ErrAlreadyExists
	}
	if v.Version > 0 {
		if !ok {
			return &store.VersionConflictError{}
		}
		var cur model.Versioned
		_ = attributevalue.UnmarshalMap(existing, &cur)
		if cur.Version != v.Version {
			current := reflect.New(reflect.TypeOf(item).Elem()).Interface().(store.Item)
			_ = attributevalue.UnmarshalMap(existing, current)
			return &store.VersionConflictError{Current: current}
		}
	}
	*v = model.Versioned{Version: v.Version + 1, UpdatedAt: fakeNow, UpdatedBy: by}
	av, err := attributevalue.MarshalMap(item)
	if err != nil {
		return err
	}
	f.items[key] = av
	return nil
}

func (f *fakeStore) Delete(_ context.Context, key model.Key) error {
	if err := f.call("Delete"); err != nil {
		return err
	}
	delete(f.items, key)
	return nil
}

func (f *fakeStore) get(key model.Key, out any) bool {
	av, ok := f.items[key]
	if ok {
		_ = attributevalue.UnmarshalMap(av, out)
	}
	return ok
}

func (f *fakeStore) GetHoliday(_ context.Context, id string) (model.Holiday, error) {
	if err := f.call("GetHoliday"); err != nil {
		return model.Holiday{}, err
	}
	var h model.Holiday
	if !f.get(model.Key{PK: model.HolidayPK(id), SK: model.MetaSK}, &h) {
		return h, store.ErrNotFound
	}
	return h, nil
}

func (f *fakeStore) LoadHoliday(_ context.Context, id string) (model.HolidayFacts, error) {
	if err := f.call("LoadHoliday"); err != nil {
		return model.HolidayFacts{}, err
	}
	var facts model.HolidayFacts
	found := false
	for key := range f.items {
		if key.PK != model.HolidayPK(id) {
			continue
		}
		switch {
		case key.SK == model.MetaSK:
			found = f.get(key, &facts.Holiday)
		case strings.HasPrefix(key.SK, model.MemberPrefix):
			var m model.Member
			f.get(key, &m)
			facts.Members = append(facts.Members, m)
		case strings.HasPrefix(key.SK, model.AttendeePrefix):
			var a model.Attendee
			f.get(key, &a)
			facts.Attendees = append(facts.Attendees, a)
		}
	}
	if !found {
		return model.HolidayFacts{}, store.ErrNotFound
	}
	return facts, nil
}

func (f *fakeStore) IsMember(_ context.Context, id, sub string) (bool, error) {
	if err := f.call("IsMember"); err != nil {
		return false, err
	}
	_, ok := f.items[model.Key{PK: model.HolidayPK(id), SK: model.MemberPrefix + sub}]
	return ok, nil
}

func (f *fakeStore) CountMembers(_ context.Context, id string) (int, error) {
	if err := f.call("CountMembers"); err != nil {
		return 0, err
	}
	n := 0
	for key := range f.items {
		if key.PK == model.HolidayPK(id) && strings.HasPrefix(key.SK, model.MemberPrefix) {
			n++
		}
	}
	return n, nil
}

func (f *fakeStore) CreateHoliday(_ context.Context, h *model.Holiday, by string) error {
	if err := f.call("CreateHoliday"); err != nil {
		return err
	}
	h.SetKeys()
	m := &model.Member{UserSub: by}
	m.SetKeys(h.ID)
	if _, ok := f.items[model.Key{PK: h.PK, SK: h.SK}]; ok {
		return store.ErrAlreadyExists
	}
	if _, ok := f.items[model.Key{PK: m.PK, SK: m.SK}]; ok {
		return store.ErrAlreadyExists
	}
	h.Versioned = model.Versioned{Version: 1, UpdatedAt: fakeNow, UpdatedBy: by}
	m.Versioned = h.Versioned
	f.items[model.Key{PK: h.PK, SK: h.SK}], _ = attributevalue.MarshalMap(h)
	f.items[model.Key{PK: m.PK, SK: m.SK}], _ = attributevalue.MarshalMap(m)
	return nil
}

func (f *fakeStore) ListHolidays(_ context.Context, sub string) ([]model.Holiday, error) {
	if err := f.call("ListHolidays"); err != nil {
		return nil, err
	}
	var out []model.Holiday
	for key := range f.items {
		if key.SK != model.MemberPrefix+sub {
			continue
		}
		var h model.Holiday
		if f.get(model.Key{PK: key.PK, SK: model.MetaSK}, &h) {
			out = append(out, h)
		}
	}
	return out, nil
}

func (f *fakeStore) DeleteHoliday(_ context.Context, id string) error {
	if err := f.call("DeleteHoliday"); err != nil {
		return err
	}
	for key := range f.items {
		if key.PK == model.HolidayPK(id) {
			delete(f.items, key)
		}
	}
	return nil
}

// Seeding helpers.

func (f *fakeStore) addHoliday(id, name, start, end string, members ...string) {
	h := model.Holiday{ID: id, Name: name, TimeZone: "Pacific/Auckland", StartDate: start, EndDate: end,
		Versioned: model.Versioned{Version: 1, UpdatedAt: fakeNow, UpdatedBy: "seed"}}
	h.SetKeys()
	f.items[model.Key{PK: h.PK, SK: h.SK}], _ = attributevalue.MarshalMap(h)
	for _, sub := range members {
		f.addMember(id, sub)
	}
}

func (f *fakeStore) addMember(holidayID, sub string) {
	m := model.Member{UserSub: sub, Versioned: model.Versioned{Version: 1, UpdatedAt: fakeNow, UpdatedBy: "seed"}}
	m.SetKeys(holidayID)
	f.items[model.Key{PK: m.PK, SK: m.SK}], _ = attributevalue.MarshalMap(m)
}

func (f *fakeStore) addAttendee(holidayID, id, name string, version int) {
	a := model.Attendee{ID: id, Name: name, Versioned: model.Versioned{Version: version, UpdatedAt: fakeNow, UpdatedBy: "seed"}}
	a.SetKeys(holidayID)
	f.items[model.Key{PK: a.PK, SK: a.SK}], _ = attributevalue.MarshalMap(a)
}

func (f *fakeStore) has(pk, sk string) bool {
	_, ok := f.items[model.Key{PK: pk, SK: sk}]
	return ok
}

// fixedClock steps by 5 ms per call, so durations are predictable.
func fixedClock() func() time.Time {
	t := time.Date(2026, 11, 28, 0, 0, 0, 0, time.UTC)
	return func() time.Time {
		t = t.Add(5 * time.Millisecond)
		return t
	}
}
