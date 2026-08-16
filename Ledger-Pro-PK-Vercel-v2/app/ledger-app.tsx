"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { cashInForTransaction, cashOutForTransaction, summarizeAccounting } from "@/lib/accounting";
import { localDateInputValue } from "@/lib/pricing";
import ProTransactionModal from "./pro-transaction-modal";
import ProProductModal from "./pro-product-modal";

type Section="dashboard"|"contacts"|"sales"|"purchases"|"stock"|"cash"|"reports"|"settings";
type Role="owner"|"manager"|"staff";
type Contact={id:string;business_id:string;type:"customer"|"supplier";name:string;phone:string|null;email:string|null;opening_balance:number;notes:string|null;is_active:boolean;created_at:string};
type Product={id:string;business_id:string;name:string;sku:string|null;unit:string;sale_price:number;purchase_price:number;base_purchase_price:number;stock_quantity:number;low_stock_level:number;is_active:boolean};
type DiscountType="none"|"amount"|"percent";
type Tx={id:string;business_id:string;contact_id:string|null;product_id:string|null;quantity:number|null;type:"sale"|"purchase"|"payment_in"|"payment_out"|"expense";reference:string|null;unit_price:number;gross_amount:number;discount_type:DiscountType;discount_value:number;discount_amount:number;amount:number;paid_amount:number;unit_cost:number;cost_amount:number;transaction_date:string;notes:string|null;status:"paid"|"partial"|"unpaid";is_void:boolean;voided_at:string|null;voided_by:string|null;void_reason:string|null;created_at:string};
type Business={id:string;name:string;currency:string;status:"active"|"suspended"|"archived";plan:"free"|"pro"|"business";trial_ends_at:string|null;plan_expires_at:string|null;phone:string|null;address:string|null;tax_number:string|null;invoice_prefix:string;max_members:number;max_monthly_transactions:number};
type Membership={business_id:string;role:Role;businesses:Business|null};
type Member={user_id:string;email:string;full_name:string;role:Role;created_at:string};
type Audit={id:number;action:string;entity_type:string;entity_id:string|null;created_at:string};
type Modal="contact"|"product"|"transaction"|"adjustment"|null;
type Accounting=ReturnType<typeof summarizeAccounting>;

const nav:[Section,string,string][]=[
  ["dashboard","Dashboard","▦"],["contacts","Khatay","♙"],["sales","Farokht","↗"],
  ["purchases","Khareedari","↙"],["stock","Stock","□"],["cash","Cash","₨"],["reports","Reports","⌁"],["settings","Settings","⚙"]
];
const mobilePrimary:Section[]=["dashboard","contacts","sales","stock"];
const txLabel:Record<Tx["type"],string>={sale:"Farokht",purchase:"Khareedari",payment_in:"Wasooli",payment_out:"Adayegi",expense:"Kharcha"};
const money=(n:number)=>`Rs. ${Number(n||0).toLocaleString("en-PK",{maximumFractionDigits:2})}`;
const qty=(n:number)=>Number(n||0).toLocaleString("en-PK",{maximumFractionDigits:3});
const today=()=>localDateInputValue();

function contactBalance(contact:Contact,transactions:Tx[]){
  const linked=transactions.filter(t=>!t.is_void&&t.contact_id===contact.id);
  if(contact.type==="customer"){
    const invoices=linked.filter(t=>t.type==="sale").reduce((s,t)=>s+Math.max(0,Number(t.amount)-Number(t.paid_amount)),0);
    const payments=linked.filter(t=>t.type==="payment_in").reduce((s,t)=>s+Number(t.amount),0);
    return Number(contact.opening_balance||0)+invoices-payments;
  }
  const bills=linked.filter(t=>t.type==="purchase").reduce((s,t)=>s+Math.max(0,Number(t.amount)-Number(t.paid_amount)),0);
  const payments=linked.filter(t=>t.type==="payment_out").reduce((s,t)=>s+Number(t.amount),0);
  return Number(contact.opening_balance||0)+bills-payments;
}

