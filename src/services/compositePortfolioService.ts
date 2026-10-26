import {
  listCompositePortfolios,
  createCompositePortfolio,
  deleteCompositePortfolio,
  type CompositePortfolioRecord
} from "../repositories/compositePortfolioRepository.js";
import {
  getAllUserPortfolios,
  getUserPortfolioById,
  createUserPortfolio,
  setUserPortfolioAccounts
} from "../repositories/userPortfolioRepository.js";

export type { CompositePortfolioRecord };

export function getAllCompositePortfolios(): CompositePortfolioRecord[] {
  return listCompositePortfolios();
}

export function addCompositePortfolio(name: string, description?: string, color?: string, memberPortfolioIds: number[] = []): CompositePortfolioRecord {
  if (!name || name.trim().length === 0) {
    throw new Error("Composite portfolio name cannot be empty.");
  }
  return createCompositePortfolio(name.trim(), description, color, memberPortfolioIds);
}

export function removeCompositePortfolio(id: number): boolean {
  return deleteCompositePortfolio(id);
}

export function cloneUserPortfolio(sourcePortfolioId: number, newName?: string): { id: number; name: string } {
  const all = getAllUserPortfolios();
  const source = all.find(p => p.id === sourcePortfolioId);
  if (!source) {
    throw new Error(`Source portfolio with ID ${sourcePortfolioId} not found.`);
  }

  const name = newName || `${source.name} - copy`;
  const created = createUserPortfolio(name, `Cloned from ${source.name}`, source.color || '#2563eb');

  const sourceWithAccounts = getUserPortfolioById(sourcePortfolioId);
  if (sourceWithAccounts?.accountIds && sourceWithAccounts.accountIds.length > 0) {
    setUserPortfolioAccounts(created.id, sourceWithAccounts.accountIds);
  }

  return { id: created.id, name: created.name };
}
