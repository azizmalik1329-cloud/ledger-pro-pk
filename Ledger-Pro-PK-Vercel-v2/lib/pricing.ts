export type DiscountType = "none" | "amount" | "percent";

const finite = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const roundRate = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000;

export function calculateInventoryLine(input: {
  quantity: number;
  unitPrice: number;
  discountType?: DiscountType;
  discountValue?: number;
  paidAmount?: number;
}) {
  const quantity = Math.max(0, finite(input.quantity));
  const unitPrice = Math.max(0, finite(input.unitPrice));
  const discountType = input.discountType ?? "none";
  const discountValue = Math.max(0, finite(input.discountValue));
  const grossAmount = roundMoney(quantity * unitPrice);

  let discountAmount = 0;
  if (discountType === "amount") discountAmount = roundMoney(Math.min(discountValue, grossAmount));
  if (discountType === "percent") discountAmount = roundMoney(grossAmount * Math.min(discountValue, 100) / 100);

  const netAmount = roundMoney(Math.max(0, grossAmount - discountAmount));
  const paidAmount = roundMoney(Math.max(0, Math.min(finite(input.paidAmount), netAmount)));
  const dueAmount = roundMoney(Math.max(0, netAmount - paidAmount));
  const effectiveUnitPrice = quantity > 0 ? roundRate(netAmount / quantity) : 0;

  return { quantity, unitPrice, grossAmount, discountType, discountValue, discountAmount, netAmount, paidAmount, dueAmount, effectiveUnitPrice };
}

export function unitRateFromTotal(total: number, quantity: number) {
  const q = finite(quantity);
  if (q <= 0) return 0;
  return roundRate(Math.max(0, finite(total)) / q);
}

export function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