export default function LedgerApp(){
  const [session,setSession]=useState<Session|null>(null),[booting,setBooting]=useState(true),[recovering,setRecovering]=useState(false);
  const [accountResolved,setAccountResolved]=useState(false),[accountLoading,setAccountLoading]=useState(false),[accountError,setAccountError]=useState("");
  const [isPlatformAdmin,setIsPlatformAdmin]=useState(false),[section,setSection]=useState<Section>("dashboard"),[dark,setDark]=useState(false),[search,setSearch]=useState("");
  const [businessId,setBusinessId]=useState(""),[businessName,setBusinessName]=useState("Mera Business"),[role,setRole]=useState<Role|"">("");
  const [business,setBusiness]=useState<Business|null>(null),[memberships,setMemberships]=useState<Membership[]>([]),[members,setMembers]=useState<Member[]>([]),[audit,setAudit]=useState<Audit[]>([]);
  const [contacts,setContacts]=useState<Contact[]>([]),[products,setProducts]=useState<Product[]>([]),[transactions,setTransactions]=useState<Tx[]>([]);
  const [settingsLoadedFor,setSettingsLoadedFor]=useState(""),[settingsLoading,setSettingsLoading]=useState(false);
  const [modal,setModal]=useState<Modal>(null),[editing,setEditing]=useState<Contact|Product|Tx|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  const [mobileMore,setMobileMore]=useState(false),[mobileSearch,setMobileSearch]=useState(false);
  const loadSeq=useRef(0);

  useEffect(()=>{
    setDark(localStorage.getItem("ledger-dark")==="1");
    if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
    void supabase.auth.getSession().then(({data})=>{setSession(data.session);setBooting(false)});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,s)=>{
      if(event==="PASSWORD_RECOVERY")setRecovering(true);
      setSession(s);setBooting(false);
    });
    return()=>subscription.unsubscribe();
  },[]);

  useEffect(()=>{if(session?.user.id)void loadApp();else resetApp()},[session?.user.id]);
  useEffect(()=>{
    if(section==="settings"&&businessId&&role==="owner"&&settingsLoadedFor!==businessId&&!settingsLoading)void loadSettingsData(businessId);
  },[section,businessId,role,settingsLoadedFor,settingsLoading]);

  const accounting=useMemo(()=>summarizeAccounting(transactions,contacts),[transactions,contacts]);
  const toast=(m:string)=>{setNotice(m);window.setTimeout(()=>setNotice(""),3200)};
  const canManage=role==="owner"||role==="manager";

  function resetApp(){
    loadSeq.current+=1;setAccountResolved(false);setAccountLoading(false);setAccountError("");setIsPlatformAdmin(false);
    setBusinessId("");setBusiness(null);setMemberships([]);setContacts([]);setProducts([]);setTransactions([]);setMembers([]);setAudit([]);setSettingsLoadedFor("");
  }

  async function loadApp(preferredBusinessId?:string){
    const seq=++loadSeq.current;setAccountLoading(true);setAccountError("");if(!business)setAccountResolved(false);
    const [membershipResult,adminResult]=await Promise.all([
      supabase.from("business_members").select("business_id,role,businesses(id,name,currency,status,plan,trial_ends_at,plan_expires_at,phone,address,tax_number,invoice_prefix,max_members,max_monthly_transactions)"),
      supabase.rpc("platform_admin_me")
    ]);
    if(seq!==loadSeq.current)return;
    if(membershipResult.error){setAccountError(membershipResult.error.message);setAccountResolved(true);setAccountLoading(false);return}
    setIsPlatformAdmin(adminResult.error?false:Boolean(adminResult.data));
    const rows=(membershipResult.data||[]) as unknown as Membership[];setMemberships(rows);
    if(!rows.length){setBusiness(null);setBusinessId("");setContacts([]);setProducts([]);setTransactions([]);setAccountResolved(true);setAccountLoading(false);return}

    const saved=preferredBusinessId||localStorage.getItem("ledger-business-id")||"";
    const membership=rows.find(x=>x.business_id===saved)||rows[0];
    const bid=membership.business_id,details=membership.businesses;
    localStorage.setItem("ledger-business-id",bid);
    setContacts([]);setProducts([]);setTransactions([]);setMembers([]);setAudit([]);setSettingsLoadedFor("");
    setBusinessId(bid);setRole(membership.role);setBusiness(details);setBusinessName(details?.name||"Mera Business");setSearch("");

    if(!details||details.status!=="active"||(details.plan_expires_at&&new Date(details.plan_expires_at).getTime()<Date.now())){
      setAccountResolved(true);setAccountLoading(false);return;
    }
    const [c,p,t]=await Promise.all([
      supabase.from("contacts").select("*").eq("business_id",bid).order("created_at",{ascending:false}),
      supabase.from("products").select("*").eq("business_id",bid).order("name"),
      supabase.from("transactions").select("*").eq("business_id",bid).eq("is_void",false).order("transaction_date",{ascending:false}).order("created_at",{ascending:false})
    ]);
    if(seq!==loadSeq.current)return;
    if(c.error||p.error||t.error){setAccountError(c.error?.message||p.error?.message||t.error?.message||"Financial data load nahi ho saka.");setAccountResolved(true);setAccountLoading(false);return}
    setContacts((c.data||[]) as Contact[]);setProducts((p.data||[]) as Product[]);setTransactions((t.data||[]) as Tx[]);setAccountResolved(true);setAccountLoading(false);
  }

  async function loadSettingsData(bid:string,force=false){
    if(role!=="owner"||(!force&&settingsLoadedFor===bid))return;setSettingsLoading(true);
    const [m,a]=await Promise.all([
      supabase.rpc("owner_members_for_business",{p_business_id:bid}),
      supabase.from("audit_logs").select("id,action,entity_type,entity_id,created_at").eq("business_id",bid).order("created_at",{ascending:false}).limit(30)
    ]);
    setSettingsLoading(false);if(m.error||a.error){toast(m.error?.message||a.error?.message||"Settings data load error");return}
    setMembers((m.data||[]) as Member[]);setAudit((a.data||[]) as Audit[]);setSettingsLoadedFor(bid);
  }
  async function reloadContacts(){if(!businessId)return;const r=await supabase.from("contacts").select("*").eq("business_id",businessId).order("created_at",{ascending:false});if(r.error)return toast(r.error.message);setContacts((r.data||[]) as Contact[])}
  async function reloadProducts(){if(!businessId)return;const r=await supabase.from("products").select("*").eq("business_id",businessId).order("name");if(r.error)return toast(r.error.message);setProducts((r.data||[]) as Product[])}
  async function reloadTransactionsAndProducts(){
    if(!businessId)return;const [t,p]=await Promise.all([
      supabase.from("transactions").select("*").eq("business_id",businessId).eq("is_void",false).order("transaction_date",{ascending:false}).order("created_at",{ascending:false}),
      supabase.from("products").select("*").eq("business_id",businessId).order("name")
    ]);
    if(t.error||p.error)return toast(t.error?.message||p.error?.message||"Data refresh error");setTransactions((t.data||[]) as Tx[]);setProducts((p.data||[]) as Product[]);
  }

  function goto(key:Section){setSection(key);setSearch("");setMobileMore(false);setMobileSearch(false)}
  function open(kind:Modal,item:Contact|Product|Tx|null=null){setEditing(item);setModal(kind)}
  function close(){setModal(null);setEditing(null)}
  function switchBusiness(id:string){setMobileMore(false);void loadApp(id)}
  function toggleDark(){setDark(v=>{localStorage.setItem("ledger-dark",v?"0":"1");return !v})}

  async function archiveContact(id:string,label:string){if(!confirm(`${label} ko archive karna hai? Balance zero hona lazmi hai.`))return;const r=await supabase.rpc("archive_contact",{p_business_id:businessId,p_contact_id:id});if(r.error)return toast(r.error.message);toast("Khata archive ho gaya");void reloadContacts()}
  async function restoreContact(id:string){const r=await supabase.rpc("restore_contact",{p_business_id:businessId,p_contact_id:id});if(r.error)return toast(r.error.message);toast("Khata restore ho gaya");void reloadContacts()}
  async function archiveProduct(id:string,label:string){if(!confirm(`${label} ko archive karna hai? Stock zero hona lazmi hai.`))return;const r=await supabase.rpc("archive_product",{p_business_id:businessId,p_product_id:id});if(r.error)return toast(r.error.message);toast("Product archive ho gaya");void reloadProducts()}
  async function restoreProduct(id:string){const r=await supabase.rpc("restore_product",{p_business_id:businessId,p_product_id:id});if(r.error)return toast(r.error.message);toast("Product restore ho gaya");void reloadProducts()}
  async function voidTransaction(id:string,label:string){const reason=prompt(`${label} ko void karna hai. Reason likhein:`);if(reason===null)return;if(reason.trim().length<3)return toast("Void reason kam az kam 3 characters ka ho");const r=await supabase.rpc("void_transaction",{p_business_id:businessId,p_transaction_id:id,p_reason:reason.trim()});if(r.error)return toast(r.error.message);toast("Transaction void ho gayi; stock safely reverse ho gaya");void reloadTransactionsAndProducts()}

  function exportCsv(){
    const rows:(string|number)[][]=[["Date","Type","Reference","Contact","Product","Quantity","Unit Rate","Gross","Discount","Net","Paid","Due","Cost","Status"],...transactions.map(t=>[
      t.transaction_date,txLabel[t.type],t.reference||"",contacts.find(c=>c.id===t.contact_id)?.name||"",products.find(p=>p.id===t.product_id)?.name||"",t.quantity||"",t.unit_price||"",t.gross_amount||t.amount,t.discount_amount||0,t.amount,t.paid_amount,Math.max(0,t.amount-t.paid_amount),t.cost_amount,t.status
    ])];
    const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`ledger-${businessName.replace(/\s+/g,"-").toLowerCase()}-${today()}.csv`;a.click();URL.revokeObjectURL(a.href);toast("CSV report download ho gayi");
  }

  function newRecord(){if(section==="contacts")open("contact");else if(section==="stock")open("product");else if(!["reports","settings"].includes(section))open("transaction")}
  const defaultTxType:Tx["type"]=section==="purchases"?"purchase":section==="cash"?"payment_in":"sale";

  if(booting)return <Splash text="Ledger Pro PK load ho raha hai…"/>;
  if(recovering&&session)return <ResetPassword done={()=>setRecovering(false)}/>;
  if(!session)return <Auth/>;
  if(!accountResolved)return <Splash text="Business data secure tareeqe se load ho raha hai…"/>;
  if(accountError)return <Blocked title="Data load nahi hua" text={accountError} retry={()=>void loadApp()} logout={()=>void supabase.auth.signOut()}/>;
  if(!business)return <Blocked title="Business linked nahi hai" text="Owner se access mangain ya Super Admin panel use karein." retry={()=>void loadApp()} logout={()=>void supabase.auth.signOut()} admin={isPlatformAdmin}/>;
  const expired=Boolean(business.plan_expires_at&&new Date(business.plan_expires_at).getTime()<Date.now());
  if(business.status!=="active"||expired)return <Blocked title={expired?"Plan expire ho gaya":`Business ${business.status} hai`} text="Account access ke liye plan/status update karein." retry={()=>void loadApp()} logout={()=>void supabase.auth.signOut()} admin={isPlatformAdmin}/>;

  const q=search.trim().toLowerCase();
  const filteredContacts=contacts.filter(x=>`${x.name} ${x.phone||""} ${x.email||""}`.toLowerCase().includes(q));
  const filteredProducts=products.filter(x=>`${x.name} ${x.sku||""}`.toLowerCase().includes(q));
  const filteredTx=transactions.filter(x=>`${x.reference||""} ${txLabel[x.type]} ${contacts.find(c=>c.id===x.contact_id)?.name||""} ${products.find(p=>p.id===x.product_id)?.name||""}`.toLowerCase().includes(q));
  const showAdd=section!=="reports"&&section!=="settings";

  return <main className={dark?"app dark":"app"} aria-busy={accountLoading}>
    <aside><div className="brand"><b>LP</b><span><strong>Ledger Pro PK</strong><small>BUSINESS OS</small></span></div><div className="business businessPicker"><i>{businessName[0]?.toUpperCase()}</i><span><small>{role}</small><select value={businessId} onChange={e=>switchBusiness(e.target.value)}>{memberships.map(m=><option key={m.business_id} value={m.business_id}>{m.businesses?.name||"Business"}</option>)}</select></span></div><p className="menuLabel">MENU</p><nav>{nav.map(([key,label,icon])=><button key={key} className={section===key?"active":""} onClick={()=>goto(key)}><i>{icon}</i><span><b>{label}</b><small>{key==="dashboard"?"Mukhtasar jaiza":"Record manage karein"}</small></span></button>)}{isPlatformAdmin&&<button onClick={()=>location.assign("/admin")}><i>♛</i><span><b>Super Admin</b><small>Platform management</small></span></button>}</nav><div className="secure"><i/><span><b>Supabase secured</b><small>RLS data protection</small></span></div></aside>
    <section className="workspace"><header><div className="mobileBrand">LP</div><div className="mobileTitle"><b>{nav.find(n=>n[0]===section)?.[1]}</b><select className="mobileBusinessSwitch" value={businessId} onChange={e=>switchBusiness(e.target.value)}>{memberships.map(m=><option key={m.business_id} value={m.business_id}>{m.businesses?.name||"Business"}</option>)}</select></div><label className="search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Naam, invoice ya item talash karein…"/></label><div className="topActions"><button className="mobileOnly" aria-label="Search" onClick={()=>setMobileSearch(v=>!v)}>⌕</button><button aria-label="Theme" onClick={toggleDark}>{dark?"☀":"☾"}</button><span className="user"><b>{session.user.email?.split("@")[0]}</b><small>{role}</small></span><button className="logout" onClick={()=>void supabase.auth.signOut()}>Logout</button></div></header>
      {mobileSearch&&<label className="mobileSearchBox"><span>⌕</span><input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="Naam, invoice ya item…"/><button onClick={()=>{setSearch("");setMobileSearch(false)}}>×</button></label>}
      <div className="content"><div className="heading"><div><small>{new Date().toLocaleDateString("en-PK",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</small><h1>{nav.find(n=>n[0]===section)?.[1]}</h1><p>{businessName} ki real-time maloomat secure database se.</p></div><div><button className="ghost" onClick={exportCsv}>⇩ Export</button>{showAdd&&<button className="primary" onClick={newRecord}>＋ Naya record</button>}</div></div>
        {section==="dashboard"&&<Dashboard accounting={accounting} transactions={transactions.slice(0,6)} contacts={contacts} products={products} open={open} canManage={canManage}/>} 
        {section==="contacts"&&<Contacts rows={filteredContacts} transactions={transactions} open={open} archive={archiveContact} restore={restoreContact} canManage={canManage}/>} 
        {section==="sales"&&<Transactions title="Farokht aur wasooli" rows={filteredTx.filter(x=>x.type==="sale"||x.type==="payment_in")} contacts={contacts} products={products} open={open} voidTx={voidTransaction} canManage={canManage}/>} 
        {section==="purchases"&&<Transactions title="Khareedari aur supplier adayegi" rows={filteredTx.filter(x=>x.type==="purchase"||x.type==="payment_out")} contacts={contacts} products={products} open={open} voidTx={voidTransaction} canManage={canManage}/>} 
        {section==="stock"&&<Products rows={filteredProducts} open={open} archive={archiveProduct} restore={restoreProduct} canManage={canManage}/>} 
        {section==="cash"&&<CashLedger rows={filteredTx} contacts={contacts}/>} 
        {section==="reports"&&<Reports accounting={accounting} contacts={contacts} transactions={transactions} products={products}/>} 
        {section==="settings"&&<Settings business={business} role={role} members={members} audit={audit} loading={settingsLoading} reloadBusiness={()=>void loadApp(businessId)} reloadSettings={()=>void loadSettingsData(businessId,true)}/>} 
      </div>
      {mobileMore&&<div className="mobileMore" role="dialog" aria-label="More navigation"><div className="mobileMoreHead"><b>Mazeed options</b><button onClick={()=>setMobileMore(false)}>×</button></div>{(["purchases","cash","reports","settings"] as Section[]).map(key=>{const item=nav.find(n=>n[0]===key)!;return <button key={key} onClick={()=>goto(key)}><i>{item[2]}</i><span>{item[1]}</span></button>})}<button onClick={exportCsv}><i>⇩</i><span>Export CSV</span></button>{isPlatformAdmin&&<button onClick={()=>location.assign("/admin")}><i>♛</i><span>Super Admin</span></button>}</div>}
      <nav className="mobileNav">{mobilePrimary.map(key=>{const item=nav.find(n=>n[0]===key)!;return <button key={key} className={section===key?"active":""} onClick={()=>goto(key)}><i>{item[2]}</i><small>{item[1]}</small></button>})}<button className={!mobilePrimary.includes(section)?"active":""} onClick={()=>setMobileMore(v=>!v)}><i>•••</i><small>More</small></button></nav>
    </section>
    {modal==="contact"&&<ContactModal businessId={businessId} item={editing as Contact|null} busy={busy} setBusy={setBusy} close={close} done={()=>{close();toast("Khata mehfooz ho gaya");void reloadContacts()}}/>}
    {modal==="product"&&<ProProductModal businessId={businessId} item={editing as Product|null} busy={busy} setBusy={setBusy} close={close} done={()=>{close();toast("Product mehfooz ho gaya");void reloadProducts()}}/>}
    {modal==="transaction"&&<ProTransactionModal businessId={businessId} item={editing as Tx|null} defaultType={defaultTxType} contacts={contacts} products={products} busy={busy} setBusy={setBusy} close={close} done={()=>{close();toast("Transaction, calculation aur stock update ho gaye");void reloadTransactionsAndProducts()}}/>}
    {modal==="adjustment"&&<StockAdjustmentModal businessId={businessId} item={editing as Product} busy={busy} setBusy={setBusy} close={close} done={()=>{close();toast("Stock adjustment save ho gayi");void reloadProducts();if(section==="settings")void loadSettingsData(businessId,true)}}/>}
    {notice&&<div className="toast">✓ {notice}</div>}
  </main>;
}

function Splash({text}:{text:string}){return <div className="splash"><div className="logo">LP</div><p>{text}</p></div>}
function Blocked({title,text,retry,logout,admin=false}:{title:string;text:string;retry:()=>void;logout:()=>void;admin?:boolean}){return <main className="blocked"><div className="logo">LP</div><h1>{title}</h1><p>{text}</p><button onClick={retry}>Dobara koshish karein</button>{admin&&<button onClick={()=>location.assign("/admin")}>Super Admin</button>}<button onClick={logout}>Logout</button></main>}

function Auth(){
  const [signup,setSignup]=useState(false),[forgot,setForgot]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setMessage("");const f=new FormData(e.currentTarget),email=String(f.get("email")||"").trim(),password=String(f.get("password")||"");
    if(forgot){const r=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin});setBusy(false);setMessage(r.error?r.error.message:"Password reset link email par bhej diya gaya.");return}
    if(signup&&!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/.test(password)){setBusy(false);setMessage("Password 12+ characters ho aur capital, small, number aur symbol shamil hon.");return}
    const r=signup?await supabase.auth.signUp({email,password,options:{data:{full_name:String(f.get("name")||""),business_name:String(f.get("business")||"")},emailRedirectTo:location.origin}}):await supabase.auth.signInWithPassword({email,password});setBusy(false);if(r.error)setMessage(r.error.message);else if(signup&&!r.data.session)setMessage("Account ban gaya. Email inbox se confirmation link open karein.");
  }
  return <main className="auth"><section><div className="authBrand"><b>LP</b><span><strong>Ledger Pro PK</strong><small>Secure Business Management</small></span></div><h1>Apna business<br/><em>confidence se chalayein.</em></h1><p>Customers, udhaar, stock, sales aur cash—sab aik secure jagah.</p><ul><li>✓ Har business ka data alag aur mehfooz</li><li>✓ Mobile aur desktop par kaam</li><li>✓ Auto stock, pricing aur profit calculation</li></ul></section><form onSubmit={submit}><small>{forgot?"ACCOUNT RECOVERY":signup?"NAYA ACCOUNT":"WELCOME BACK"}</small><h2>{forgot?"Password reset karein":signup?"Business shuru karein":"Login karein"}</h2>{signup&&!forgot&&<><label>Apka naam<input name="name" required minLength={2}/></label><label>Business naam<input name="business" required minLength={2}/></label></>}<label>Email<input name="email" type="email" required/></label>{!forgot&&<label>Password<input name="password" type="password" required minLength={signup?12:8}/></label>}{message&&<p className="formMessage">{message}</p>}<button className="primary" disabled={busy}>{busy?"Please wait…":forgot?"Reset link bhejein":signup?"Account banayein":"Login"}</button>{!signup&&!forgot&&<p><button type="button" onClick={()=>{setForgot(true);setMessage("")}}>Password bhool gaye?</button></p>}<p>{forgot?"Password yaad aa gaya?":signup?"Account pehle se hai?":"Naya account chahiye?"} <button type="button" onClick={()=>{if(forgot)setForgot(false);else setSignup(!signup);setMessage("")}}>{forgot?"Login":signup?"Login":"Sign up"}</button></p></form></main>;
}
function ResetPassword({done}:{done:()=>void}){const [busy,setBusy]=useState(false),[message,setMessage]=useState("");async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const p=String(new FormData(e.currentTarget).get("password")||"");if(!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,}$/.test(p))return setMessage("12+ characters, capital, small, number aur symbol lazmi hain.");setBusy(true);const r=await supabase.auth.updateUser({password:p});setBusy(false);if(r.error)setMessage(r.error.message);else done()}return <main className="auth"><section><div className="authBrand"><b>LP</b><span><strong>Ledger Pro PK</strong><small>Secure recovery</small></span></div><h1>Naya password<br/><em>mehfooz rakhein.</em></h1></section><form onSubmit={submit}><h2>Naya password set karein</h2><label>New password<input name="password" type="password" minLength={12} required/></label>{message&&<p className="formMessage">{message}</p>}<button className="primary" disabled={busy}>{busy?"Saving…":"Password update karein"}</button></form></main>}

