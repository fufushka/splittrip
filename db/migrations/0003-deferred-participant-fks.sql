-- Видалення поїздки з витратами падало (500): каскад від trips видаляв учасників раніше,
-- ніж частки, що на них посилаються, і FK `expense_shares → participants` спрацьовував
-- посеред каскаду. Знайдено сухим прогоном scripts/cloud-run.ts; 0001 уже застосовано в
-- хмарі, тому — нова міграція (ADR-0020).
--
-- FK на учасника перевіряються на коміті: на той момент каскад уже прибрав частки й
-- перекази. I5 не слабшає: пряме видалення згаданого учасника однаково відхиляється на
-- коміті з 23503 (тест «учасника не видалити й напряму»).

alter table expenses
  alter constraint expenses_trip_id_payer_id_fkey deferrable initially deferred;
alter table expense_shares
  alter constraint expense_shares_trip_id_participant_id_fkey deferrable initially deferred;
alter table transfers
  alter constraint transfers_trip_id_from_id_fkey deferrable initially deferred;
alter table transfers
  alter constraint transfers_trip_id_to_id_fkey deferrable initially deferred;
