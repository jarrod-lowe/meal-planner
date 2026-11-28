// An in-memory stand-in for the holidays, meals, users and catalogue API (DESIGN §5),
// served through Playwright route interception. It keeps versions, membership,
// the last-member rule and soft deletes like the Lambdas do, and can be told to
// fail a request with a version conflict.
import type { Page, Route } from '@playwright/test';
import type { components } from '../../src/lib/api/types.js';

type Schemas = components['schemas'];
type Holiday = Schemas['Holiday'];
type Attendee = Schemas['Attendee'];
type Member = Schemas['Member'];
type User = Schemas['User'];
type Recipe = Schemas['Recipe'];
type Ingredient = Schemas['Ingredient'];
type Meal = Schemas['Meal'];

export interface SeedCatalogue {
  readonly recipes?: readonly (Omit<Recipe, 'version' | 'updatedAt' | 'updatedBy'> &
    Partial<Recipe>)[];
  readonly ingredients?: readonly (Omit<Ingredient, 'version' | 'updatedAt' | 'updatedBy'> &
    Partial<Ingredient>)[];
}

interface StoredHoliday {
  holiday: Holiday;
  attendees: Map<string, Attendee>;
  meals: Map<string, Meal>;
  members: Map<string, Member>;
}

interface ForcedConflict {
  readonly method: string;
  readonly path: string;
  readonly current: unknown;
}

export interface SeedHoliday {
  readonly holiday: Pick<Holiday, 'id' | 'name' | 'timeZone' | 'startDate' | 'endDate'> &
    Partial<Holiday>;
  readonly attendees?: readonly (Pick<Attendee, 'id' | 'name'> & Partial<Attendee>)[];
  readonly meals?: readonly (Omit<Meal, 'version' | 'updatedAt' | 'updatedBy'> & Partial<Meal>)[];
  /** Member subs. */
  readonly members: readonly string[];
}

const stamp = { updatedAt: '2026-11-28T00:00:00Z', updatedBy: 'seed' };