function Dashboard({accounting,transactions,contacts,products,open,canManage}:{accounting:Accounting;transactions:Tx[];contacts:Contact[];products:Product[];open:(m:Modal,i?:Contact|Product|Tx|null)=>void;canManage:boolean}){const stockValue=products.filter(p=>p.is_active).reduce((s,p)=>s+Number(p.stock_quantity)*Number(p.purchase_price),0);return <><div className="stats"><Stat icon="↗" label="Net farokht" value={money(accounting.saleRevenue)} tone="green"/><Stat icon="◎" label="Net profit" value={money(accounting.netProfit)} tone="orange"/><Stat icon="₨" label="Cash balance" value={money(accounting.cashBalance)} tone="blue"/><Stat icon="□" label="Stock cost value" value={money(stockValue)} tone="purple"/></div><div className="grid2"><article className="panel"><PanelHead title="Fori kaam" sub="Rozana ke common tasks"/><div className="quick"><button onClick={()=>open("transaction")}><i>↗</i><b>Nayi sale</b><small>Auto calculation</small></button><button onClick={()=>open("contact")}><i>♙</i><b>Naya khata</b><small>Customer/supplier</small></button><button onClick={()=>open("product")}><i>□</i><b>Stock item</b><small>Rates & unit</small></button></div></article><article className="panel"><PanelHead title="Stock alerts" sub="Low stock products"/><div className="alerts">{products.filter(p=>p.is_active&&Number(p.stock_quantity)<=Number(p.low_stock_level)).slice(0,4).map(p=><div key={p.id}><i>{p.name[0]}</i><span><b>{p.name}</b><small>{qty(p.stock_quantity)} {p.unit}</small></span><em>Low</em></div>)}{!products.filter(p=>p.is_active).length&&<Empty text="Abhi koi product nahi"/>}</div></article></div><article className="panel"><PanelHead title="Haliya transactions" sub="Gross, discount, net aur due"/><TxTable rows={transactions} contacts={contacts} products={products} open={open} canManage={canManage}/></article></>}
function Stat({icon,label,value,tone}:{icon:string;label:string;value:string;tone:string}){return <article className="stat"><i className={tone}>{icon}</i><small>{label}</small><strong>{value}</strong><p>Live database</p></article>}
function PanelHead({title,sub}:{title:string;sub:string}){return <div className="panelHead"><div><h3>{title}</h3><p>{sub}</p></div></div>}
function Empty({text}:{text:string}){return <div className="empty"><i>⌕</i><b>{text}</b><p>Naya record add karke shuru karein.</p></div>}

