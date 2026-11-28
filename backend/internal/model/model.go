// Package model holds the stored facts (DESIGN §2.2) and the API request
// bodies. Field names are camelCase in JSON and in DynamoDB attributes
// (DESIGN §1). Storage keys are DynamoDB-only and never appear in API JSON.
package model

import "encoding/json"

// Item types, stored in the `type` attribute (DESIGN §4).
const (
	TypeHoliday  = "holiday"
	TypeMember   = "member"
	TypeAttendee = "attendee"
)

// Sort keys and key prefixes (DESIGN §4).
const (
	HolidayPrefix  = "HOLIDAY#"
	MetaSK         = "META"
	MemberPrefix   = "MEMBER#"
	AttendeePrefix = "ATTENDEE#"
	UserPrefix     = "USER#"
)

// HolidayPK is the partition key of a holiday's items.
func HolidayPK(holidayID string) string { return HolidayPrefix + holidayID }

// Key is an item's primary key.
type Key struct {
	PK string
	SK string
}

// StorageKeys are the key attributes every stored item carries. They are
// kept out of API JSON.
type StorageKeys struct {
	PK   string `json:"-" dynamodbav:"PK"`
	SK   string `json:"-" dynamodbav:"SK"`
	Type string `json:"-" dynamodbav:"type"`
}

// Keys returns the item's storage keys. It is promoted to every item that
// embeds StorageKeys.
func (k *StorageKeys) Keys() *StorageKeys { return k }

// Versioned is the optimistic-concurrency metadata on every stored item.
type Versioned struct {
	Version   int    `json:"version" dynamodbav:"version"`
	UpdatedAt string `json:"updatedAt" dynamodbav:"updatedAt"` // ISO 8601, UTC
	UpdatedBy string `json:"updatedBy" dynamodbav:"updatedBy"` // Cognito sub
}

// Versioning returns the item's version metadata. It is promoted to every
// item that embeds Versioned.
func (v *Versioned) Versioning() *Versioned { return v }

// Holiday is a holiday's META item.
type Holiday struct {
	StorageKeys
	ID        string `json:"id" dynamodbav:"id"`
	Name      string `json:"name" dynamodbav:"name"`
	TimeZone  string `json:"timeZone" dynamodbav:"timeZone"`
	StartDate string `json:"startDate" dynamodbav:"startDate"`
	EndDate   string `json:"endDate" dynamodbav:"endDate"`
	Versioned
}

// SetKeys sets the holiday's storage keys from its ID.
func (h *Holiday) SetKeys() {
	h.StorageKeys = StorageKeys{PK: HolidayPK(h.ID), SK: MetaSK, Type: TypeHoliday}
}

// Member is a user's membership of a holiday. Its GSI keys list the user's
// holidays in `gsi1`.
type Member struct {
	StorageKeys
	GSI1PK  string `json:"-" dynamodbav:"GSI1PK,omitempty"`
	GSI1SK  string `json:"-" dynamodbav:"GSI1SK,omitempty"`
	UserSub string `json:"userSub" dynamodbav:"userSub"`
	Versioned
}

// SetKeys sets the member's storage and GSI keys from its sub.
func (m *Member) SetKeys(holidayID string) {
	m.StorageKeys = StorageKeys{PK: HolidayPK(holidayID), SK: MemberPrefix + m.UserSub, Type: TypeMember}
	m.GSI1PK = UserPrefix + m.UserSub
	m.GSI1SK = HolidayPK(holidayID)
}

// Attendee is a person who eats at a holiday, with or without a login.
type Attendee struct {
	StorageKeys
	ID   string `json:"id" dynamodbav:"id"`
	Name string `json:"name" dynamodbav:"name"`
	Versioned
}

// SetKeys sets the attendee's storage keys from its ID.
func (a *Attendee) SetKeys(holidayID string) {
	a.StorageKeys = StorageKeys{PK: HolidayPK(holidayID), SK: AttendeePrefix + a.ID, Type: TypeAttendee}
}

// HolidayFacts is a whole holiday as GET /holidays/{holidayId} returns it:
// the engine's HolidayFacts (DESIGN §3) plus the members. Meals, trips and
// stock changes are opaque until the phases that add them.
type HolidayFacts struct {
	Holiday      Holiday           `json:"holiday"`
	Attendees    []Attendee        `json:"attendees"`
	Meals        []json.RawMessage `json:"meals"`
	Trips        []json.RawMessage `json:"trips"`
	StockChanges []json.RawMessage `json:"stockChanges"`
	Members      []Member          `json:"members"`
}

// MarshalJSON writes nil slices as empty arrays, never null.
func (f HolidayFacts) MarshalJSON() ([]byte, error) {
	type plain HolidayFacts
	p := plain(f)
	p.Attendees = nonNil(p.Attendees)
	p.Meals = nonNil(p.Meals)
	p.Trips = nonNil(p.Trips)
	p.StockChanges = nonNil(p.StockChanges)
	p.Members = nonNil(p.Members)
	return json.Marshal(p)
}

func nonNil[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

// HolidayInput is the body of PUT /holidays/{holidayId}. Version 0 creates.
type HolidayInput struct {
	Name      string `json:"name"`
	TimeZone  string `json:"timeZone"`
	StartDate string `json:"startDate"`
	EndDate   string `json:"endDate"`
	Version   int    `json:"version"`
}

// AttendeeInput is the body of PUT /holidays/{holidayId}/attendees/{id}.
type AttendeeInput struct {
	Name    string `json:"name"`
	Version int    `json:"version"`
}

// MemberInput is the body of PUT /holidays/{holidayId}/members/{userSub}.
// Only version 0 (create) is meaningful.
type MemberInput struct {
	Version int `json:"version"`
}
