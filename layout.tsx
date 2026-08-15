import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata={title:"Ledger Pro Professional",description:"Professional Urdu ledger, stock aur accounting dashboard."};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="ur" dir="rtl"><body>{children}</body></html>}
