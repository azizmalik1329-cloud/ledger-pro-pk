"use client";

import { FormEvent, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { calculateInventoryLine, DiscountType, localDateInputValue, roundMoney, unitRateFromTotal } from "@/lib/pricing";
import "./pro-accounting.css";

type Contact={id:string;type:"customer"|"supplier";name:string;phone?:string|null;email?:string|null;opening_balance?:number;is_active:boolean};
type Product={id:string;name:string;unit:string;sale_price:number;purchase_price:number;stock_quantity:number;is_active:boolean};
type TxType="sale"|"purchase"|"payment_in"|"payment_out"|"expense";
type Tx={id:string;contact_id:string|null;product_id:string|null;quantity:number|null;type:TxType;reference:string|null;amount:number;paid_amount:number;transaction_date:string;notes:string|null;is_void?:boolean;created_at?:string;unit_price?:number;gross_amount?:number;discount_type?:DiscountType;discount_value?:number;discount_amount?:number;unit_cost?:number};
type PartyMode="cash"|"ledger";

const money=(n:number)=>`Rs. ${Number(n||0).toLocaleString("en-PK",{maximumFractionDigits:2})}`;
const rate=(n:number)=>Number(n||0).toLocaleString("en-PK",{maximumFractionDigits:4});

function balanceDelta(contact:Contact,tx:Tx){
  if(tx.is_void||tx.contact_id!==contact.id)return 0;
  if(contact.type==="customer"){
    if(tx.type==="sale")return Math.max(0,Number(tx.amount)-Number(tx.paid_amount));
    if(tx.type==="payment_in")return -Number(tx.amount);
    return 0;
  }
  if(tx.type==="purchase")return Math.max(0,Number(tx.amount)-Number(tx.paid_amount));
  if(tx.type==="payment_out")return -Number(tx.amount);
  return 0;
}

function partyBalance(contact:Contact,transactions:Tx[],excludeId?:string){
  return transactions.filter(t=>t.id!==excludeId).reduce((sum,tx)=>sum+balanceDelta(contact,tx),Number(contact.opening_balance||0));
}

export default function ProTransactionModal({businessId,item,defaultType,presetContactId="",contacts,products,transactions=[],busy,setBusy,close,done,contactCreated}:{businessId:string;item:Tx|null;defaultType:TxType;presetContactId?:string;contacts:Contact[];products:Product[];transactions?:Tx[];busy:boolean;setBusy:(v:boolean)=>void;close:()=>void;done:()=>void;contactCreated?:()=>void}){
  const initialKind=item?.type||defaultType;
  const initialProduct=products.find(p=>p.id===item?.product_id);
  const initialQty=Number(item?.quantity||1);
  const fallbackRate=initialQty>0?Number(item?.gross_amount||item?.amount||0)/initialQty:0;
  const [kind,setKind]=useState<TxType>(initialKind);
  const [contactId,setContactId]=useState(item?.contact_id||presetContactId||"");
  const [partyMode,setPartyMode]=useState<PartyMode>(item?.contact_id||presetContactId?"ledger":"cash");
  const [localContacts,setLocalContacts]=useState<Contact[]>(contacts);
  const [addingParty,setAddingParty]=useState(false);
  const [newPartyName,setNewPartyName]=useState("");
  const [newPartyPhone,setNewPartyPhone]=useState("");
  const [creatingParty,setCreatingParty]=useState(false);
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
  const partyNoun=expectedParty==="customer"?"Customer":expectedParty==="supplier"?"Supplier":"Party";
  const availableContacts=localContacts.filter(c=>(!expectedParty||c.type===expectedParty)&&(c.is_active||c.id===item?.contact_id));
  const availableProducts=products.filter(p=>p.is_active||p.id===item?.product_id);
  const selectedContact=availableContacts.find(c=>c.id===contactId);
  const totals=useMemo(()=>calculateInventoryLine({quantity,unitPrice,discountType,discountValue,paidAmount:paid}),[quantity,unitPrice,discountType,discountValue,paid]);

  const oldQty=Number(item?.quantity||0);
  const sameProduct=item?.product_id===selectedProduct?.id;
  const stockBeforeEdit=selectedProduct?Number(selectedProduct.stock_quantity)+(sameProduct&&item?.type==="sale"?oldQty:0)-(sameProduct&&item?.type==="purchase"?oldQty:0):0;
  const projectedStock=selectedProduct?(kind==="sale"?stockBeforeEdit-quantity:kind==="purchase"?stockBeforeEdit+quantity:stockBeforeEdit):0;
  const previewUnitCost=item?.type==="sale"&&item?.unit_cost?Number(item.unit_cost):Number(selectedProduct?.purchase_price||0);
  const estimatedProfit=kind==="sale"?roundMoney(totals.netAmount-(previewUnitCost*quantity)):0;
  const balanceBefore=selectedContact?partyBalance(selectedContact,transactions,item?.id):0;
  const currentEntryDelta=inventory?Math.max(0,totals.netAmount-paid):(kind==="payment_in"||kind==="payment_out"?-cashAmount:0);
  const balanceAfter=selectedContact?balanceBefore+currentEntryDelta:0;

  function chooseKind(next:TxType){
    setKind(next);setMessage("");setContactId("");setAddingParty(false);
    setPartyMode(next==="payment_in"||next==="payment_out"?"ledger":"cash");
    if(next!=="sale"&&next!=="purchase"){setProductId("");setQuantity(1);setUnitPrice(0);setDiscountType("none");setDiscountValue(0);setPaid(0)}
  }
  function chooseProduct(id:string){
    setProductId(id);const p=products.find(x=>x.id===id);if(!p)return;
    setUnitPrice(Number(kind==="sale"?p.sale_price:p.purchase_price));
  }
  function changeGross(value:number){setUnitPrice(unitRateFromTotal(value,quantity))}
  function changeQuantity(value:number){setQuantity(Math.max(0,value))}
  function setMode(next:PartyMode){setPartyMode(next);setMessage("");if(next==="cash")setContactId("")}

  async function createParty(){
    if(!expectedParty)return;
    const name=newPartyName.trim();
    if(name.length<2)return setMessage(`${partyNoun} ka naam kam az kam 2 characters ka ho.`);
    setCreatingParty(true);setMessage("");
    const {data,error}=await supabase.from("contacts").insert({business_id:businessId,type:expectedParty,name,phone:newPartyPhone.trim()||null,opening_balance:0,is_active:true}).select("id,type,name,phone,email,opening_balance,is_active").single();
    setCreatingParty(false);
    if(error)return setMessage(error.message);
    const created=data as Contact;setLocalContacts(prev=>[created,...prev]);setContactId(created.id);setPartyMode("ledger");setAddingParty(false);setNewPartyName("");setNewPartyPhone("");contactCreated?.();
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
      if(partyMode==="ledger"&&!contactId)return setMessage(`${partyNoun} ka khata select karein.`);
      if(paid<totals.netAmount&&!contactId)return setMessage(`${money(totals.netAmount-paid)} udhaar baqi hai — Khata ${partyNoun} select karein ya Paid Amount ko Net Total karein.`);
    }else{
      if(cashAmount<=0)return setMessage("Amount zero se zyada hona chahiye.");
      if((kind==="payment_in"||kind==="payment_out")&&!contactId)return setMessage(kind==="payment_in"?"Wasooli ke liye customer ka khata select karein.":"Adayegi ke liye supplier ka khata select karein.");
    }

    setBusy(true);
    const fields=inventory?{
      contact_id:partyMode==="ledger"?(contactId||null):null,product_id:productId,quantity,type:kind,reference:reference.trim()||null,
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

  const showPartyMode=inventory&&Boolean(expectedParty);
  const dueNow=Math.max(0,totals.netAmount-paid);
  const balanceLabel=(value:number)=>value<0?`Advance ${money(Math.abs(value))}`:money(value);

  return <div className="overlay"><div className="modal proTxModal"><header><div><small>PROFESSIONAL ENTRY</small><h2>{item?"Transaction edit karein":kind==="sale"?"Nayi Farokht":kind==="purchase"?"Nayi Khareedari":kind==="payment_in"?"Customer Wasooli":kind==="payment_out"?"Supplier Adayegi":"Naya Kharcha"}</h2></div><button aria-label="Close" onClick={close}>×</button></header><form onSubmit={submit}>
    <div className="entryTypeTabs" role="group" aria-label="Transaction type"><button type="button" className={kind==="sale"?"active":""} onClick={()=>chooseKind("sale")}>Farokht</button><button type="button" className={kind==="payment_in"?"active":""} onClick={()=>chooseKind("payment_in")}>Wasooli</button><button type="button" className={kind==="purchase"?"active":""} onClick={()=>chooseKind("purchase")}>Khareedari</button><button type="button" className={kind==="payment_out"?"active":""} onClick={()=>chooseKind("payment_out")}>Adayegi</button><button type="button" className={kind==="expense"?"active":""} onClick={()=>chooseKind("expense")}>Kharcha</button></div>

    {showPartyMode&&<div className="partyModeBlock"><small className="partyModeTitle">{partyNoun} kis tarah ka hai?</small><div className="partyModeChoice"><button type="button" className={partyMode==="cash"?"active":""} onClick={()=>setMode("cash")}><b>Cash / Bina Khata</b><small>Full payment par naam save karna zaroori nahi</small></button><button type="button" className={partyMode==="ledger"?"active":""} onClick={()=>setMode("ledger")}><b>Khata {partyNoun}</b><small>Saved khata se due/payable track hoga</small></button></div></div>}

    {expectedParty&&(partyMode==="ledger"||!inventory)&&<div className="partyPicker"><div className="partyPickerHead"><b>{partyNoun} ka khata</b><button type="button" onClick={()=>setAddingParty(v=>!v)}>＋ Naya {partyNoun}</button></div><select value={contactId} onChange={e=>setContactId(e.target.value)}><option value="">{partyNoun} select karein</option>{availableContacts.map(c=><option value={c.id} key={c.id}>{c.name}{c.is_active?"":" (Archived)"}</option>)}</select>{selectedContact&&<div className="partyBalancePreview"><span><small>Purana {selectedContact.type==="customer"?"due":"payable"}</small><b>{balanceLabel(balanceBefore)}</b></span><span><small>Is entry ke baad</small><b className={balanceAfter<0?"advance":""}>{balanceLabel(balanceAfter)}</b></span></div>}{addingParty&&<div className="inlinePartyForm"><input type="text" placeholder={`${partyNoun} ka naam`} value={newPartyName} onChange={e=>setNewPartyName(e.target.value)}/><input type="tel" placeholder="Phone (optional)" value={newPartyPhone} onChange={e=>setNewPartyPhone(e.target.value)}/><button type="button" className="primary" disabled={creatingParty} onClick={()=>void createParty()}>{creatingParty?"Adding…":`Add ${partyNoun}`}</button></div>}</div>}

    {inventory&&<><div className="formRow"><label>Product<select value={productId} onChange={e=>chooseProduct(e.target.value)} required><option value="">Product select karein</option>{availableProducts.map(p=><option value={p.id} key={p.id}>{p.name} — stock {rate(p.stock_quantity)} {p.unit}</option>)}</select></label><label>Quantity {selectedProduct?`(${selectedProduct.unit})`:""}<input type="number" min="0.001" step="0.001" value={quantity||""} onChange={e=>changeQuantity(Number(e.target.value))} required/></label></div>
    <div className="formRow"><label>Rate per {selectedProduct?.unit||"unit"}<input type="number" min="0.0001" step="0.0001" value={unitPrice||""} onChange={e=>setUnitPrice(Number(e.target.value))} required/><small className="fieldHint">{kind==="sale"?"Product ka default sale rate auto aata hai; zarurat par change kar sakte hain.":"Current purchase rate auto aata hai; naya supplier rate yahan likhein."}</small></label><label>Gross total<input type="number" min="0.01" step="0.01" value={totals.grossAmount||""} onChange={e=>changeGross(Number(e.target.value))}/><small className="fieldHint">Total likhein to rate/unit khud calculate ho jayega.</small></label></div>
    <div className="formRow"><label>Concession / Discount<select value={discountType} onChange={e=>{setDiscountType(e.target.value as DiscountType);setDiscountValue(0)}}><option value="none">No discount</option><option value="amount">Fixed Rs.</option><option value="percent">Percent %</option></select></label><label>{discountType==="percent"?"Discount %":"Discount amount"}<input type="number" min="0" max={discountType==="percent"?100:undefined} step="0.01" disabled={discountType==="none"} value={discountType==="none"?0:discountValue} onChange={e=>setDiscountValue(Number(e.target.value))}/></label></div>
    <div className="calcSummary"><div><small>Gross</small><b>{money(totals.grossAmount)}</b></div><div><small>Discount</small><b>- {money(totals.discountAmount)}</b></div><div className="highlight"><small>Net total</small><b>{money(totals.netAmount)}</b></div></div>
    <div className="formRow"><label>Paid amount<input type="number" min="0" step="0.01" value={paid||0} onChange={e=>setPaid(Number(e.target.value))}/></label><label>Remaining due<input value={money(dueNow)} disabled readOnly/></label></div>
    {partyMode==="cash"&&dueNow>0&&<div className="dueGuidance">{money(dueNow)} udhaar hai. Is sale/purchase ko save karne ke liye <b>Khata {partyNoun}</b> select karein, ya full paid amount enter karein.</div>}
    {selectedProduct&&<div className="inventoryPreview"><span><small>Current stock</small><b>{rate(selectedProduct.stock_quantity)} {selectedProduct.unit}</b></span><span><small>After this entry</small><b className={projectedStock<0?"negative":""}>{rate(projectedStock)} {selectedProduct.unit}</b></span>{kind==="purchase"?<span><small>Net cost / {selectedProduct.unit}</small><b>{money(totals.effectiveUnitPrice)}</b></span>:<span><small>Estimated profit</small><b className={estimatedProfit<0?"negative":""}>{money(estimatedProfit)}</b></span>}</div>}
    {kind==="sale"&&<p className="modalNote">Profit preview current cost par estimate hai. Save par database transaction date ke mutabiq COGS snapshot lock karega.</p>}{kind==="purchase"&&<p className="modalNote">Purchase save hote hi stock plus aur net purchase cost per unit automatically update hogi.</p>}</>}

    {!inventory&&<div className="formRow"><label>Amount<input type="number" min="0.01" step="0.01" value={cashAmount||""} onChange={e=>setCashAmount(Number(e.target.value))} required/></label><label>Cash movement<input value={kind==="payment_in"?"Cash In":kind==="payment_out"||kind==="expense"?"Cash Out":"Full amount"} disabled readOnly/></label></div>}

    <div className="formRow"><label>Reference<input value={reference} onChange={e=>setReference(e.target.value)} placeholder="Blank chhorain = auto number"/><small className="fieldHint">Blank ho to system unique reference generate karega.</small></label><label>Date<input type="date" value={txDate} onChange={e=>setTxDate(e.target.value)} required/></label></div>
    <label>Notes<textarea value={notes} onChange={e=>setNotes(e.target.value)}/></label>
    {message&&<div className="calcError">{message}</div>}
    <footer className="modalActions"><button type="button" className="ghost" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy?"Saving…":"Mehfooz karein"}</button></footer>
  </form></div></div>;
}
