-- 015 — enforce MEA financial invariants inside PostgreSQL, not solely in Node.
-- SERIALIZE competing expense/allocation operations on the same monthly budget.
-- Keep existing data intact; refuse the migration if it already violates caps.
SET search_path TO marketing, public;

CREATE OR REPLACE FUNCTION marketing.enforce_expense_budget() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_month date;
  v_company_id uuid;
  v_company_limit numeric;
  v_allocation_id uuid;
  v_allocation_limit numeric;
  v_company_committed numeric;
  v_employee_committed numeric;
BEGIN
  IF TG_OP='UPDATE' AND OLD.status<>'Pending' AND
     (OLD.amount_pkr IS DISTINCT FROM NEW.amount_pkr OR
      OLD.occurred_on IS DISTINCT FROM NEW.occurred_on OR
      OLD.owner_id IS DISTINCT FROM NEW.owner_id OR
      OLD.subcategory_id IS DISTINCT FROM NEW.subcategory_id OR
      OLD.employee_allocation_id IS DISTINCT FROM NEW.employee_allocation_id) THEN
    RAISE EXCEPTION 'Submitted expenses cannot be edited' USING ERRCODE='P0001';
  END IF;
  IF NEW.status NOT IN ('Pending','In Review','Approved') THEN RETURN NEW; END IF;
  v_month := date_trunc('month', NEW.occurred_on)::date;
  -- One consistent lock order: company budget, then employee allocation.
  SELECT id, amount_pkr INTO v_company_id, v_company_limit
    FROM marketing.monthly_budgets
   WHERE month=v_month AND subcategory_id=NEW.subcategory_id FOR UPDATE;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No company budget for this expense month/category' USING ERRCODE='P0001';
  END IF;
  SELECT id, amount_pkr INTO v_allocation_id, v_allocation_limit
    FROM marketing.employee_allocations
   WHERE id=NEW.employee_allocation_id AND user_id=NEW.owner_id
     AND subcategory_id=NEW.subcategory_id AND month=v_month FOR UPDATE;
  IF v_allocation_id IS NULL THEN
    RAISE EXCEPTION 'Expense must use an employee allocation for same owner/month/subcategory' USING ERRCODE='P0001';
  END IF;
  -- Locks above serialize inserts for this monthly budget; exclude the row
  -- being updated so an edit does not double-count its previous value.
  SELECT COALESCE(SUM(amount_pkr),0) INTO v_company_committed
    FROM marketing.expenses
   WHERE occurred_on >= v_month AND occurred_on < (v_month+interval '1 month')
     AND subcategory_id=NEW.subcategory_id AND status IN ('Pending','In Review','Approved')
     AND id<>NEW.id;
  SELECT COALESCE(SUM(amount_pkr),0) INTO v_employee_committed
    FROM marketing.expenses
   WHERE occurred_on >= v_month AND occurred_on < (v_month+interval '1 month')
     AND subcategory_id=NEW.subcategory_id AND owner_id=NEW.owner_id
     AND status IN ('Pending','In Review','Approved') AND id<>NEW.id;
  IF v_company_committed + NEW.amount_pkr > v_company_limit THEN
    RAISE EXCEPTION 'Company monthly budget exceeded' USING ERRCODE='P0001';
  END IF;
  IF v_employee_committed + NEW.amount_pkr > v_allocation_limit THEN
    RAISE EXCEPTION 'Employee monthly allocation exceeded' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_expense_budget_trigger ON marketing.expenses;
CREATE TRIGGER enforce_expense_budget_trigger BEFORE INSERT OR UPDATE OF
  amount_pkr, occurred_on, owner_id, subcategory_id, employee_allocation_id, status
ON marketing.expenses FOR EACH ROW EXECUTE FUNCTION marketing.enforce_expense_budget();

CREATE OR REPLACE FUNCTION marketing.enforce_allocation_budget() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
 v_company_limit numeric;
 v_allocated numeric;
 v_committed numeric;
