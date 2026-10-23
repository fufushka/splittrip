/**
 * `TripRepository` на Postgres (contract.md, розд. 2; ADR-0018). Агрегат — 4 запити за
 * `trip_id` незалежно від розміру (без N+1); зміна — одна транзакція з `FOR UPDATE`,
 * збереження різниці пакетними запитами на таблицю, не рядок за рядком.
 */
import { currentUser, log } from '../../context/index.ts';
import { money } from '../../money/index.ts';
import type {
  Expense,
  Participant,
  SplitMode,
  Transfer,
  Trip,
  TripHeader,
  TripRepository,
  TripStatus,
} from '../../trips/index.ts';
import { type Sql, type Tx, transaction } from './client.ts';

interface TripRow {
  id: string;
  owner_id: string;
  name: string;
  currency: string;
  status: TripStatus;
  closed_at: Date | null;
  created_at: Date;
}

interface ExpenseShareRow {
  id: string;
  payer_id: string;
  amount: string;
  split_mode: SplitMode;
  description: string;
  participant_id: string;
  share_amount: string;
}

interface TransferRow {
  id: string;
  from_id: string;
  to_id: string;
  amount: string;
}

function header(row: TripRow): TripHeader {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    currency: row.currency,
    status: row.status,
    closedAt: row.closed_at,
    createdAt: row.created_at,
  };
}

/** Рядки «витрата × частка» (впорядковані за витратою) → витрати з частками. */
function groupExpenses(rows: readonly ExpenseShareRow[]): Expense[] {
  const expenses: Expense[] = [];
  for (const row of rows) {
    let last = expenses.at(-1);
    if (last?.id !== row.id) {
      last = {
        id: row.id,
        payerId: row.payer_id,
        amount: money(Number(row.amount)),
        splitMode: row.split_mode,
        description: row.description,
        shares: [],
      };
      expenses.push(last);
    }
    (last.shares as Expense['shares'][number][]).push({
      participantId: row.participant_id,
      amount: money(Number(row.share_amount)),
    });
  }
  return expenses;
}

async function load(tx: Tx, id: string, lock: boolean): Promise<Trip | null> {
  const [row] = lock
    ? await tx<TripRow[]>`select * from trips where id = ${id} for update`
    : await tx<TripRow[]>`select * from trips where id = ${id}`;
  if (row === undefined) return null;
  const [participants, expenseRows, transferRows] = await Promise.all([
    tx<Participant[]>`
      select id, name, position from participants where trip_id = ${id} order by position`,
    tx<ExpenseShareRow[]>`
      select e.id, e.payer_id, e.amount, e.split_mode, e.description,
             s.participant_id, s.amount as share_amount
        from expenses e
        join expense_shares s on s.expense_id = e.id
        join participants p on p.trip_id = s.trip_id and p.id = s.participant_id
       where e.trip_id = ${id}
       order by e.id, p.position`,
    tx<TransferRow[]>`
      select id, from_id, to_id, amount from transfers where trip_id = ${id} order by id`,
  ]);
  return {
    ...header(row),
    participants: participants.map((p) => ({ id: p.id, name: p.name, position: p.position })),
    expenses: groupExpenses(expenseRows),
    transfers: transferRows.map((t): Transfer => ({
      id: t.id,
      fromId: t.from_id,
      toId: t.to_id,
      amount: money(Number(t.amount)),
    })),
  };
}

