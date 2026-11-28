// The holidays I belong to (DESIGN §7.2 `/`): `GET /holidays`, and creating
// one. Creates follow §5.3's retry rules: network errors and 5xx retry, and an
// `already-exists` is our own earlier attempt if the stored holiday matches.
import { api, ApiError, type ApiClient, type Schemas } from '#lib/api/client.js';
import { session } from './session.svelte.js';
import { withRetry, type RetryOptions } from './holiday.svelte.js';

export type Holiday = Schemas['Holiday'];

/** What the create form sets. */
export type HolidayFields = Pick<Holiday, 'name' | 'timeZone' | 'startDate' | 'endDate'>;

export type MyHolidaysStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MyHolidaysOptions extends RetryOptions {
  readonly api: ApiClient;
}

const byStart = (a: Holiday, b: Holiday) =>
  a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name);

const sameFields = (holiday: Holiday, fields: HolidayFields) =>
  holiday.name === fields.name &&
  holiday.timeZone === fields.timeZone &&
  holiday.startDate === fields.startDate &&
  holiday.endDate === fields.endDate;

export class MyHolidays {
  list = $state.raw<readonly Holiday[]>([]);
  status = $state<MyHolidaysStatus>('idle');
  error = $state.raw<unknown>(null);

  readonly #api: ApiClient;
  readonly #retry: RetryOptions;
  #seq = 0;

  constructor(options: MyHolidaysOptions) {
    this.#api = options.api;
    this.#retry = { delays: options.delays, sleep: options.sleep };
  }

  /** Fetches the list. A failure sets `status` to `error` rather than rejecting. */
  async load(): Promise<void> {
    const seq = ++this.#seq;
    this.status = 'loading';
    this.error = null;
    try {
      const { holidays } = await withRetry(() => this.#api.get('/holidays'), this.#retry);
      if (seq !== this.#seq) return;
      this.list = holidays.toSorted(byStart);
      this.status = 'ready';
    } catch (error) {
      if (seq !== this.#seq) return;
      this.error = error;
      this.status = 'error';
    }
  }

  /** Creates a holiday with the given (UUIDv7) id. Resolves with it as stored; rejects with the `ApiError` or `NetworkError`. */
  async create(holidayId: string, fields: HolidayFields): Promise<Holiday> {
    let created: Holiday;
    try {
      created = await withRetry(
        () => this.#api.put('/holidays/{holidayId}', { holidayId }, { ...fields, version: 0 }),
        this.#retry
      );
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'already-exists')) throw error;
      const { holiday } = await withRetry(
        () => this.#api.get('/holidays/{holidayId}', { holidayId }),
        this.#retry
      );
      if (!sameFields(holiday, fields)) throw error;
      created = holiday;
    }
    this.list = [...this.list.filter((holiday) => holiday.id !== created.id), created].toSorted(
      byStart
    );
    return created;
  }

  /** Forgets the list, e.g. on sign-out. */
  clear() {
    this.#seq++;
    this.list = [];
    this.status = 'idle';
    this.error = null;
  }
}

export const myHolidays = new MyHolidays({ api });
session.onSignOut(() => myHolidays.clear());
