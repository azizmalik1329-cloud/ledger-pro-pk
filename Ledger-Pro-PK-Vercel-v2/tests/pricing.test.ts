import test from "node:test";
import assert from "node:assert/strict";
import { calculateInventoryLine, localDateInputValue, unitRateFromTotal } from "../lib/pricing.ts";

test("500 kg purchased for 10000 gives 20 per kg",()=>{
  assert.equal(unitRateFromTotal(10000,500),20);
});

test("5 kg at 30 per kg auto totals 150",()=>{
  const x=calculateInventoryLine({quantity:5,unitPrice:30});
  assert.equal(x.grossAmount,150);
  assert.equal(x.netAmount,150);
});

test("fixed concession reduces net and due",()=>{
  const x=calculateInventoryLine({quantity:5,unitPrice:30,discountType:"amount",discountValue:10,paidAmount:100});
  assert.equal(x.grossAmount,150);
  assert.equal(x.discountAmount,10);
  assert.equal(x.netAmount,140);
  assert.equal(x.dueAmount,40);
});

test("percent concession is rounded to money",()=>{
  const x=calculateInventoryLine({quantity:5,unitPrice:30,discountType:"percent",discountValue:10});
  assert.equal(x.discountAmount,15);
  assert.equal(x.netAmount,135);
});

test("discount never exceeds gross and paid never exceeds net",()=>{
  const x=calculateInventoryLine({quantity:2,unitPrice:100,discountType:"amount",discountValue:500,paidAmount:900});
  assert.equal(x.discountAmount,200);
  assert.equal(x.netAmount,0);
  assert.equal(x.paidAmount,0);
});

test("local date helper does not depend on UTC slicing",()=>{
  assert.equal(localDateInputValue(new Date(2026,7,16,0,30,0)),"2026-08-16");
});