function Contacts({rows,transactions,open,archive,restore,canManage}:{rows:Contact[];transactions:Tx[];open:(m:Modal,i?:Contact)=>void;archive:(id:string,l:string)=>void;restore:(id:string)=>void;canManage:boolean}){const active=rows.filter(x=>x.is_active),archived=rows.filter(x=>!x.is_active);const card=(x:Contact,arch=false)=>{const balance=contactBalance(x,transactions);return <div className="contactCard" key={x.id}><i>{x.name.split(" ").map(s=>s[0]).slice(0,2).join("")}</i><span><small>{x.type==="customer"?"Customer":"Supplier"}{arch?" · Archived":""}</small><b>{x.name}</b><em>{x.phone||x.email||"No contact"}</em></span><section><small>{balance>=0?(x.type==="customer"?"Wasooli baqi":"Adayegi baqi"):"Advance"}</small><b>{money(Math.abs(balance))}</b><small>Opening: {money(x.opening_balance)}</small>{canManage&&<div>{!arch&&<button onClick={()=>open("contact",x)}>Edit</button>}{arch?<button onClick={()=>restore(x.id)}>Restore</button>:<button className="danger" onClick={()=>archive(x.id,x.name)}>Archive</button>}</div>}</section></div>};return <article className="panel full"><PanelHead title="Customer aur supplier khatay" sub="Current balance auto ledger se calculate hota hai"/><div className="cards">{active.map(x=>card(x))}{!active.length&&<Empty text="Koi active khata nahi mila"/>}</div>{archived.length>0&&<details className="archiveGroup"><summary>Archived khatay ({archived.length})</summary><div className="cards">{archived.map(x=>card(x,true))}</div></details>}</article>}

