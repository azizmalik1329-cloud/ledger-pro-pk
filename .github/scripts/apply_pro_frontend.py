from pathlib import Path

path=Path('Ledger-Pro-PK-Vercel-v2/app/page.tsx')
s=path.read_text()

def rep(old,new,label):
    global s
    if old not in s:
        raise SystemExit(f'Patch target missing: {label}')
    s=s.replace(old,new,1)

rep('import { cashInForTransaction, cashOutForTransaction, summarizeAccounting } from "@/lib/accounting";\n',
    'import { cashInForTransaction, cashOutForTransaction, summarizeAccounting } from "@/lib/accounting";\nimport { localDateInputValue } from "@/lib/pricing";\nimport ProTransactionModal from "./pro-transaction-modal";\nimport ProProductModal from "./pro-product-modal";\n', 'imports')

rep('type Tx = { id:string; business_id:string; contact_id:string|null; product_id:string|null; quantity:number|null; type:"sale"|"purchase"|"payment_in"|"payment_out"|"expense"; reference:string|null; amount:number; paid_amount:number; cost_amount:number; transaction_date:string; notes:string|null; status:"paid"|"partial"|"unpaid"; is_void:boolean; voided_at:string|null; voided_by:string|null; void_reason:string|null; created_at:string };',
    'type Tx = { id:string; business_id:string; contact_id:string|null; product_id:string|null; quantity:number|null; type:"sale"|"purchase"|"payment_in"|"payment_out"|"expense"; reference:string|null; unit_price:number; gross_amount:number; discount_type:"none"|"amount"|"percent"; discount_value:number; discount_amount:number; amount:number; paid_amount:number; unit_cost:number; cost_amount:number; transaction_date:string; notes:string|null; status:"paid"|"partial"|"unpaid"; is_void:boolean; voided_at:string|null; voided_by:string|null; void_reason:string|null; created_at:string };', 'Tx type')

rep('const today=()=>new Date().toISOString().slice(0,10);','const today=()=>localDateInputValue();','local date')

rep('    setIsPlatformAdmin(Boolean(platformAdmin));\n    if(error||adminError){\n      setAccountError(error?.message||adminError?.message||"Account load nahi ho saka.");\n      setAccountResolved(true);setAccountLoading(false);return;\n    }',
    '    setIsPlatformAdmin(adminError?false:Boolean(platformAdmin));\n    if(error){\n      setAccountError(error.message||"Account load nahi ho saka.");\n      setAccountResolved(true);setAccountLoading(false);return;\n    }', 'admin bootstrap isolation')

rep('    localStorage.setItem("ledger-business-id",bid);\n    setBusinessId(bid);setRole(membership.role);setBusiness(details);setBusinessName(details?.name||"Mera Business");setSearch("");',
    '    localStorage.setItem("ledger-business-id",bid);\n    setContacts([]);setProducts([]);setTransactions([]);\n    setBusinessId(bid);setRole(membership.role);setBusiness(details);setBusinessName(details?.name||"Mera Business");setSearch("");', 'business switch clear')

rep('    if(c.error||p.error||t.error)toast(c.error?.message||p.error?.message||t.error?.message||"Data load error");\n    setContacts((c.data||[]) as Contact[]);setProducts((p.data||[]) as Product[]);setTransactions((t.data||[]) as Tx[]);',
    '    if(c.error||p.error||t.error){\n      setAccountError(c.error?.message||p.error?.message||t.error?.message||"Financial data load nahi ho saka.");\n      setAccountResolved(true);setAccountLoading(false);return;\n    }\n    setContacts((c.data||[]) as Contact[]);setProducts((p.data||[]) as Product[]);setTransactions((t.data||[]) as Tx[]);', 'partial data block')

rep('    if(!window.confirm(`${label} delete karna hai?`))return;\n    const {error}=await supabase.from("products").delete().eq("id",id).eq("business_id",businessId);\n    if(error)return toast(error.message);toast("Unused product delete ho gaya");void reloadProducts();',
    '    if(!window.confirm(`${label} ko archive karna hai? Product history mehfooz rahegi. Stock pehle zero hona chahiye.`))return;\n    const {error}=await supabase.rpc("archive_product",{p_business_id:businessId,p_product_id:id});\n    if(error)return toast(error.message);toast("Product archive ho gaya");void reloadProducts();', 'product archive')

rep('    const rows=[["Date","Type","Reference","Contact","Product","Quantity","Amount","Paid","Cost","Status"],...transactions.map(t=>[t.transaction_date,txLabel[t.type],t.reference||"",contacts.find(c=>c.id===t.contact_id)?.name||"",products.find(p=>p.id===t.product_id)?.name||"",t.quantity||"",t.amount,t.paid_amount,t.cost_amount,t.status])];',
    '    const rows=[["Date","Type","Reference","Contact","Product","Quantity","Unit Rate","Gross","Discount","Net Amount","Paid","Due","Cost","Status"],...transactions.map(t=>[t.transaction_date,txLabel[t.type],t.reference||"",contacts.find(c=>c.id===t.contact_id)?.name||"",products.find(p=>p.id===t.product_id)?.name||"",t.quantity||"",t.unit_price||"",t.gross_amount||t.amount,t.discount_amount||0,t.amount,t.paid_amount,Math.max(0,t.amount-t.paid_amount),t.cost_amount,t.status])];', 'CSV professional fields')