/** The fake auth's ID token is `fake.<sub>.token` (src/lib/auth/fake.ts). */
function callerOf(route: Route): string | null {
  const token = route.request().headers()['authorization'] ?? '';
  return /^fake\.(.+)\.token$/.exec(token)?.[1] ?? null;
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const fail = (route: Route, status: number, code: string, extra: object = {}) =>
  json(route, status, { error: { code, message: code }, ...extra });

export class MockApi {
  readonly holidays = new Map<string, StoredHoliday>();
  users: User[] = [];
  /** The shared catalogue, hidden items included. */
  readonly catalogue = {
    recipes: new Map<string, Recipe>(),
    ingredients: new Map<string, Ingredient>()
  };
  /** Every request the app made, as `METHOD /path` (without `/api`). */
  readonly requests: string[] = [];
  #conflicts: ForcedConflict[] = [];

  /** Adds a holiday, with version-1 items. */
  seed({ holiday, attendees = [], meals = [], members }: SeedHoliday) {
    this.holidays.set(holiday.id, {
      holiday: { version: 1, ...stamp, ...holiday },
      attendees: new Map(attendees.map((a) => [a.id, { version: 1, ...stamp, ...a }])),
      meals: new Map(meals.map((m) => [m.id, { version: 1, ...stamp, ...m }])),
      members: new Map(members.map((sub) => [sub, { userSub: sub, version: 1, ...stamp }]))
    });
  }

  /** Adds catalogue items, at version 1. */
  seedCatalogue({ recipes = [], ingredients = [] }: SeedCatalogue) {
    for (const recipe of recipes) {
      this.catalogue.recipes.set(recipe.id, { version: 1, ...stamp, ...recipe });
    }
    for (const ingredient of ingredients) {
      this.catalogue.ingredients.set(ingredient.id, { version: 1, ...stamp, ...ingredient });
    }
  }

  /** The next `method path` request gets `409 version-conflict` with `current`. */
  conflictNext(method: string, path: string, current: unknown) {
    this.#conflicts.push({ method, path, current });
  }

  async install(page: Page) {
    await page.route(
      (url) => url.pathname.startsWith('/api/'),
      (route) => this.#handle(route)
    );
  }

  facts(id: string): Schemas['HolidayFacts'] | undefined {
    const stored = this.holidays.get(id);
    if (!stored) return undefined;
    return {
      holiday: stored.holiday,
      attendees: [...stored.attendees.values()],
      meals: [...stored.meals.values()],
      trips: [],
      stockChanges: [],
      members: [...stored.members.values()]
    };
  }

  async #handle(route: Route) {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    this.requests.push(`${method} ${path}`);

    const sub = callerOf(route);
    if (!sub) return json(route, 401, { message: 'Unauthorized' });

    const conflict = this.#conflicts.findIndex((c) => c.method === method && c.path === path);
    if (conflict !== -1) {
      const [{ current }] = this.#conflicts.splice(conflict, 1) as [ForcedConflict];
      return fail(route, 409, 'version-conflict', { current });
    }

    const body: unknown = request.postData() ? request.postDataJSON() : undefined;
    const parts = path.split('/').filter(Boolean);

    if (method === 'GET' && path === '/users') return json(route, 200, { users: this.users });
    if (parts[0] === 'catalogue') return this.#catalogue(route, method, parts, body, sub);
    if (parts[0] !== 'holidays') return fail(route, 404, 'not-found');
    if (parts.length === 1 && method === 'GET') {
      const mine = [...this.holidays.values()].filter((h) => h.members.has(sub));
      return json(route, 200, { holidays: mine.map((h) => h.holiday) });
    }

    const holidayId = parts[1] ?? '';
    const stored = this.holidays.get(holidayId);
    const now = { updatedAt: new Date().toISOString(), updatedBy: sub };

    // Creating a holiday is the one route that doesn't need membership.
    if (parts.length === 2 && method === 'PUT' && !stored) {
      const input = body as Schemas['HolidayInput'];
      if (input.version !== 0) return fail(route, 409, 'version-conflict', { current: null });
      const { name, timeZone, startDate, endDate } = input;
      const holiday: Holiday = {
        id: holidayId,
        name,
        timeZone,
        startDate,
        endDate,
        version: 1,
        ...now
      };
      this.holidays.set(holidayId, {
        holiday,
        attendees: new Map(),
        meals: new Map(),
        members: new Map([[sub, { userSub: sub, version: 1, ...now }]])
      });
      return json(route, 200, holiday);
    }

    if (!stored) return fail(route, 404, 'not-found');
    if (!stored.members.has(sub)) return fail(route, 403, 'not-a-member');

    if (parts.length === 2) {
      if (method === 'GET') return json(route, 200, this.facts(holidayId));
      if (method === 'DELETE') {
        this.holidays.delete(holidayId);
        return route.fulfill({ status: 204 });
      }
      if (method === 'PUT') {
        const input = body as Schemas['HolidayInput'];
        if (input.version === 0) return fail(route, 409, 'already-exists');
        if (input.version !== stored.holiday.version) {
          return fail(route, 409, 'version-conflict', { current: stored.holiday });
        }
        const { name, timeZone, startDate, endDate } = input;
        stored.holiday = {
          ...stored.holiday,
          ...{ name, timeZone, startDate, endDate },
          version: input.version + 1,
          ...now
        };
        return json(route, 200, stored.holiday);
      }
    }

    const [, , kind, id = ''] = parts;
    if (kind === 'members' && parts.length === 4) {
      if (method === 'PUT') {
        if (stored.members.has(id)) return fail(route, 409, 'already-exists');
        const member: Member = { userSub: id, version: 1, ...now };
        stored.members.set(id, member);
        return json(route, 200, member);
      }
      if (method === 'DELETE') {
        if (stored.members.has(id) && stored.members.size === 1) {
          return fail(route, 409, 'last-member');
        }
        stored.members.delete(id);
        return route.fulfill({ status: 204 });
      }
    }

    if (kind === 'attendees' && parts.length === 4) {
      const existing = stored.attendees.get(id);
      if (method === 'PUT') {
        const input = body as Schemas['AttendeeInput'];
        if (input.version === 0 && existing) return fail(route, 409, 'already-exists');
        if (input.version !== (existing?.version ?? 0)) {
          return fail(route, 409, 'version-conflict', { current: existing ?? null });
        }
        const attendee: Attendee = { id, name: input.name, version: input.version + 1, ...now };
        stored.attendees.set(id, attendee);
        return json(route, 200, attendee);
      }
      if (method === 'DELETE') {
        stored.attendees.delete(id);
        return route.fulfill({ status: 204 });
      }
    }

    if (kind === 'meals' && parts.length === 4) {
      const existing = stored.meals.get(id);
      if (method === 'PUT') {
        const { version, ...input } = body as Schemas['MealInput'];
        if (version === 0 && existing) return fail(route, 409, 'already-exists');
        if (version !== (existing?.version ?? 0)) {
          return fail(route, 409, 'version-conflict', { current: existing ?? null });
        }
        // The Lambda stores mealtimes sorted by `at`.
        const mealtimes = [...input.mealtimes].sort((a, b) => a.at.localeCompare(b.at));
        const meal: Meal = { ...input, mealtimes, id, version: version + 1, ...now };
        stored.meals.set(id, meal);
        return json(route, 200, meal);
      }
      if (method === 'DELETE') {
        stored.meals.delete(id);
        return route.fulfill({ status: 204 });
      }
    }

    return fail(route, 400, 'validation');
  }

  /** `GET /catalogue`, `PUT /catalogue/{kind}/{id}` and the soft `DELETE` (PHASE_3 "Decisions"). */
  #catalogue(route: Route, method: string, parts: string[], body: unknown, sub: string) {
    const now = { updatedAt: new Date().toISOString(), updatedBy: sub };
    if (parts.length === 1 && method === 'GET') {
      return json(route, 200, {
        recipes: [...this.catalogue.recipes.values()],
        ingredients: [...this.catalogue.ingredients.values()]
      });
    }
    const [, kind, id = ''] = parts;
    if (parts.length !== 3 || (kind !== 'recipes' && kind !== 'ingredients')) {
      return fail(route, 404, 'not-found');
    }
    const items: Map<string, Recipe | Ingredient> = this.catalogue[kind];
    const existing = items.get(id);
    if (method === 'PUT') {
      const { version, ...fields } = body as Schemas['RecipeInput'] | Schemas['IngredientInput'];
      if (version === 0 && existing) return fail(route, 409, 'already-exists');
      if (version !== (existing?.version ?? 0)) {
        return fail(route, 409, 'version-conflict', { current: existing ?? null });
      }
      const item: Recipe | Ingredient = { ...fields, id, version: version + 1, ...now };
      items.set(id, item);
      return json(route, 200, item);
    }
    if (method === 'DELETE') {
      if (!existing) return fail(route, 404, 'not-found');
      if (!existing.deleted) {
        items.set(id, { ...existing, deleted: true, version: existing.version + 1, ...now });
      }
      return route.fulfill({ status: 204 });
    }
    return fail(route, 400, 'validation');
  }
}
