"use client";

import { FormEvent, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { calculateInventoryLine, DiscountType, localDateInputValue, roundMoney, unitRateFromTotal } from "@/lib/pricing";
import "./pro-accounting.css";

type Contact={id:string;type:"customer"|"supplier";name:string;is_active:boolean};
type Product={id:string;name:string;unit:string;sale_price:number;purchase_price:number;stock_quantity:number;is_active:boolean};
type TxType="sale"|"purchase"|"payment_in"|"payment_out"|"expense";
type Tx={id:string;contact_id:string|null;product_id:string|null;quantity:number|null;type:TxType;reference:string|null;amount:number;paid_amount:number;transaction_date:string;notes:string|null;is_void?:boolean;unit_price?:number;gross_amount?:number;discount_type?:DiscountType;discount_value?:number;discount_amount?:number;unit_cost?:number};

const money=(n:number)=>`Rs. ${Number(n||0).toLocaleString("en-PK",{maximumFractionDigits:2})}`;
const rate=(n:number)=>Number(n||0).toLocaleString("en-PK",{maximumFractionDigits:4});

export default function ProTransactionModal({businessId,item,defaultType,contacts,products,busy,setBusy,close,done}:{businessId:string;item:Tx|null;defaultType:TxType;contacts:Contact[];products:Product[];busy:boolean;setBusy:(v:boolean)=>void;close:()=>void;done:()=>void}){
  const initialKind=item?.type||defaultType;
  const initialProduct=products.find(p=>p.id===item?.product_id);
  const initialQty=Number(item?.quantity||1);
  const fallbackRate=initialQty>0?Number(item?.gross_amount||item?.amount||0)/initialQty:0;
  const [kind,setKind]=useState<TxType>(initialKind);
  const [contactId,setContactId]=useState(item?.contact_id||"");
  const [productId,setProductId]=useState(item?.product_id||"");
  const [quantity,setQuantity]=useState(initialQty);
  const [unitPrice,setUnitPrice]=useState(Number(item?.unit_price||fallbackRate||((initialKind==="sale"?initialProduct?.sale_price:initialProduct?.purchase_price)||0)));
  const [discountType,setDiscountType]=useState<DiscountType>(item?.discount_type||"none");
  const [discountValue,setDiscountValue]=useState(Number(item?.discount_value||0));
  const [paid,setPaid]=useState(Number(item?.paid_amount||0));
  const [cashAmount,setCashAmount]=useState(!["sale","purchase"].includes(initialKind)?Number(item?.amount||0):0);
  const [txDate,setTxDate]=useState(item?.transaction_date||localDateInputValue());
  const [reference,setReference]=useState(item?.reference||"");
  const [notes,setNotes]=useState(item?.notes||"");
  const [message,setMessage]=useState("");

  const inventory=kind==="sale"||kind==="purchase";
  const selectedProduct=products.find(p=>p.id===productId);
  const expectedParty:Contact["type"]|null=kind==="sale"||kind==="payment_in"?"customer":kind==="purchase"||kind==="payment_out"?"supplier":null;
  const availableContacts=contacts.filter(c=>(!expectedParty||c.type===expectedParty)&&(c.is_active||c.id===item?.contact_id));
  const availableProducts=products.filter(p=>p.is_active||p.id===item?.product_id);
  const totals=useMemo(()=>calculateInventoryLine({quantity,unitPrice,discountType,discountValue,paidAmount:paid}),[quantity,unitPrice,discountType,discountValue,paid]);

  const oldQty=Number(item?.quantity||0);
  const sameProduct=item?.product_id===selectedProduct?.id;
  const stockBeforeEdit=selectedProduct?Number(selectedProduct.stock_quantity)+(sameProduct&&item?.type==="sale"?oldQty:0)-(sameProduct&&item?.type==="purchase"?oldQty:0):0;
  const projectedStock=selectedProduct?(kind==="sale"?stockBeforeEdit-quantity:kind==="purchase"?stockBeforeEdit+quantity:stockBeforeEdit):0;
  const previewUnitCost=item?.type==="sale"&&item?.unit_cost?Number(item.unit_cost):Number(selectedProduct?.purchase_price||0);
  const estimatedProfit=kind==="sale"?roundMoney(totals.netAmount-(previewUnitCost*quantity)):0;

  function chooseKind(next:TxType){
    setKind(next);setMessage("");setContactId("");
    if(next!=="sale"&&next!=="purchase"){setProductId("");setQuantity(1);setUnitPrice(0);setDiscountType("none");setDiscountValue(0);setPaid(0)}
  }
  function chooseProduct(id:string){
    setProductId(id);const p=products.find(x=>x.id===id);if(!p)return;
    setUnitPrice(Number(kind==="sale"?p.sale_price:p.purchase_price));
  }
  function changeGross(value:number){setUnitPrice(unitRateFromTotal(value,quantity))}
  function changeQuantity(value:number){
    const next=Math.max(0,value);setQuantity(next);
  }

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setMessage("");
    if(inventory){
      if(!productId||quantity<=0)return setMessage("Product aur positive quantity zaroori hai.");
      if(unitPrice<=0)return setMessage("Rate per unit zero se zyada hona chahiye.");
      if(discountType==="percent"&&(discountValue<0||discountValue>100))return setMessage("Discount percent 0 se 100 ke darmiyan hona chahiye.");
      if(discountType==="amount"&&discountValue>totals.grossAmount)return setMessage("Discount gross amount se zyada nahi ho sakta.");
      if(totals.netAmount<=0)return setMessage("Net amount zero se zyada hona chahiye.");
      if(paid<0||paid>totals.netAmount)return setMessage("Paid amount net total se zyada nahi ho sakta.");
      if(kind==="sale"&&projectedStock<0)return setMessage(`Stock kam hai. Available ${rate(stockBeforeEdit)} ${selectedProduct?.unit||""}.`);
      if(paid<totals.netAmount&&!contactId)return setMessage(kind==="sale"?"Credit sale ke liye customer select karna lazmi hai.":"Credit purchase ke liye supplier select karna lazmi hai.");
    }else{
      if(cashAmount<=0)return setMessage("Amount zero se zyada hona chahiye.");
      if((kind==="payment_in"||kind==="payment_out")&&!contactId)return setMessage(kind==="payment_in"?"Wasooli ke liye customer select karein.":"Adayegi ke liye supplier select karein.");
    }

    setBusy(true);
    const fields=inventory?{
      contact_id:contactId||null,product_id:productId,quantity,type:kind,reference:reference.trim()||null,
      unit_price:unitPrice,gross_amount:totals.grossAmount,discount_type:discountType,discount_value:discountType==="none"?0:discountValue,discount_amount:totals.discountAmount,
      amount:totals.netAmount,paid_amount:paid,transaction_date:txDate,notes:notes.trim()||null,
      status:paid>=totals.netAmount?"paid":paid>0?"partial":"unpaid"
    }:{
      contact_id:kind==="expense"?null:(contactId||null),product_id:null,quantity:null,type:kind,reference:reference.trim()||null,
      unit_price:0,gross_amount:cashAmount,discount_type:"none",discount_value:0,discount_amount:0,
      amount:cashAmount,paid_amount:cashAmount,transaction_date:txDate,notes:notes.trim()||null,status:"paid"
    };
    const query=item?supabase.from("transactions").update(fields).eq("id",item.id).eq("business_id",businessId):supabase.from("transactions").insert({...fields,business_id:businessId});
    const {error}=await query;setBusy(false);if(error)setMessage(error.message);else done();
  }

  return <div className="overlay"><div className="modal proTxModal"><header><div><small>PROFESSIONAL ENTRY</small><h2>{item?"Transaction edit karein":"Nayi transaction"}</h2></div><button aria-label="Close" onClick={close}>×</button></header><form onSubmit={submit}>
    <div className="formRow"><label>Type<select value={kind} onChange={e=>chooseKind(e.target.value as TxType)}><option value="sale">Farokht / Sale</option><option value="purchase">Khareedari / Purchase</option><option value="payment_in">Customer se wasooli</option><option value="payment_out">Supplier ko adayegi</option><option value="expense">Kharcha</option></select></label>{expectedParty?<label>{expectedParty==="customer"?"Customer":"Supplier"}<select value={contactId} onChange={e=>setContactId(e.target.value)}><option value="">{inventory?"General / Cash":"Select karein"}</option>{availableContacts.map(c=><option value={c.id} key={c.id}>{c.name}{c.is_active?"":" (Archived)"}</option>)}</select></label>:<label>Party<input value="General expense" disabled readOnly/></label>}</div>

    {inventory&&<><div className="formRow"><label>Product<select value={productId} onChange={e=>chooseProduct(e.target.value)} required><option value="">Product select karein</option>{availableProducts.map(p=><option value={p.id} key={p.id}>{p.name} — stock {rate(p.stock_quantity)} {p.unit}</option>)}</select></label><label>Quantity {selectedProduct?`(${selectedProduct.unit})`:""}<input type="number" min="0.001" step="0.001" value={quantity||""} onChange={e=>changeQuantity(Number(e.target.value))} required/></label></div>
    <div className="formRow"><label>Rate per {selectedProduct?.unit||"unit"}<input type="number" min="0.0001" step="0.0001" value={unitPrice||""} onChange={e=>setUnitPrice(Number(e.target.value))} required/><small className="fieldHint">{kind==="sale"?"Product ka default sale rate auto aata hai; zarurat par change kar sakte hain.":"Current purchase rate auto aata hai; naya supplier rate yahan likhein."}</small></label><label>Gross total<input type="number" min="0.01" step="0.01" value={totals.grossAmount||""} onChange={e=>changeGross(Number(e.target.value))}/><small className="fieldHint">Total likhein to rate/unit khud calculate ho jayega.</small></label></div>
    <div className="formRow"><label>Concession / Discount<select value={discountType} onChange={e=>{setDiscountType(e.target.value as DiscountType);setDiscountValue(0)}}><option value="none">No discount</option><option value="amount">Fixed Rs.</option><option value="percent">Percent %</option></select></label><label>{discountType==="percent"?"Discount %":"Discount amount"}<input type="number" min="0" max={discountType==="percent"?100:undefined} step={discountType==="percent"?"0.01":"0.01"} disabled={discountType==="none"} value={discountType==="none"?0:discountValue} onChange={e=>setDiscountValue(Number(e.target.value))}/></label></div>
    <div className="calcSummary"><div><small>Gross</small><b>{money(totals.grossAmount)}</b></div><div><small>Discount</small><b>- {money(totals.discountAmount)}</b></div><div className="highlight"><small>Net total</small><b>{money(totals.netAmount)}</b></div></div>
    <div className="formRow"><label>Paid amount<input type="number" min="0" step="0.01" value={paid||0} onChange={e=>setPaid(Number(e.target.value))}/></label><label>Remaining due<input value={money(Math.max(0,totals.netAmount-paid))} disabled readOnly/></label></div>
    {selectedProduct&&<div className="inventoryPreview"><span><small>Current stock</small><b>{rate(selectedProduct.stock_quantity)} {selectedProduct.unit}</b></span><span><small>After this entry</small><b className={projectedStock<0?"negative":""}>{rate(projectedStock)} {selectedProduct.unit}</b></span>{kind==="purchase"?<span><small>Net cost / {selectedProduct.unit}</small><b>{money(totals.effectiveUnitPrice)}</b></span>:<span><small>Estimated profit</small><b className={estimatedProfit<0?"negative":""}>{money(estimatedProfit)}</b></span>}</div>}
    {kind==="sale"&&<p className="modalNote">Profit preview current cost par estimate hai. Save par database transaction date ke mutabiq COGS snapshot lock karega.</p>}{kind==="purchase"&&<p className="modalNote">Purchase save hote hi stock plus aur net purchase cost per unit automatically update hogi.</p>}</>}

    {!inventory&&<div className="formRow"><label>Amount<input type="number" min="0.01" step="0.01" value={cashAmount||""} onChange={e=>setCashAmount(Number(e.target.value))} required/></label><label>Cash movement<input value={kind==="payment_in"?"Cash In":kind==="payment_out"||kind==="expense"?"Cash Out":"Full amount"} disabled readOnly/></label></div>}

    <div className="formRow"><label>Reference<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Blank chhorain = auto number"/><small className="fieldHint">Blank ho to system unique reference generate karega.</small></label><label>Date<input type="date" value={txDate} onChange={e=>setTxDate(e.target.value)} required/></label></div>
    <label>Notes<textarea value={notes} onChange={e=>setNotes(e.target.value)}/></label>
    {message&&<div className="calcError">{message}</div>}
    <footer className="modalActions"><button type="button" className="ghost" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy?"Saving…":"Mehfooz karein"}</button></footer>
  </form></div></div>;
}