function Products({rows,open,archive,restore,canManage}:{rows:Product[];open:(m:Modal,i?:Product)=>void;archive:(id:string,l:string)=>void;restore:(id:string)=>void;canManage:boolean}){const active=rows.filter(x=>x.is_active),archived=rows.filter(x=>!x.is_active);const card=(x:Product,arch=false)=><div className="productCard" key={x.id}><div><i>{x.name[0]}</i><small>{x.sku||"NO SKU"}{arch?" · ARCHIVED":""}</small></div><h3>{x.name}</h3><section><span><small>Stock</small><b>{qty(x.stock_quantity)} {x.unit}</b></span><span><small>Sale rate</small><b>{money(x.sale_price)} / {x.unit}</b></span></section><p className="purchaseRate">Purchase: <b>{money(x.purchase_price)}</b> / {x.unit} · Margin: <b>{money(Number(x.sale_price)-Number(x.purchase_price))}</b> / {x.unit}</p><p className="purchaseRate">Stock cost: <b>{money(Number(x.stock_quantity)*Number(x.purchase_price))}</b> · Sale value: <b>{money(Number(x.stock_quantity)*Number(x.sale_price))}</b></p><em className={Number(x.stock_quantity)<=Number(x.low_stock_level)?"low":"ok"}>{Number(x.stock_quantity)<=Number(x.low_stock_level)?"Low stock":"Stock okay"}</em>{canManage&&<footer>{arch?<button onClick={()=>restore(x.id)}>Restore</button>:<><button onClick={()=>open("product",x)}>Edit</button><button onClick={()=>open("adjustment",x)}>Adjust</button><button className="danger" onClick={()=>archive(x.id,x.name)}>Archive</button></>}</footer>}</div>;return <article className="panel full"><PanelHead title="Stock inventory" sub="Per-unit cost, sale rate, margin aur valuation auto"/><div className="productGrid">{active.map(x=>card(x))}{!active.length&&<Empty text="Koi active product nahi mila"/>}</div>{archived.length>0&&<details className="archiveGroup"><summary>Archived products ({archived.length})</summary><div className="productGrid">{archived.map(x=>card(x,true))}</div></details>}</article>}