rep('{modal==="product"&&<ProductModal businessId={businessId} item={editing as Product|null} busy={busy} setBusy={setBusy} close={close} done={()=>{close();toast("Product mehfooz ho gaya");void reloadProducts()}}/>}',
    '{modal==="product"&&<ProProductModal businessId={businessId} item={editing as Product|null} busy={busy} setBusy={setBusy} close={close} done={()=>{close();toast("Product mehfooz ho gaya");void reloadProducts()}}/>}', 'professional product modal')

rep('{modal==="transaction"&&<TransactionModal businessId={businessId} item={editing as Tx|null} defaultType={defaultTxType} contacts={contacts} products={products} busy={busy} setBusy={setBusy} close={close} done={()=>{close();toast("Transaction aur stock update ho gaye");void reloadTransactionsAndProducts()}}/>}',
    '{modal==="transaction"&&<ProTransactionModal businessId={businessId} item={editing as Tx|null} defaultType={defaultTxType} contacts={contacts} products={products} busy={busy} setBusy={setBusy} close={close} done={()=>{close();toast("Transaction, calculation aur stock update ho gaye");void reloadTransactionsAndProducts()}}/>}', 'professional transaction modal')

rep('<button className="danger" onClick={()=>remove("products",x.id,x.name)}>Delete</button>',
    '<button className="danger" onClick={()=>remove("products",x.id,x.name)}>Archive</button>', 'product archive label')

rep('<p className="purchaseRate">Current purchase rate: <b>{money(x.purchase_price)}</b></p>',
    '<p className="purchaseRate">Purchase: <b>{money(x.purchase_price)}</b> / {x.unit} · Sale: <b>{money(x.sale_price)}</b> / {x.unit} · Margin: <b>{money(Number(x.sale_price)-Number(x.purchase_price))}</b> / {x.unit}</p>', 'product margin')

old='<table><thead><tr><th>Date</th><th>Reference</th><th>Naam</th><th>Item / Qty</th><th>Type</th><th>Amount</th><th>Paid</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td data-label="Date">{x.transaction_date}</td><td data-label="Reference"><b>{x.reference||"—"}</b></td><td data-label="Naam">{contacts.find(c=>c.id===x.contact_id)?.name||"Walk-in / General"}</td><td data-label="Item / Qty">{products.find(p=>p.id===x.product_id)?.name||"—"}{x.quantity?` × ${x.quantity}`:""}</td><td data-label="Type">{txLabel[x.type]}</td><td data-label="Amount"><strong>{money(x.amount)}</strong></td><td data-label="Paid">{money(x.paid_amount)}</td><td data-label="Status"><span className={`status ${x.status}`}>{x.status}</span></td><td data-label="Action">{canManage?<><button onClick={()=>open("transaction",x)}>Edit</button>{remove&&<button className="danger" onClick={()=>remove("transactions",x.id,x.reference||"Transaction")}>Void</button>}</>:"View only"}</td></tr>)}</tbody></table>'
new='<table><thead><tr><th>Date</th><th>Reference</th><th>Naam</th><th>Item / Qty</th><th>Type</th><th>Gross</th><th>Discount</th><th>Net</th><th>Paid</th><th>Due</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td data-label="Date">{x.transaction_date}</td><td data-label="Reference"><b>{x.reference||"—"}</b></td><td data-label="Naam">{contacts.find(c=>c.id===x.contact_id)?.name||"Walk-in / General"}</td><td data-label="Item / Qty">{products.find(p=>p.id===x.product_id)?.name||"—"}{x.quantity?` × ${x.quantity}${x.unit_price?` @ ${money(x.unit_price)}`:""}`:""}</td><td data-label="Type">{txLabel[x.type]}</td><td data-label="Gross">{money(x.gross_amount||x.amount)}</td><td data-label="Discount">{x.discount_amount?money(x.discount_amount):"—"}</td><td data-label="Net"><strong>{money(x.amount)}</strong></td><td data-label="Paid">{money(x.paid_amount)}</td><td data-label="Due">{x.amount>x.paid_amount?money(x.amount-x.paid_amount):"—"}</td><td data-label="Status"><span className={`status ${x.status}`}>{x.status}</span></td><td data-label="Action">{canManage?<><button onClick={()=>open("transaction",x)}>Edit</button>{remove&&<button className="danger" onClick={()=>remove("transactions",x.id,x.reference||"Transaction")}>Void</button>}</>:"View only"}</td></tr>)}</tbody></table>'
rep(old,new,'transaction table details')

path.write_text(s)
print('page.tsx professional integration applied')
