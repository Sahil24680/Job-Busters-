// app/components/layout/Sidebar.tsx
"use client";

import Link from "next/link";
import { X, Home, Briefcase, User } from "lucide-react";
import { SidebarFooter } from "@/app/components/sidebar/SideBarFooter";
import { usePathname } from "next/navigation";


type SidebarFields = {
  isOpen: boolean;
  onClose: () => void;
  fullName: string | null;
  email: string;
  onLogout: () => Promise<void>;
  isLoggingOut: boolean;
  profileUrl: string | null;
};

export function Sidebar({
  isOpen,
  onClose,
  fullName,
  email,
  onLogout,
  isLoggingOut,
  profileUrl,
}: SidebarFields) {
  const pathname = usePathname();

  const linkClass = (href: string) =>
    `w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-left ${
      pathname === href
        ? "bg-orange-600 text-white"
        : "hover:bg-slate-800 text-slate-300 hover:text-white"
    }`;

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-slate-900 text-white z-50 transform transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-800">
          <h2 className="text-xl font-bold">
            <span className="text-orange-500">Job</span> Busters
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="p-4 space-y-2">
          <Link href="/" className={linkClass("/")} onClick={onClose}>
            <Home className="w-5 h-5" />
            <span className="font-medium">Analyze Jobs</span>
          </Link>

          <Link href="/my-jobs" className={linkClass("/my-jobs")} onClick={onClose}>
            <Briefcase className="w-5 h-5" />
            <span className="font-medium">My Jobs</span>
          </Link>

          <Link href="/profile" className={linkClass("/profile")} onClick={onClose}>
            <User className="w-5 h-5" />
            <span className="font-medium">Profile</span>
          </Link>
        </nav>

        <SidebarFooter
          email={email}
          fullName={fullName}
          onLogout={async () => {
            onClose();
            await onLogout();
          }}
          isLoggingOut={isLoggingOut}
          profileUrl={profileUrl}
        />
      </aside>
    </>
  );
}