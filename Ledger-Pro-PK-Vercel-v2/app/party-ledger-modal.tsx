"use client";

import { useMemo } from "react";

type Contact={id:string;type:"customer"|"supplier";name:string;phone:string|null;email:string|null;opening_balance:number;is_active:boolean};
type Product={id:string;name:string;unit:string};
type Tx={id:string;contact_id:string|null;product_id:string|null;quantity:number|null;type:"sale"|"purchase"|"payment_in"|"payment_out"|"expense";reference:string|null;amount:number;paid_amount:number;transaction_date:string;notes:string|null;is_void:boolean;created_at:string};

const money=(n:number)=>`Rs. ${Number(n||0).toLocaleString("en-PK",{maximumFractionDigits:2})}`;
const labels:Record<Tx["type"],string>={sale:"Farokht",purchase:"Khareedari",payment_in:"Wasooli",payment_out:"Adayegi",expense:"Kharcha"};

function deltaFor(contact:Contact,tx:Tx){
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

export function partyBalance(contact:Contact,transactions:Tx[]){
  return transactions.reduce((sum,tx)=>sum+deltaFor(contact,tx),Number(contact.opening_balance||0));
}

export default function PartyLedgerModal({contact,transactions,products,close,recordPayment}:{contact:Contact;transactions:Tx[];products:Product[];close:()=>void;recordPayment:(contact:Contact)=>void}){
  const rows=useMemo(()=>{
    const linked=transactions.filter(t=>!t.is_void&&t.contact_id===contact.id&&deltaFor(contact,t)!==0).sort((a,b)=>`${a.transaction_date}|${a.created_at}`.localeCompare(`${b.transaction_date}|${b.created_at}`));
    let running=Number(contact.opening_balance||0);
    return linked.map(tx=>{const delta=deltaFor(contact,tx);running+=delta;return {tx,delta,balance:running}});
  },[contact,transactions]);
  const current=partyBalance(contact,transactions);
  const positiveLabel=contact.type==="customer"?"Wasooli baqi":"Adayegi baqi";
  const paymentLabel=contact.type==="customer"?"＋ Wasooli darj karein":"＋ Supplier adayegi darj karein";

  return <div className="overlay"><div className="modal partyLedgerModal"><header><div><small>{contact.type==="customer"?"CUSTOMER LEDGER":"SUPPLIER LEDGER"}</small><h2>{contact.name}</h2><p className="ledgerContactMeta">{contact.phone||contact.email||"Contact detail nahi"}</p></div><button aria-label="Close" onClick={close}>×</button></header>
    <div className="ledgerSummary"><div><small>Opening balance</small><b>{money(contact.opening_balance)}</b></div><div className={current<0?"advance":"due"}><small>{current<0?"Advance":positiveLabel}</small><b>{money(Math.abs(current))}</b></div><button className="primary" onClick={()=>recordPayment(contact)}>{paymentLabel}</button></div>
    <div className="ledgerExplain">Sale/Purchase ka unpaid hissa balance barhata hai. Baad ki Wasooli/Adayegi balance kam karti hai.</div>
    <div className="tableWrap ledgerTable">{!rows.length?<div className="empty"><i>≡</i><b>Abhi ledger movement nahi</b><p>Opening balance ke ilawa koi entry nahi.</p></div>:<table><thead><tr><th>Date</th><th>Reference</th><th>Detail</th><th>Invoice/Bill</th><th>Paid at entry</th><th>Wasooli/Adayegi</th><th>Balance</th></tr></thead><tbody>{rows.map(({tx,delta,balance})=>{const invoice=tx.type==="sale"||tx.type==="purchase";const payment=tx.type==="payment_in"||tx.type==="payment_out";const product=products.find(p=>p.id===tx.product_id);return <tr key={tx.id}><td data-label="Date">{tx.transaction_date}</td><td data-label="Reference"><b>{tx.reference||"—"}</b></td><td data-label="Detail">{labels[tx.type]}{product?` · ${product.name}`:""}</td><td data-label="Invoice/Bill">{invoice?money(tx.amount):"—"}</td><td data-label="Paid at entry">{invoice&&tx.paid_amount?money(tx.paid_amount):"—"}</td><td data-label="Wasooli/Adayegi">{payment?money(tx.amount):"—"}</td><td data-label="Balance"><b className={balance<0?"ledgerAdvance":""}>{balance<0?`Advance ${money(Math.abs(balance))}`:money(balance)}</b></td></tr>})}</tbody></table>}</div>
    <footer className="modalActions"><button className="ghost" onClick={close}>Band karein</button><button className="primary" onClick={()=>recordPayment(contact)}>{paymentLabel}</button></footer>
  </div></div>;
}
