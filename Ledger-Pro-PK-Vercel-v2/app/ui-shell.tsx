"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import "./ui-shell.css";

type PortalTarget = Element | null;
type BootstrapMembership = { business_id: string; role: "owner" | "manager" | "staff" };
type AccountBootstrap = {
  user_id: string | null;
  is_platform_admin: boolean;
  memberships: BootstrapMembership[];
};

type ModuleItem = {
  label: string;
  icon: string;
};

const modules: ModuleItem[] = [
  { label: "Dashboard", icon: "▦" },
  { label: "Khatay", icon: "♙" },
  { label: "Farokht", icon: "↗" },
  { label: "Khareedari", icon: "↙" },
  { label: "Stock", icon: "□" },
  { label: "Cash", icon: "₨" },
  { label: "Reports", icon: "⌁" },
];

function findBusinessNavButton(label: string) {
  if (typeof document === "undefined") return null;
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".app>aside nav button"));
  return buttons.find((button) => button.querySelector("b")?.textContent?.trim() === label) ?? null;
}

function isBusinessBlocked() {
  if (typeof document === "undefined") return false;
  return document.querySelector(".blocked h1")?.textContent?.trim() === "Business linked nahi hai";
}

export default function UIShell() {
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [bootstrap, setBootstrap] = useState<AccountBootstrap | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("Dashboard");
  const [role, setRole] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [topActionsTarget, setTopActionsTarget] = useState<PortalTarget>(null);
  const [businessHeaderTarget, setBusinessHeaderTarget] = useState<PortalTarget>(null);
  const [settingsTarget, setSettingsTarget] = useState<PortalTarget>(null);
  const [adminHeaderTarget, setAdminHeaderTarget] = useState<PortalTarget>(null);
  const [blockedTarget, setBlockedTarget] = useState<PortalTarget>(null);

  useEffect(() => {
    let active = true;
    const applySession = async (nextSession: Session | null) => {
      if (!active) return;
      setSession(nextSession);
      setProfileName(String(nextSession?.user.user_metadata?.full_name ?? ""));
      if (!nextSession) {
        setBootstrap(null);
        setIsPlatformAdmin(false);
        return;
      }

      const { data, error } = await supabase.rpc("current_account_bootstrap");
      if (!active) return;
      if (!error && data && typeof data === "object") {
        const snapshot = data as AccountBootstrap;
        setBootstrap(snapshot);
        setIsPlatformAdmin(Boolean(snapshot.is_platform_admin));
        return;
      }

      const { data: adminFallback } = await supabase.rpc("platform_admin_me");
      if (active) {
        setBootstrap(null);
        setIsPlatformAdmin(Boolean(adminFallback));
      }
    };

    void supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void applySession(nextSession);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session || typeof document === "undefined") return;

    const sync = () => {
      const topActions = document.querySelector(".app .topActions");
      const businessHeader = document.querySelector(".app .workspace>header");
      const adminHeader = document.querySelector(".adminApp>section>header");
      const heading = document.querySelector<HTMLElement>(".app .heading h1");
      const nextSection = heading?.textContent?.trim() || "Dashboard";
      const nextRole = document.querySelector<HTMLElement>(".businessPicker small")?.textContent?.trim() || "";
      const nextSettingsTarget = nextSection === "Settings" ? document.querySelector(".settingsSummary") : null;
      const blocked = isBusinessBlocked() ? document.querySelector(".blocked") : null;

      setTopActionsTarget(topActions);
      setBusinessHeaderTarget(businessHeader);
      setAdminHeaderTarget(adminHeader);
      setSettingsTarget(nextSettingsTarget);
      setBlockedTarget(blocked);
      setActiveSection(nextSection);
      setRole(nextRole);

      const legacyAdmin = findBusinessNavButton("Super Admin");
      legacyAdmin?.classList.add("shellLegacyAdmin");
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [pathname, session]);

  useEffect(() => {
    if (!session || pathname !== "/" || !bootstrap?.memberships?.length || !blockedTarget) return;
    const key = `ledger-account-recovery:${session.user.id}`;
    const timer = window.setTimeout(async () => {
      if (!isBusinessBlocked()) {
        sessionStorage.removeItem(key);
        setRecoveryBusy(false);
        return;
      }
      const attempts = Number(sessionStorage.getItem(key) || "0");
      if (attempts >= 2) {
        setRecoveryMessage("Business access verified hai. Neeche Retry Business App use karein.");
        return;
      }

      sessionStorage.setItem(key, String(attempts + 1));
      setRecoveryBusy(true);
      setRecoveryMessage("Business access verify ho gaya — session sync ho raha hai…");
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        setRecoveryBusy(false);
        setRecoveryMessage(error.message);
        return;
      }
      window.setTimeout(() => {
        if (isBusinessBlocked()) window.location.reload();
        else {
          sessionStorage.removeItem(key);
          setRecoveryBusy(false);
          setRecoveryMessage("");
        }
      }, 350);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [bootstrap, blockedTarget, pathname, session]);

  useEffect(() => {
    if (!accountOpen) return;
    const close = (event: PointerEvent) => {
      const node = event.target as Node | null;
      if (node && !document.querySelector(".shellAccount")?.contains(node)) setAccountOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [accountOpen]);

  if (!session) return null;

  const displayName = profileName.trim() || session.user.email?.split("@")[0] || "Account";
  const initial = displayName.slice(0, 1).toUpperCase();

  function goSection(label: string) {
    setAccountOpen(false);
    if (pathname !== "/") {
      window.location.assign("/");
      return;
    }
    const button = findBusinessNavButton(label);
    if (button) {
      button.click();
      setActiveSection(label);
    }
  }

  async function logout() {
    setAccountOpen(false);
    await supabase.auth.signOut();
  }

  async function retryBusiness() {
    if (recoveryBusy) return;
    setRecoveryBusy(true);
    setRecoveryMessage("Session dobara sync ho raha hai…");
    const { error } = await supabase.auth.refreshSession();
    if (error) {
      setRecoveryBusy(false);
      setRecoveryMessage(error.message);
      return;
    }
    window.setTimeout(() => window.location.reload(), 180);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = profileName.trim();
    if (value.length < 2) {
      setProfileMessage("Naam kam az kam 2 characters ka hona chahiye.");
      return;
    }
    setProfileBusy(true);
    setProfileMessage("");
    const { error } = await supabase.auth.updateUser({ data: { full_name: value } });
    setProfileBusy(false);
    setProfileMessage(error ? error.message : "Profile update ho gaya.");
  }

  const businessAccount = topActionsTarget && pathname === "/" ? createPortal(
    <>
      <button className="shellMobileSettings" type="button" aria-label="Settings" onClick={() => goSection("Settings")}>⚙</button>
      <div className="shellAccount">
        <button className="shellAccountTrigger" type="button" aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)}>
          <span className="shellAvatar">{initial}</span>
          <span className="shellAccountCopy"><b>{displayName}</b><small>{role || "account"}</small></span>
          <span className="shellChevron">⌄</span>
        </button>
        {accountOpen ? <div className="shellAccountMenu">
          <div className="shellAccountMeta"><small>SIGNED IN AS</small><b>{session.user.email}</b></div>
          <button type="button" onClick={() => goSection("Dashboard")}><span>▦</span><span><b>Business App</b><small>Dashboard par wapas jayein</small></span></button>
          {isPlatformAdmin ? <a href="/admin"><span>♛</span><span><b>Super Admin</b><small>Platform management open karein</small></span></a> : null}
          <button type="button" onClick={() => goSection("Settings")}><span>⚙</span><span><b>Settings & Users</b><small>Profile, team aur business</small></span></button>
          <button className="shellDanger" type="button" onClick={() => void logout()}><span>↪</span><span><b>Logout</b><small>Securely sign out</small></span></button>
        </div> : null}
      </div>
    </>,
    topActionsTarget,
  ) : null;

  const mobileRail = businessHeaderTarget && pathname === "/" ? createPortal(
    <nav className="shellMobileRail" aria-label="Business modules">
      {modules.map((item) => <button type="button" key={item.label} className={activeSection === item.label ? "active" : ""} onClick={() => goSection(item.label)}><i>{item.icon}</i><span>{item.label}</span></button>)}
    </nav>,
    businessHeaderTarget,
  ) : null;

  const profileCard = settingsTarget && pathname === "/" ? createPortal(
    <div className="shellProfileCard">
      <small>MY ACCOUNT</small>
      <b>Profile Settings</b>
      <form onSubmit={saveProfile}>
        <label>Display name<input value={profileName} onChange={(event) => setProfileName(event.target.value)} minLength={2} required /></label>
        <p>{session.user.email}<span>{role ? `${role} access` : "Signed-in user"}</span></p>
        {profileMessage ? <em>{profileMessage}</em> : null}
        <div><button className="shellSave" disabled={profileBusy}>{profileBusy ? "Saving…" : "Save profile"}</button><button className="shellLogout" type="button" onClick={() => void logout()}>Logout</button></div>
      </form>
      <span className="shellProfileHint">User Management neeche Team Management mein hai — owner, manager aur staff access wahin manage hota hai.</span>
    </div>,
    settingsTarget,
  ) : null;

  const blockedRecovery = blockedTarget && pathname === "/" && bootstrap ? createPortal(
    <div className="shellBlockedRecovery">
      {bootstrap.memberships.length ? <>
        <small>ACCOUNT VERIFIED</small>
        <h2>{recoveryBusy ? "Business sync ho raha hai…" : "Business access available hai"}</h2>
        <p>{recoveryMessage || `${session.user.email} ka business access database mein verified hai.`}</p>
        <div><button className="shellRetry" type="button" disabled={recoveryBusy} onClick={() => void retryBusiness()}>{recoveryBusy ? "Syncing…" : "↻ Retry Business App"}</button>{isPlatformAdmin ? <a href="/admin">♛ Super Admin</a> : null}<button className="shellRecoveryLogout" type="button" onClick={() => void logout()}>Logout</button></div>
      </> : <>
        <small>ACCOUNT STATUS</small>
        <h2>Business access linked nahi hai</h2>
        <p>{session.user.email}</p>
        <div>{isPlatformAdmin ? <a href="/admin">♛ Super Admin</a> : null}<button className="shellRecoveryLogout" type="button" onClick={() => void logout()}>Logout</button></div>
      </>}
    </div>,
    blockedTarget,
  ) : null;

  const adminAccount = adminHeaderTarget && pathname === "/admin" ? createPortal(
    <div className="shellAdminAccount">
      <a href="/" className="shellAdminBusiness">← Business App</a>
      <div className="shellAccount">
        <button className="shellAccountTrigger shellAdminTrigger" type="button" aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)}>
          <span className="shellAvatar">{initial}</span><span className="shellAccountCopy"><b>{displayName}</b><small>Super Admin</small></span><span className="shellChevron">⌄</span>
        </button>
        {accountOpen ? <div className="shellAccountMenu shellAdminMenu">
          <div className="shellAccountMeta"><small>PLATFORM OWNER</small><b>{session.user.email}</b></div>
          <a href="/"><span>▦</span><span><b>Business App</b><small>Ledger workspace open karein</small></span></a>
          <button className="shellDanger" type="button" onClick={() => void logout()}><span>↪</span><span><b>Logout</b><small>Securely sign out</small></span></button>
        </div> : null}
      </div>
    </div>,
    adminHeaderTarget,
  ) : null;

  return <>{businessAccount}{mobileRail}{profileCard}{blockedRecovery}{adminAccount}</>;
}
