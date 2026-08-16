"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import "./ui-shell.css";

type PortalTarget = Element | null;
type ModuleItem = { label: string; icon: string };

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

export default function UIShell() {
  const pathname = usePathname();
  const [accountOpen, setAccountOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("Dashboard");
  const [role, setRole] = useState("");
  const [displayName, setDisplayName] = useState("Account");
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [topActionsTarget, setTopActionsTarget] = useState<PortalTarget>(null);
  const [businessHeaderTarget, setBusinessHeaderTarget] = useState<PortalTarget>(null);
  const [settingsTarget, setSettingsTarget] = useState<PortalTarget>(null);
  const [adminHeaderTarget, setAdminHeaderTarget] = useState<PortalTarget>(null);
  const [profileName, setProfileName] = useState("");
  const [profileEmail, setProfileEmail] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;

    let attempts = 0;
    let timer: number | undefined;

    const stopTimer = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };

    const sync = () => {
      const topActions = document.querySelector(".app .topActions");
      const businessHeader = document.querySelector(".app .workspace>header");
      const adminHeader = document.querySelector(".adminApp>section>header");

      if (topActions) setTopActionsTarget(topActions);
      if (businessHeader) setBusinessHeaderTarget(businessHeader);
      if (adminHeader) setAdminHeaderTarget(adminHeader);

      const heading = document.querySelector<HTMLElement>(".app .heading h1");
      const nextSection = heading?.textContent?.trim();
      if (nextSection) setActiveSection(nextSection);
      setSettingsTarget(nextSection === "Settings" ? document.querySelector(".settingsSummary") : null);

      const nextRole = document.querySelector<HTMLElement>(".businessPicker small")?.textContent?.trim();
      if (nextRole) setRole(nextRole);

      const nextDisplayName = document.querySelector<HTMLElement>(".app .topActions .user b")?.textContent?.trim();
      if (nextDisplayName) setDisplayName(nextDisplayName);

      const legacyAdmin = findBusinessNavButton("Super Admin");
      setIsPlatformAdmin(Boolean(legacyAdmin));
      legacyAdmin?.classList.add("shellLegacyAdmin");

      attempts += 1;
      if ((topActions || adminHeader) && attempts >= 4) stopTimer();
      if (attempts >= 30) stopTimer();
    };

    timer = window.setInterval(sync, 100);
    sync();

    const resyncAfterClick = () => window.setTimeout(sync, 0);
    document.addEventListener("click", resyncAfterClick, true);

    return () => {
      stopTimer();
      document.removeEventListener("click", resyncAfterClick, true);
    };
  }, [pathname]);

  useEffect(() => {
    if (!accountOpen) return;
    const close = (event: PointerEvent) => {
      const node = event.target as Node | null;
      if (node && !document.querySelector(".shellAccount")?.contains(node)) setAccountOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [accountOpen]);

  useEffect(() => {
    setProfileLoaded(false);
    setProfileName("");
    setProfileEmail("");
    setProfileMessage("");
  }, [displayName]);

  useEffect(() => {
    if ((!settingsTarget && !accountOpen) || profileLoaded || pathname !== "/") return;
    let active = true;
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setProfileMessage(error.message);
        return;
      }
      setProfileName(String(data.user?.user_metadata?.full_name ?? ""));
      setProfileEmail(data.user?.email ?? "");
      setProfileLoaded(true);
    });
    return () => { active = false; };
  }, [settingsTarget, accountOpen, profileLoaded, pathname]);

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
    await supabase.auth.signOut({ scope: "local" });
    window.location.assign("/");
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

  const accountName = profileName.trim() || displayName;
  const initial = accountName.slice(0, 1).toUpperCase() || "A";

  const businessAccount = topActionsTarget && pathname === "/" ? createPortal(
    <>
      <button className="shellMobileSettings" type="button" aria-label="Settings" onClick={() => goSection("Settings")}>⚙</button>
      <div className="shellAccount">
        <button className="shellAccountTrigger" type="button" aria-expanded={accountOpen} onClick={() => setAccountOpen((value) => !value)}>
          <span className="shellAvatar">{initial}</span>
          <span className="shellAccountCopy"><b>{accountName}</b><small>{role || "account"}</small></span>
          <span className="shellChevron">⌄</span>
        </button>
        {accountOpen ? <div className="shellAccountMenu">
          <div className="shellAccountMeta"><small>ACCOUNT</small><b>{accountName}</b></div>
          <button type="button" onClick={() => goSection("Dashboard")}><span>▦</span><span><b>Business App</b><small>Dashboard par wapas jayein</small></span></button>
          {isPlatformAdmin ? <a href="/admin"><span>♛</span><span><b>Super Admin</b><small>Platform management open karein</small></span></a> : null}
          <button type="button" onClick={() => goSection("Settings")}><span>⚙</span><span><b>Settings & Users</b><small>Business aur team settings</small></span></button>
          <button className="shellDanger" type="button" onClick={() => void logout()}><span>↪</span><span><b>Logout</b><small>Sirf is device se sign out</small></span></button>
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
      <b>{accountName}</b>
      <form onSubmit={(event) => void saveProfile(event)}>
        <label>Display name<input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Apka naam" minLength={2} required /></label>
        <p>Email<span>{profileEmail || "Account email"}</span></p>
        {profileMessage ? <em>{profileMessage}</em> : null}
        <div>
          <button className="shellSave" type="submit" disabled={profileBusy}>{profileBusy ? "Saving…" : "Save Profile"}</button>
          {isPlatformAdmin ? <button className="shellAdminOpen" type="button" onClick={() => window.location.assign("/admin")}>Super Admin</button> : null}
          <button className="shellLogout" type="button" onClick={() => void logout()}>Logout</button>
        </div>
        <p className="shellProfileHint">Logout sirf is device ki session band karega. Dusre laptop/mobile logged in rahenge.</p>
      </form>
    </div>,
    settingsTarget,
  ) : null;

  const adminBack = adminHeaderTarget && pathname === "/admin" ? createPortal(
    <div className="shellAdminAccount">
      <a href="/" className="shellAdminBusiness">← Business App</a>
      <button className="shellAdminLogout" type="button" onClick={() => void logout()}>Logout</button>
    </div>,
    adminHeaderTarget,
  ) : null;

  return <>{businessAccount}{mobileRail}{profileCard}{adminBack}</>;
}