function byId<T extends { readonly id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

const sameExpense = (a: Expense, b: Expense): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Різниця «до → після» за id; порядок запитів поважає FK. */
async function saveChanges(tx: Tx, before: Trip, after: Trip): Promise<void> {
  const tripId = after.id;
  const added = <T extends { readonly id: string }>(prev: readonly T[], next: readonly T[]) => {
    const old = byId(prev);
    return next.filter((item) => !old.has(item.id));
  };
  const removed = <T extends { readonly id: string }>(prev: readonly T[], next: readonly T[]) =>
    added(next, prev).map((item) => item.id);

  const oldExpenses = byId(before.expenses);
  const changedExpenses = after.expenses.filter((e) => {
    const old = oldExpenses.get(e.id);
    return old !== undefined && !sameExpense(old, e);
  });
  const newExpenses = added(before.expenses, after.expenses);

  const deletedTransfers = removed(before.transfers, after.transfers);
  if (deletedTransfers.length > 0) {
    await tx`delete from transfers where id in ${tx(deletedTransfers)}`;
  }
  const deletedExpenses = removed(before.expenses, after.expenses);
  if (deletedExpenses.length > 0) {
    await tx`delete from expenses where id in ${tx(deletedExpenses)}`;
  }
  if (changedExpenses.length > 0) {
    await tx`delete from expense_shares where expense_id in ${tx(changedExpenses.map((e) => e.id))}`;
  }
  const deletedParticipants = removed(before.participants, after.participants);
  if (deletedParticipants.length > 0) {
    await tx`delete from participants where id in ${tx(deletedParticipants)}`;
  }
  if (
    before.name !== after.name ||
    before.status !== after.status ||
    before.closedAt?.getTime() !== after.closedAt?.getTime()
  ) {
    await tx`update trips set name = ${after.name}, status = ${after.status},
                     closed_at = ${after.closedAt} where id = ${tripId}`;
  }
  const newParticipants = added(before.participants, after.participants);
  if (newParticipants.length > 0) {
    const rows = newParticipants.map((p) => ({ ...p, trip_id: tripId }));
    await tx`insert into participants ${tx(rows, 'id', 'trip_id', 'name', 'position')}`;
  }
  // Заміна витрати (PUT) — по одному UPDATE на витрату; за сценарієм вона одна.
  for (const e of changedExpenses) {
    await tx`update expenses set payer_id = ${e.payerId}, amount = ${e.amount},
                     split_mode = ${e.splitMode}, description = ${e.description}
              where id = ${e.id}`;
  }
  if (newExpenses.length > 0) {
    const rows = newExpenses.map((e) => ({
      id: e.id,
      trip_id: tripId,
      payer_id: e.payerId,
      amount: e.amount,
      split_mode: e.splitMode,
      description: e.description,
    }));
    await tx`insert into expenses ${tx(rows, 'id', 'trip_id', 'payer_id', 'amount', 'split_mode', 'description')}`;
  }
  const shares = [...changedExpenses, ...newExpenses].flatMap((e) =>
    e.shares.map((s) => ({
      trip_id: tripId,
      expense_id: e.id,
      participant_id: s.participantId,
      amount: s.amount,
    })),
  );
  if (shares.length > 0) {
    await tx`insert into expense_shares ${tx(shares, 'trip_id', 'expense_id', 'participant_id', 'amount')}`;
  }
  const newTransfers = added(before.transfers, after.transfers);
  if (newTransfers.length > 0) {
    const rows = newTransfers.map((t) => ({
      id: t.id,
      trip_id: tripId,
      from_id: t.fromId,
      to_id: t.toId,
      amount: t.amount,
    }));
    await tx`insert into transfers ${tx(rows, 'id', 'trip_id', 'from_id', 'to_id', 'amount')}`;
  }
}

export function createPostgresTripRepository(sql: Sql): TripRepository {
  return {
    async create(trip) {
      await transaction(sql, async (tx) => {
        // Повтор після обриву на COMMIT (результат невідомий) не дає 23505: та сама поїздка
        // вже є — успіх; чужа з тим самим id — неможлива за UUIDv7 (spec-fix-04, п. 4).
        const inserted = await tx`
          insert into trips (id, owner_id, name, currency, status, closed_at, created_at)
          values (${trip.id}, ${trip.ownerId}, ${trip.name}, ${trip.currency},
                  ${trip.status}, ${trip.closedAt}, ${trip.createdAt})
          on conflict (id) do nothing
          returning 1`;
        if (inserted.length > 0) return;
        const [existing] = await tx<{ owner_id: string }[]>`
          select owner_id from trips where id = ${trip.id}`;
        if (existing?.owner_id !== trip.ownerId) {
          throw new Error(`Інваріант: id поїздки ${trip.id} уже зайнятий іншим власником`);
        }
      });
      log.debug({ tripId: trip.id }, 'storage(postgres): create');
    },

    findById(id) {
      log.debug({ tripId: id }, 'storage(postgres): findById');
      // Знімок: 4 запити агрегату бачать один і той самий стан.
      return transaction(
        sql,
        (tx) => load(tx, id, false),
        'isolation level repeatable read read only',
      );
    },

    async list({ limit, cursor }) {
      const owner = currentUser();
      const rows = await transaction(
        sql,
        (tx) => tx<TripRow[]>`
          select id, owner_id, name, currency, status, closed_at, created_at
            from trips
           where owner_id = ${owner} ${cursor === undefined ? tx`` : tx`and id < ${cursor}`}
           order by id desc
           limit ${limit}`,
        'read only',
      );
      log.debug({ count: rows.length }, 'storage(postgres): list');
      return rows.map(header);
    },

    async update(id, mutate) {
      const next = await transaction(sql, async (tx) => {
        const before = await load(tx, id, true);
        const after = mutate(before);
        if (before === null)
          throw new Error(`Інваріант: mutate повернула поїздку для відсутнього ${id}`);
        await saveChanges(tx, before, after);
        return after;
      });
      log.debug({ tripId: id }, 'storage(postgres): update');
      return next;
    },

    async delete(id) {
      await transaction(sql, async (tx) => {
        await tx`delete from trips where id = ${id}`;
      });
      log.debug({ tripId: id }, 'storage(postgres): delete');
    },
  };
}