function Transactions({title,rows,contacts,products,open,voidTx,canManage}:{title:string;rows:Tx[];contacts:Contact[];products:Product[];open:(m:Modal,i?:Tx)=>void;voidTx:(id:string,l:string)=>void;canManage:boolean}){return <article className="panel full"><PanelHead title={title} sub="Rate × quantity → gross → discount → net → due"/><TxTable rows={rows} contacts={contacts} products={products} open={open} voidTx={voidTx} canManage={canManage}/></article>}
function TxTable({rows,contacts,products,open,voidTx,canManage=true}:{rows:Tx[];contacts:Contact[];products:Product[];open:(m:Modal,i?:Tx)=>void;voidTx?:(id:string,l:string)=>void;canManage?:boolean}){return <div className="tableWrap">{!rows.length?<Empty text="Koi transaction nahi mili"/>:<table><thead><tr><th>Date</th><th>Reference</th><th>Naam</th><th>Item / Qty</th><th>Type</th><th>Gross</th><th>Discount</th><th>Net</th><th>Paid</th><th>Due</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td data-label="Date">{x.transaction_date}</td><td data-label="Reference"><b>{x.reference||"—"}</b></td><td data-label="Naam">{contacts.find(c=>c.id===x.contact_id)?.name||"Walk-in / General"}</td><td data-label="Item / Qty">{products.find(p=>p.id===x.product_id)?.name||"—"}{x.quantity?` × ${qty(x.quantity)}${x.unit_price?` @ ${money(x.unit_price)}`:""}`:""}</td><td data-label="Type">{txLabel[x.type]}</td><td data-label="Gross">{money(x.gross_amount||x.amount)}</td><td data-label="Discount">{x.discount_amount?money(x.discount_amount):"—"}</td><td data-label="Net"><strong>{money(x.amount)}</strong></td><td data-label="Paid">{money(x.paid_amount)}</td><td data-label="Due">{x.amount>x.paid_amount?money(x.amount-x.paid_amount):"—"}</td><td data-label="Status"><span className={`status ${x.status}`}>{x.status}</span></td><td data-label="Action">{canManage?<><button onClick={()=>open("transaction",x)}>Edit</button>{voidTx&&<button className="danger" onClick={()=>voidTx(x.id,x.reference||"Transaction")}>Void</button>}</>:"View only"}</td></tr>)}</tbody></table>}</div>}