BEGIN
 SELECT amount_pkr INTO v_company_limit FROM marketing.monthly_budgets
  WHERE month=NEW.month AND subcategory_id=NEW.subcategory_id FOR UPDATE;
 IF v_company_limit IS NULL THEN
   RAISE EXCEPTION 'Create a company budget first' USING ERRCODE='P0001';
 END IF;
 SELECT COALESCE(SUM(amount_pkr),0) INTO v_allocated FROM marketing.employee_allocations
  WHERE month=NEW.month AND subcategory_id=NEW.subcategory_id AND id<>NEW.id;
 IF v_allocated + NEW.amount_pkr > v_company_limit THEN
   RAISE EXCEPTION 'Total employee allocations exceed company budget' USING ERRCODE='P0001';
 END IF;
 SELECT COALESCE(SUM(amount_pkr),0) INTO v_committed FROM marketing.expenses
  WHERE owner_id=NEW.user_id AND subcategory_id=NEW.subcategory_id
    AND occurred_on>=NEW.month AND occurred_on<(NEW.month+interval '1 month')
    AND status IN ('Pending','In Review','Approved');
 IF NEW.amount_pkr < v_committed THEN
   RAISE EXCEPTION 'Employee allocation cannot fall below committed expenses' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_allocation_budget_trigger ON marketing.employee_allocations;
CREATE TRIGGER enforce_allocation_budget_trigger BEFORE INSERT OR UPDATE OF
  month, subcategory_id, user_id, amount_pkr
ON marketing.employee_allocations FOR EACH ROW EXECUTE FUNCTION marketing.enforce_allocation_budget();

CREATE OR REPLACE FUNCTION marketing.enforce_company_budget() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_allocated numeric; v_committed numeric;
BEGIN
 SELECT COALESCE(SUM(amount_pkr),0) INTO v_allocated FROM marketing.employee_allocations
 WHERE month=NEW.month AND subcategory_id=NEW.subcategory_id;
 SELECT COALESCE(SUM(amount_pkr),0) INTO v_committed FROM marketing.expenses
 WHERE subcategory_id=NEW.subcategory_id
   AND occurred_on>=NEW.month AND occurred_on<(NEW.month+interval '1 month')
   AND status IN ('Pending','In Review','Approved');
 IF NEW.amount_pkr < GREATEST(v_allocated,v_committed) THEN
   RAISE EXCEPTION 'Company budget cannot fall below allocations or committed expenses' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_company_budget_trigger ON marketing.monthly_budgets;
CREATE TRIGGER enforce_company_budget_trigger BEFORE UPDATE OF amount_pkr
ON marketing.monthly_budgets FOR EACH ROW EXECUTE FUNCTION marketing.enforce_company_budget();

-- Protect three-document audit rules even against direct/competing API writes.
CREATE OR REPLACE FUNCTION marketing.enforce_expense_document_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_expense uuid; v_status text;
BEGIN
 v_expense := CASE WHEN TG_OP='DELETE' THEN OLD.expense_id ELSE NEW.expense_id END;
 SELECT status INTO v_status FROM marketing.expenses WHERE id=v_expense FOR UPDATE;
 IF v_status IS DISTINCT FROM 'Pending' THEN
   RAISE EXCEPTION 'Documents can only change while expense is Pending' USING ERRCODE='P0001';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS enforce_expense_document_status_trigger ON marketing.expense_documents;
CREATE TRIGGER enforce_expense_document_status_trigger BEFORE INSERT OR UPDATE OR DELETE
ON marketing.expense_documents FOR EACH ROW EXECUTE FUNCTION marketing.enforce_expense_document_status();

CREATE OR REPLACE FUNCTION marketing.enforce_expense_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_docs integer;
BEGIN
 IF OLD.status=NEW.status THEN RETURN NEW; END IF;
 IF NOT (
   (OLD.status='Pending' AND NEW.status='In Review') OR
   (OLD.status='In Review' AND NEW.status IN ('Approved','Rejected'))
 ) THEN RAISE EXCEPTION 'Invalid expense status transition' USING ERRCODE='P0001'; END IF;
 IF NEW.status IN ('In Review','Approved') THEN
   SELECT count(*) INTO v_docs FROM marketing.expense_documents WHERE expense_id=NEW.id;
   IF v_docs <> 3 THEN RAISE EXCEPTION 'Exactly three documents required for submission/approval' USING ERRCODE='P0001'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enforce_expense_transition_trigger ON marketing.expenses;
CREATE TRIGGER enforce_expense_transition_trigger BEFORE UPDATE OF status
ON marketing.expenses FOR EACH ROW EXECUTE FUNCTION marketing.enforce_expense_transition();

-- Migration intentionally does NOT change historical records or delete any rows.
