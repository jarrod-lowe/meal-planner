// Package store is all DynamoDB access (DESIGN §4). Handlers use the Store
// interface; DynamoDB implements it.
package store

import (
	"context"
	"errors"

	"github.com/jarrod-lowe/meal-planner/backend/internal/model"
)

// GSI1 is the index that lists a user's holidays.
const GSI1 = "gsi1"

var (
	// ErrNotFound means the item doesn't exist.
	ErrNotFound = errors.New("not found")
	// ErrAlreadyExists means a create (version 0) found the item already
	// stored.
	ErrAlreadyExists = errors.New("already exists")
	// ErrVersionConflict means an update's expected version didn't match.
	// The error is a *VersionConflictError carrying the stored item.
	ErrVersionConflict = errors.New("version conflict")
)

// VersionConflictError is returned when an update's expected version isn't
// the stored one. It matches ErrVersionConflict with errors.Is.
type VersionConflictError struct {
	// Current is the stored item, of the same type as the one written, or
	// nil when the item doesn't exist.
	Current Item
}

func (e *VersionConflictError) Error() string { return ErrVersionConflict.Error() }

// Is makes errors.Is(err, ErrVersionConflict) true.
func (e *VersionConflictError) Is(target error) bool { return target == ErrVersionConflict }

// Item is a stored item: a pointer to a model struct that embeds
// model.StorageKeys and model.Versioned.
type Item interface {
	Keys() *model.StorageKeys
	Versioning() *model.Versioned
}

// Store is what the handlers need from storage.
type Store interface {
	// Put writes item with a version condition. The item's Version is the
	// expected one: 0 creates (ErrAlreadyExists if it exists); anything else
	// must match the stored version (else a *VersionConflictError). On
	// success the item's Version, UpdatedAt and UpdatedBy are the stored
	// values.
	Put(ctx context.Context, item Item, by string) error
	// Delete removes an item. Deleting a missing item succeeds.
	Delete(ctx context.Context, key model.Key) error
	// GetHoliday returns a holiday's META item, or ErrNotFound.
	GetHoliday(ctx context.Context, holidayID string) (model.Holiday, error)
	// LoadHoliday returns every item in a holiday, or ErrNotFound when it
	// has no META item.
	LoadHoliday(ctx context.Context, holidayID string) (model.HolidayFacts, error)
	// IsMember reports whether sub is a member of the holiday.
	IsMember(ctx context.Context, holidayID, sub string) (bool, error)
	// CountMembers returns the number of the holiday's members.
	CountMembers(ctx context.Context, holidayID string) (int, error)
	// CreateHoliday writes the holiday's META (version 1) and makes `by` its
	// first member, in one transaction. ErrAlreadyExists if either exists.
	CreateHoliday(ctx context.Context, h *model.Holiday, by string) error
	// ListHolidays returns the holidays sub is a member of, in no particular
	// order. Memberships whose holiday is gone are skipped.
	ListHolidays(ctx context.Context, sub string) ([]model.Holiday, error)
	// DeleteHoliday deletes every item in the holiday. Deleting a missing
	// holiday succeeds.
	DeleteHoliday(ctx context.Context, holidayID string) error
}

// Deletable is a catalogue item, which is soft-deleted (DESIGN §2.3).
type Deletable interface {
	Item
	// SetKeys sets the storage keys from the item's ID.
	SetKeys()
	// Deletion returns the item's soft-delete flag.
	Deletion() *bool
}

// CatalogueStore is what the catalogue handler needs from storage.
type CatalogueStore interface {
	// Put is Store.Put.
	Put(ctx context.Context, item Item, by string) error
	// LoadCatalogue returns every recipe and ingredient, soft-deleted ones
	// included.
	LoadCatalogue(ctx context.Context) (model.Catalogue, error)
	// SoftDelete sets the item's `deleted` flag and bumps its version,
	// retrying when another write gets in first. Only the item's ID needs
	// to be set; on success it holds the stored item. Deleting an item
	// that is already deleted succeeds without a write; a missing item is
	// ErrNotFound.
	SoftDelete(ctx context.Context, item Deletable, by string) error
}