function CashLedger({rows,contacts}:{rows:Tx[];contacts:Contact[]}){const cashRows=rows.map(tx=>({tx,in:cashInForTransaction(tx),out:cashOutForTransaction(tx)})).filter(x=>x.in>0||x.out>0);let running=0;const ordered=[...cashRows].reverse().map(x=>{running+=x.in-x.out;return {...x,balance:running}}).reverse();return <article className="panel full"><PanelHead title="Cash ledger" sub="Sirf asal cash movement; unpaid invoices cash nahi"/><div className="tableWrap">{!ordered.length?<Empty text="Koi cash movement nahi"/>:<table><thead><tr><th>Date</th><th>Type</th><th>Naam</th><th>Reference</th><th>Cash In</th><th>Cash Out</th><th>Running Balance</th></tr></thead><tbody>{ordered.map(({tx,in:cin,out,balance})=><tr key={tx.id}><td data-label="Date">{tx.transaction_date}</td><td data-label="Type">{txLabel[tx.type]}</td><td data-label="Naam">{contacts.find(c=>c.id===tx.contact_id)?.name||"General"}</td><td data-label="Reference">{tx.reference||"—"}</td><td data-label="Cash In">{cin?money(cin):"—"}</td><td data-label="Cash Out">{out?money(out):"—"}</td><td data-label="Balance"><b>{money(balance)}</b></td></tr>)}</tbody></table>}</div></article>}

function Reports({accounting,contacts,transactions,products}:{accounting:Accounting;contacts:Contact[];transactions:Tx[];products:Product[]}){const sales=transactions.filter(t=>t.type==="sale"&&!t.is_void),grossSales=sales.reduce((s,t)=>s+Number(t.gross_amount||t.amount),0),discounts=sales.reduce((s,t)=>s+Number(t.discount_amount||0),0),stockCost=products.filter(p=>p.is_active).reduce((s,p)=>s+Number(p.stock_quantity)*Number(p.purchase_price),0),stockSale=products.filter(p=>p.is_active).reduce((s,p)=>s+Number(p.stock_quantity)*Number(p.sale_price),0);return <><div className="reportHero"><div><small>LIVE BUSINESS HEALTH</small><h2>{accounting.netProfit>=0?"Business operating profit positive hai":"Expenses aur margins review karein"}</h2><p>Net sale, historical COGS, discounts aur expenses se calculation.</p></div><strong>{money(accounting.netProfit)}<small>Net operating profit</small></strong></div><div className="reportGrid"><article className="panel"><PanelHead title="Profit summary" sub="Gross sales − discount − COGS − expenses"/><div className="reportRows"><p><span>Gross sales</span><b>{money(grossSales)}</b></p><p><span>Sale discounts</span><b>{money(discounts)}</b></p><p><span>Net sales revenue</span><b>{money(accounting.saleRevenue)}</b></p><p><span>Cost of goods sold</span><b>{money(accounting.cogs)}</b></p><p><span>Gross profit</span><b>{money(accounting.grossProfit)}</b></p><p><span>Expenses</span><b>{money(accounting.expenses)}</b></p><p className="total"><span>Net operating profit</span><b>{money(accounting.netProfit)}</b></p></div></article><article className="panel"><PanelHead title="Cash summary" sub="Paid cash only"/><div className="reportRows"><p><span>Cash in</span><b>{money(accounting.cashIn)}</b></p><p><span>Cash out</span><b>{money(accounting.cashOut)}</b></p><p className="total"><span>Cash balance</span><b>{money(accounting.cashBalance)}</b></p></div></article></div><div className="reportGrid"><article className="panel"><PanelHead title="Receivables & payables" sub="Opening + invoice due − payments"/><div className="reportRows"><p><span>Customers se wasooli</span><b>{money(accounting.receivables)}</b></p><p><span>Suppliers ko adayegi</span><b>{money(accounting.payables)}</b></p><p><span>Customer advance</span><b>{money(accounting.customerAdvance)}</b></p><p><span>Supplier advance</span><b>{money(accounting.supplierAdvance)}</b></p></div></article><article className="panel"><PanelHead title="Stock valuation" sub="Current quantity × rate"/><div className="reportRows"><p><span>Stock cost value</span><b>{money(stockCost)}</b></p><p><span>Expected sale value</span><b>{money(stockSale)}</b></p><p><span>Potential gross margin</span><b>{money(stockSale-stockCost)}</b></p><p><span>Transactions</span><b>{transactions.filter(t=>!t.is_void).length}</b></p></div></article></div></>}

