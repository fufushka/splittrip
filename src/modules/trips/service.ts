/**
 * Сервіс поїздок: сценарії й доступ власника (spec, «Шари і контекст»). Не знає HTTP, SQL і
 * транзакцій; ініціатора бере з `context`, сховище — з фабрики (ADR-0016).
 */
import type { Balance, SuggestedTransfer } from '../balances/index.ts';
import { currentUser, log } from '../context/index.ts';
import { uuidv7 } from '../ids/index.ts';
import * as domain from './domain.ts';
import type { ExpenseInput, TransferInput } from './domain.ts';
import { NotFoundError } from './errors.ts';
import type {
  Expense,
  Participant,
  Transfer,
  Trip,
  TripHeader,
  TripPage,
  TripRepository,
} from './model.ts';

export interface TripService {
  create(input: { name: string; currency: string }): Promise<Trip>;
  list(page: TripPage): Promise<TripHeader[]>;
  get(tripId: string): Promise<Trip>;
  remove(tripId: string): Promise<void>;
  addParticipant(tripId: string, name: string): Promise<Participant>;
  removeParticipant(tripId: string, participantId: string): Promise<void>;
  addExpense(tripId: string, input: ExpenseInput): Promise<Expense>;
  replaceExpense(tripId: string, expenseId: string, input: ExpenseInput): Promise<Expense>;
  removeExpense(tripId: string, expenseId: string): Promise<void>;
  addTransfer(tripId: string, input: TransferInput): Promise<Transfer>;
  removeTransfer(tripId: string, transferId: string): Promise<void>;
  balances(tripId: string): Promise<Balance[]>;
  settlements(tripId: string): Promise<SuggestedTransfer[]>;
  close(tripId: string): Promise<Trip>;
}

export interface TripServiceDeps {
  readonly repo: TripRepository;
  readonly now?: () => Date;
}

/** Чужа й неіснуюча поїздка — однаковий `404`, щоб не видавати існування id (005, п. 2). */
function owned(trip: Trip | null, tripId: string): Trip {
  if (trip?.ownerId !== currentUser()) {
    throw new NotFoundError('trip_not_found', `Поїздки ${tripId} немає`);
  }
  return trip;
}

function found<T extends { readonly id: string }>(items: readonly T[], id: string): T {
  const item = items.find((i) => i.id === id);
  if (item === undefined) throw new Error(`Інваріант: ${id} мав з'явитися в агрегаті`);
  return item;
}

export function createTripService({ repo, now = () => new Date() }: TripServiceDeps): TripService {
  const get = async (tripId: string): Promise<Trip> => owned(await repo.findById(tripId), tripId);

  /** Зміна агрегату: доступ перевіряється першим кроком `mutate`, у тій самій транзакції. */
  const change = async (
    tripId: string,
    op: string,
    mutate: (trip: Trip) => Trip,
  ): Promise<Trip> => {
    const trip = await repo.update(tripId, (current) => mutate(owned(current, tripId)));
    log.info({ tripId, op }, 'trip changed');
    return trip;
  };

  return {
    async create({ name, currency }) {
      const createdAt = now();
      const trip: Trip = {
        id: uuidv7(createdAt.getTime()),
        ownerId: currentUser(),
        name,
        currency,
        status: 'open',
        closedAt: null,
        createdAt,
        participants: [],
        expenses: [],
        transfers: [],
      };
      await repo.create(trip);
      log.info({ tripId: trip.id }, 'trip created');
      return trip;
    },

    list: (page) => repo.list(page),

    get,

    async remove(tripId) {
      await get(tripId);
      await repo.delete(tripId);
      log.info({ tripId }, 'trip deleted');
    },

    async addParticipant(tripId, name) {
      const id = uuidv7();
      const trip = await change(tripId, 'addParticipant', (t) =>
        domain.addParticipant(t, id, name),
      );
      return found(trip.participants, id);
    },

    async removeParticipant(tripId, participantId) {
      await change(tripId, 'removeParticipant', (t) => domain.removeParticipant(t, participantId));
    },

    async addExpense(tripId, input) {
      const id = uuidv7();
      const trip = await change(tripId, 'addExpense', (t) => domain.addExpense(t, id, input));
      return found(trip.expenses, id);
    },

    async replaceExpense(tripId, expenseId, input) {
      const trip = await change(tripId, 'replaceExpense', (t) =>
        domain.replaceExpense(t, expenseId, input),
      );
      return found(trip.expenses, expenseId);
    },

    async removeExpense(tripId, expenseId) {
      await change(tripId, 'removeExpense', (t) => domain.removeExpense(t, expenseId));
    },

    async addTransfer(tripId, input) {
      const id = uuidv7();
      const trip = await change(tripId, 'addTransfer', (t) => domain.addTransfer(t, id, input));
      return found(trip.transfers, id);
    },

    async removeTransfer(tripId, transferId) {
      await change(tripId, 'removeTransfer', (t) => domain.removeTransfer(t, transferId));
    },

    balances: async (tripId) => domain.balancesOf(await get(tripId)),

    settlements: async (tripId) => domain.settlementsOf(await get(tripId)),

    close(tripId) {
      const closedAt = now();
      return change(tripId, 'close', (t) => domain.closeTrip(t, closedAt));
    },
  };
}
