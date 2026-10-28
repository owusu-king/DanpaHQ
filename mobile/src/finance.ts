/** Finance keeps each existing record workflow in an explicit destination. */
export const FINANCE_VIEWS = [
  ["balances", "Rent Due"], ["records", "Payment Records"], ["payouts", "Payouts"],
  ["expenses", "Expenses"], ["pnl", "Profit & Loss (P&L)"],
] as const;
export type FinanceView = typeof FINANCE_VIEWS[number][0];

export function financeEntries<T extends { kind: string; key: string; fold?: string }>(
  entries: T[], view: FinanceView,
): T[] {
  return entries.filter(entry => {
    if (view === "pnl") return false;
    if (entry.kind === "label") {
      const labels = view === "balances" ? ["label:overdue", "label:due", "label:found-tenants"]
        : view === "records" ? ["label:review", "label:recent", "label:found-payments"]
          : view === "payouts" ? ["label:attention", "label:way"] : [];
      return labels.includes(entry.key);
    }
    if (view === "balances") return entry.kind === "tenant" || entry.kind === "calm";
    if (view === "records") return entry.kind === "payment" || entry.kind === "more";
    if (view === "payouts") return entry.kind === "settlement" || entry.kind === "payoutNote"
      || (entry.kind === "fold" && entry.fold === "paid");
    return ["expense", "noExpenses", "recordExpense"].includes(entry.kind)
      || (entry.kind === "fold" && entry.fold === "expenses");
  });
}
