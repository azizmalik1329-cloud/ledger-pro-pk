import test from "node:test";
import assert from "node:assert/strict";
import { cashInForTransaction, cashOutForTransaction, summarizeAccounting } from "../lib/accounting.ts";

test("unpaid sale does not become cash",()=>{
  const sale={type:"sale" as const,amount:10000,paid_amount:0,cost_amount:6000};
  assert.equal(cashInForTransaction(sale),0);
  assert.equal(cashOutForTransaction(sale),0);
});

test("partial sale counts only paid cash",()=>{
  assert.equal(cashInForTransaction({type:"sale",amount:10000,paid_amount:2500}),2500);
});

test("purchase cash uses paid amount only",()=>{
  assert.equal(cashOutForTransaction({type:"purchase",amount:9000,paid_amount:3000}),3000);
});

test("payments and expenses are full cash movements",()=>{
  assert.equal(cashInForTransaction({type:"payment_in",amount:1500,paid_amount:1500}),1500);
  assert.equal(cashOutForTransaction({type:"payment_out",amount:700,paid_amount:700}),700);
  assert.equal(cashOutForTransaction({type:"expense",amount:500,paid_amount:500}),500);
});

test("summary calculates profit cash receivable and payable separately",()=>{
  const contacts=[
    {id:"customer",type:"customer" as const,opening_balance:1000},
    {id:"supplier",type:"supplier" as const,opening_balance:500},
  ];
  const tx=[
    {type:"sale" as const,contact_id:"customer",amount:10000,paid_amount:2500,cost_amount:6000},
    {type:"payment_in" as const,contact_id:"customer",amount:1500,paid_amount:1500,cost_amount:0},
    {type:"purchase" as const,contact_id:"supplier",amount:8000,paid_amount:3000,cost_amount:0},
    {type:"payment_out" as const,contact_id:"supplier",amount:1000,paid_amount:1000,cost_amount:0},
    {type:"expense" as const,contact_id:null,amount:500,paid_amount:500,cost_amount:0},
  ];
  const s=summarizeAccounting(tx,contacts);
  assert.equal(s.saleRevenue,10000);
  assert.equal(s.cogs,6000);
  assert.equal(s.grossProfit,4000);
  assert.equal(s.expenses,500);
  assert.equal(s.netProfit,3500);
  assert.equal(s.cashIn,4000);
  assert.equal(s.cashOut,4500);
  assert.equal(s.cashBalance,-500);
  assert.equal(s.receivables,7000);
  assert.equal(s.payables,4500);
});

test("negative opening balance is treated as advance",()=>{
  const s=summarizeAccounting([], [{id:"c",type:"customer",opening_balance:-800},{id:"s",type:"supplier",opening_balance:-300}]);
  assert.equal(s.customerAdvance,800);
  assert.equal(s.supplierAdvance,300);
  assert.equal(s.receivables,0);
  assert.equal(s.payables,0);
});
