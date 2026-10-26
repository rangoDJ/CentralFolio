import db from "../models/database.js";

export interface Goal {
  id: number;
  name: string;
  targetType: 'monthly_income' | 'annual_income' | 'net_worth';
  targetAmount: number;
  targetDate?: string | null;
  notes?: string | null;
  createdAt?: string;
}

export interface GoalInput {
  name: string;
  targetType: 'monthly_income' | 'annual_income' | 'net_worth';
  targetAmount: number;
  targetDate?: string | null;
  notes?: string | null;
}

export function listGoals(): Goal[] {
  return db.prepare("SELECT * FROM portfolio_goals ORDER BY targetAmount ASC").all() as Goal[];
}

export function getGoal(id: number): Goal | undefined {
  return db.prepare("SELECT * FROM portfolio_goals WHERE id = ?").get(id) as Goal | undefined;
}

export function createGoal(input: GoalInput): Goal {
  const stmt = db.prepare(`
    INSERT INTO portfolio_goals (name, targetType, targetAmount, targetDate, notes)
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    input.name.trim(),
    input.targetType,
    Number(input.targetAmount),
    input.targetDate ? input.targetDate.trim() : null,
    input.notes ? input.notes.trim() : null
  );
  return getGoal(Number(info.lastInsertRowid))!;
}

export function updateGoal(id: number, input: Partial<GoalInput>): Goal | undefined {
  const existing = getGoal(id);
  if (!existing) return undefined;

  const name = input.name !== undefined ? input.name.trim() : existing.name;
  const targetType = input.targetType !== undefined ? input.targetType : existing.targetType;
  const targetAmount = input.targetAmount !== undefined ? Number(input.targetAmount) : existing.targetAmount;
  const targetDate = input.targetDate !== undefined ? (input.targetDate ? input.targetDate.trim() : null) : existing.targetDate;
  const notes = input.notes !== undefined ? (input.notes ? input.notes.trim() : null) : existing.notes;

  db.prepare(`
    UPDATE portfolio_goals
    SET name = ?, targetType = ?, targetAmount = ?, targetDate = ?, notes = ?
    WHERE id = ?
  `).run(name, targetType, targetAmount, targetDate, notes, id);

  return getGoal(id);
}

export function deleteGoal(id: number): boolean {
  const info = db.prepare("DELETE FROM portfolio_goals WHERE id = ?").run(id);
  return info.changes > 0;
}

export function seedDefaultGoalsIfEmpty(): void {
  try {
    const count = (db.prepare("SELECT count(*) as count FROM portfolio_goals").get() as any)?.count ?? 0;
    if (count === 0) {
      createGoal({ name: 'Cover Monthly Groceries', targetType: 'monthly_income', targetAmount: 500 });
      createGoal({ name: 'Cover Rent / Mortgage', targetType: 'monthly_income', targetAmount: 2000 });
      createGoal({ name: 'Lean FIRE Milestone', targetType: 'annual_income', targetAmount: 40000 });
      createGoal({ name: 'Half-Million Net Worth', targetType: 'net_worth', targetAmount: 500000 });
      createGoal({ name: 'Full Financial Freedom', targetType: 'annual_income', targetAmount: 75000 });
    }
  } catch {
    // Ignore during test initialization before migration
  }
}
