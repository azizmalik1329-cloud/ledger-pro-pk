"use client";

import { FormEvent, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { roundMoney, unitRateFromTotal } from "@/lib/pricing";
import "./pro-accounting.css";

type Product={id:string;business_id:string;name:string;sku:string|null;unit:string;sale_price:number;purchase_price:number;base_purchase_price:number;stock_quantity:number;low_stock_level:number;is_active:boolean};
const money=(n:number)=>`Rs. ${Number(n||0).toLocaleString("en-PK",{maximumFractionDigits:2})}`;

export default function ProProductModal({businessId,item,busy,setBusy,close,done}:{businessId:string;item:Product|null;busy:boolean;setBusy:(v:boolean)=>void;close:()=>void;done:()=>void}){
  const editing=Boolean(item);
  const [name,setName]=useState(item?.name||"");
  const [sku,setSku]=useState(item?.sku||"");
  const [unit,setUnit]=useState(item?.unit||"kg");
  const [openingQty,setOpeningQty]=useState(editing?Number(item?.stock_quantity||0):0);
  const [purchaseRate,setPurchaseRate]=useState(Number(item?.base_purchase_price??item?.purchase_price??0));
  const [saleRate,setSaleRate]=useState(Number(item?.sale_price||0));
  const [low,setLow]=useState(Number(item?.low_stock_level||0));
  const [message,setMessage]=useState("");
  const openingCost=useMemo(()=>roundMoney(openingQty*purchaseRate),[openingQty,purchaseRate]);
  const saleValue=useMemo(()=>roundMoney(openingQty*saleRate),[openingQty,saleRate]);

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setMessage("");
    if(name.trim().length<2)return setMessage("Product naam kam az kam 2 characters ka ho.");
    if(openingQty<0||purchaseRate<0||saleRate<0||low<0)return setMessage("Quantity aur rates negative nahi ho sakte.");
    setBusy(true);
    const fields={name:name.trim(),sku:sku.trim()||null,unit,sale_price:saleRate,base_purchase_price:purchaseRate,low_stock_level:low};
    const query=item
      ?supabase.from("products").update(fields).eq("id",item.id).eq("business_id",businessId)
      :supabase.from("products").insert({...fields,business_id:businessId,purchase_price:purchaseRate,stock_quantity:openingQty});
    const {error}=await query;setBusy(false);if(error)setMessage(error.message);else done();
  }

  return <div className="overlay"><div className="modal proTxModal"><header><div><small>PRODUCT SETUP</small><h2>{editing?"Product edit karein":"Naya stock item"}</h2></div><button aria-label="Close" onClick={close}>×</button></header><form onSubmit={submit}>
    <div className="formRow"><label>Product naam<input value={name} onChange={e=>setName(e.target.value)} required minLength={2} placeholder="Daal"/></label><label>SKU (optional)<input value={sku} onChange={e=>setSku(e.target.value)} placeholder="DAL-001"/><small className="fieldHint">Har product ka unique short code.</small></label></div>
    <div className="formRow"><label>Unit<select value={unit} onChange={e=>setUnit(e.target.value)}><option value="kg">KG</option><option value="pcs">Pieces</option><option value="ltr">Litre</option><option value="ctn">Carton</option><option value="bag">Bag</option><option value="box">Box</option></select></label>{editing?<label>Current stock<input value={`${item?.stock_quantity||0} ${item?.unit||unit}`} disabled readOnly/><small className="fieldHint">Stock change Purchase/Sale/Adjust se hota hai.</small></label>:<label>Opening stock quantity<input type="number" min="0" step="0.001" value={openingQty||""} onChange={e=>setOpeningQty(Number(e.target.value))}/><small className="fieldHint">Sirf initial setup/import ke liye. Aaj ki nayi khareedari Purchase screen se karein.</small></label>}</div>

    <div className="formRow"><label>Purchase cost / {unit}<input type="number" min="0" step="0.0001" value={purchaseRate||""} onChange={e=>setPurchaseRate(Number(e.target.value))}/><small className="fieldHint">Per-unit opening/base cost.</small></label>{!editing?<label>Opening stock ka total cost<input type="number" min="0" step="0.01" value={openingCost||""} onChange={e=>setPurchaseRate(unitRateFromTotal(Number(e.target.value),openingQty))}/><small className="fieldHint">Misal: 500 KG = Rs 10,000 → Rs 20/KG auto.</small></label>:<label>Current purchase rate<input value={money(Number(item?.purchase_price||0))} disabled readOnly/><small className="fieldHint">Latest valid purchase se database update karta hai.</small></label>}</div>

    <div className="formRow"><label>Default sale rate / {unit}<input type="number" min="0" step="0.0001" value={saleRate||""} onChange={e=>setSaleRate(Number(e.target.value))}/><small className="fieldHint">Sale screen par ye rate auto fill hoga.</small></label><label>{editing?"Current stock ki sale value":"Opening stock ki target sale value"}<input type="number" min="0" step="0.01" value={saleValue||""} onChange={e=>setSaleRate(unitRateFromTotal(Number(e.target.value),openingQty))}/><small className="fieldHint">Misal: 500 KG ko Rs 15,000 mein bechna ho → Rs 30/KG auto.</small></label></div>

    <div className="inventoryPreview"><span><small>Purchase rate</small><b>{money(purchaseRate)} / {unit}</b></span><span><small>Sale rate</small><b>{money(saleRate)} / {unit}</b></span><span><small>Margin / {unit}</small><b className={saleRate-purchaseRate<0?"negative":""}>{money(saleRate-purchaseRate)}</b></span></div>
    <label>Low stock alert<input type="number" min="0" step="0.001" value={low||""} onChange={e=>setLow(Number(e.target.value))}/></label>
    {message&&<div className="calcError">{message}</div>}
    <footer className="modalActions"><button type="button" className="ghost" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy?"Saving…":"Mehfooz karein"}</button></footer>
  </form></div></div>;
}