function Settings({business,role,members,audit,loading,reloadBusiness,reloadSettings}:{business:Business;role:Role|"";members:Member[];audit:Audit[];loading:boolean;reloadBusiness:()=>void;reloadSettings:()=>void}){const [message,setMessage]=useState("");async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget);const r=await supabase.rpc("owner_update_business_profile",{p_business_id:business.id,p_name:String(f.get("name")||"").trim(),p_phone:String(f.get("phone")||"").trim(),p_address:String(f.get("address")||"").trim(),p_tax_number:String(f.get("tax")||"").trim(),p_invoice_prefix:String(f.get("prefix")||"INV").trim().toUpperCase()});setMessage(r.error?r.error.message:"Business settings update ho gayin");if(!r.error)reloadBusiness()}async function addMember(e:FormEvent<HTMLFormElement>){e.preventDefault();const form=e.currentTarget,f=new FormData(form);const r=await supabase.rpc("owner_add_member_for_business",{p_business_id:business.id,p_email:String(f.get("email")||""),p_role:String(f.get("role")||"staff")});setMessage(r.error?r.error.message:"Team member add ho gaya");if(!r.error){form.reset();reloadSettings()}}async function removeMember(id:string){if(!confirm("Team member remove karna hai?"))return;const r=await supabase.rpc("owner_remove_member_for_business",{p_business_id:business.id,p_user_id:id});setMessage(r.error?r.error.message:"Member remove ho gaya");if(!r.error)reloadSettings()}return <><div className="settingsSummary"><div><small>CURRENT PLAN</small><b>{business.plan}</b><span>{business.max_members} members · {business.max_monthly_transactions} monthly entries</span></div><div><small>ACCOUNT STATUS</small><b className={business.status}>{business.status}</b><span>{business.plan_expires_at?`Expires ${new Date(business.plan_expires_at).toLocaleDateString("en-PK")}`:"No expiry"}</span></div></div>{message&&<div className="settingsMessage">{message}</div>}{loading&&<div className="settingsMessage">Team aur activity data load ho raha hai…</div>}<div className="settingsGrid"><article className="panel"><PanelHead title="Business profile" sub="Invoice prefix auto numbering mein use hota hai"/><form className="settingsForm" onSubmit={save}><label>Business naam<input name="name" required minLength={2} defaultValue={business.name} disabled={role!=="owner"}/></label><div className="formRow"><label>Phone<input name="phone" defaultValue={business.phone||""} disabled={role!=="owner"}/></label><label>NTN / Tax number<input name="tax" defaultValue={business.tax_number||""} disabled={role!=="owner"}/></label></div><label>Address<textarea name="address" defaultValue={business.address||""} disabled={role!=="owner"}/></label><label>Invoice prefix<input name="prefix" maxLength={8} defaultValue={business.invoice_prefix} disabled={role!=="owner"}/><small className="fieldHint">Misal INV → INV-000001</small></label>{role==="owner"&&<button className="primary">Settings save karein</button>}</form></article><article className="panel"><PanelHead title="Team management" sub="Member limit database par enforce hoti hai"/>{role!=="owner"?<Empty text="Sirf owner team manage kar sakta hai"/>:<><form className="memberForm" onSubmit={addMember}><input name="email" type="email" required placeholder="Staff ki registered email"/><select name="role"><option value="staff">Staff</option><option value="manager">Manager</option></select><button className="primary">Add</button></form><div className="memberList">{members.map(m=><div key={m.user_id}><span><b>{m.full_name||m.email}</b><small>{m.email} · {m.role}</small></span>{m.role!=="owner"&&<button className="danger" onClick={()=>void removeMember(m.user_id)}>Remove</button>}</div>)}</div></>}</article></div><article className="panel"><PanelHead title="Recent activity" sub="Archive, void aur stock adjustments audit hote hain"/><div className="auditList">{audit.map(a=><div key={a.id}><span><b>{a.action.replaceAll("_"," ")}</b><small>{a.entity_type} · {a.entity_id?.slice(0,8)||"—"}</small></span><time>{new Date(a.created_at).toLocaleString("en-PK")}</time></div>)}{!loading&&!audit.length&&<Empty text="Abhi activity nahi"/>}</div></article></>}

function Shell({title,close,children}:{title:string;close:()=>void;children:ReactNode}){return <div className="overlay"><div className="modal"><header><div><small>SECURE ENTRY</small><h2>{title}</h2></div><button aria-label="Close" onClick={close}>×</button></header>{children}</div></div>}
function ContactModal({businessId,item,busy,setBusy,close,done}:{businessId:string;item:Contact|null;busy:boolean;setBusy:(v:boolean)=>void;close:()=>void;done:()=>void}){const [message,setMessage]=useState("");async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setBusy(true);setMessage("");const f=new FormData(e.currentTarget),fields={type:String(f.get("type")||"customer"),name:String(f.get("name")||"").trim(),phone:String(f.get("phone")||"").trim()||null,email:String(f.get("email")||"").trim()||null,opening_balance:Number(f.get("balance")||0),notes:String(f.get("notes")||"").trim()||null};const q=item?supabase.from("contacts").update(fields).eq("id",item.id).eq("business_id",businessId):supabase.from("contacts").insert({...fields,business_id:businessId});const r=await q;setBusy(false);if(r.error)setMessage(r.error.message);else done()}return <Shell title={item?"Khata edit karein":"Naya khata"} close={close}><form onSubmit={submit}><div className="formRow"><label>Type<select name="type" defaultValue={item?.type||"customer"}><option value="customer">Customer</option><option value="supplier">Supplier</option></select></label><label>Naam<input name="name" required minLength={2} defaultValue={item?.name}/></label></div><div className="formRow"><label>Phone<input name="phone" inputMode="tel" defaultValue={item?.phone||""}/></label><label>Email<input name="email" type="email" defaultValue={item?.email||""}/></label></div><label>Opening balance<input name="balance" type="number" step="0.01" defaultValue={item?.opening_balance||0}/><small className="fieldHint">Positive = due, negative = advance. Transaction history ke baad lock ho jata hai.</small></label><label>Notes<textarea name="notes" defaultValue={item?.notes||""}/></label>{message&&<div className="calcError">{message}</div>}<ModalActions busy={busy} close={close}/></form></Shell>}
function StockAdjustmentModal({businessId,item,busy,setBusy,close,done}:{businessId:string;item:Product;busy:boolean;setBusy:(v:boolean)=>void;close:()=>void;done:()=>void}){const [message,setMessage]=useState("");async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();const f=new FormData(e.currentTarget),delta=Number(f.get("delta")||0),reason=String(f.get("reason")||"").trim();if(delta===0)return setMessage("Adjustment zero nahi ho sakta");if(reason.length<3)return setMessage("Reason kam az kam 3 characters ka ho");setBusy(true);const r=await supabase.rpc("adjust_product_stock",{p_business_id:businessId,p_product_id:item.id,p_delta:delta,p_reason:reason});setBusy(false);if(r.error)setMessage(r.error.message);else done()}return <Shell title={`${item.name} stock adjust karein`} close={close}><form onSubmit={submit}><div className="adjustmentSummary"><small>Current stock</small><b>{qty(item.stock_quantity)} {item.unit}</b></div><label>Quantity adjustment<input name="delta" type="number" step="0.001" required placeholder="Example: 5 ya -2"/><small className="fieldHint">Positive = add, negative = minus.</small></label><label>Reason<textarea name="reason" required minLength={3}/></label><p className="modalNote">Purchase/sale ko adjustment se replace na karein; adjustment physical correction/damage ke liye hai.</p>{message&&<div className="calcError">{message}</div>}<ModalActions busy={busy} close={close}/></form></Shell>}
function ModalActions({busy,close}:{busy:boolean;close:()=>void}){return <footer className="modalActions"><button type="button" className="ghost" onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy?"Saving…":"Mehfooz karein"}</button></footer>}
