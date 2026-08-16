export type LedgerTxType = "sale" | "purchase" | "payment_in" | "payment_out" | "expense";

export type LedgerTxLike = {
  type: LedgerTxType;
  contact_id?: string | null;
  amount: number;
  paid_amount: number;
  cost_amount?: number | null;
  is_void?: boolean | null;
};

export type LedgerContactLike = {
  id: string;
  type: "customer" | "supplier";
  opening_balance: number;
};

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function cashInForTransaction(tx: LedgerTxLike) {
  if (tx.is_void) return 0;
  if (tx.type === "sale") return num(tx.paid_amount);
  if (tx.type === "payment_in") return num(tx.amount);
  return 0;
}

export function cashOutForTransaction(tx: LedgerTxLike) {
  if (tx.is_void) return 0;
  if (tx.type === "purchase") return num(tx.paid_amount);
  if (tx.type === "payment_out" || tx.type === "expense") return num(tx.amount);
  return 0;
}

export function summarizeAccounting(transactions: LedgerTxLike[], contacts: LedgerContactLike[]) {
  const activeTransactions = transactions.filter((tx) => !tx.is_void);
  const saleRevenue = activeTransactions.filter((tx) => tx.type === "sale").reduce((sum, tx) => sum + num(tx.amount), 0);
  const purchaseTotal = activeTransactions.filter((tx) => tx.type === "purchase").reduce((sum, tx) => sum + num(tx.amount), 0);
  const cogs = activeTransactions.filter((tx) => tx.type === "sale").reduce((sum, tx) => sum + num(tx.cost_amount), 0);
  const expenses = activeTransactions.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + num(tx.amount), 0);
  const cashIn = activeTransactions.reduce((sum, tx) => sum + cashInForTransaction(tx), 0);
  const cashOut = activeTransactions.reduce((sum, tx) => sum + cashOutForTransaction(tx), 0);

  let receivables = 0;
  let payables = 0;
  let customerAdvance = 0;
  let supplierAdvance = 0;

  for (const contact of contacts) {
    const opening = num(contact.opening_balance);
    const linked = activeTransactions.filter((tx) => tx.contact_id === contact.id);

    if (contact.type === "customer") {
      const invoiceDue = linked
        .filter((tx) => tx.type === "sale")
        .reduce((sum, tx) => sum + Math.max(0, num(tx.amount) - num(tx.paid_amount)), 0);
      const laterPayments = linked.filter((tx) => tx.type === "payment_in").reduce((sum, tx) => sum + num(tx.amount), 0);
      const balance = opening + invoiceDue - laterPayments;
      if (balance >= 0) receivables += balance;
      else customerAdvance += Math.abs(balance);
    } else {
      const billDue = linked
        .filter((tx) => tx.type === "purchase")
        .reduce((sum, tx) => sum + Math.max(0, num(tx.amount) - num(tx.paid_amount)), 0);
      const laterPayments = linked.filter((tx) => tx.type === "payment_out").reduce((sum, tx) => sum + num(tx.amount), 0);
      const balance = opening + billDue - laterPayments;
      if (balance >= 0) payables += balance;
      else supplierAdvance += Math.abs(balance);
    }
  }

  const grossProfit = saleRevenue - cogs;
  const netProfit = grossProfit - expenses;

  return {
    saleRevenue,
    purchaseTotal,
    cogs,
    expenses,
    grossProfit,
    netProfit,
    cashIn,
    cashOut,
    cashBalance: cashIn - cashOut,
    receivables,
    payables,
    customerAdvance,
    supplierAdvance,
  };
}
