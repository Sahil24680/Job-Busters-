// app/components/sidebarSideBarFooter.tsx
"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import {User as UserIcon} from "lucide-react";


// Closing Menu on Outside Click 
const useOutsideClick = (ref: React.RefObject<HTMLElement | null>, handler: () => void) => {
  useEffect(() => {
    const listener = (event: MouseEvent) => {
      // Do nothing if clicking ref's element or descendant elements
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return;
      }
      handler();
    };
    document.addEventListener("mousedown", listener);
    return () => {
      document.removeEventListener("mousedown", listener);
    };
  }, [ref, handler]);
};


type SidebarFooterFields = { 
  email: string;
  fullName?: string | null;
  onLogout: () => Promise<void>;
  isLoggingOut: boolean;
  profileUrl?: string | null;
   
};

export function SidebarFooter({
  fullName,
  email,
  onLogout,
  isLoggingOut,
  profileUrl,
}: SidebarFooterFields) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // Ref to attach the outside-click listener to the entire menu area
  const menuRef = useRef<HTMLDivElement>(null); 
  // Closes the menu when the user clicks anywhere outside of the footer area
  useOutsideClick(menuRef, () => setIsMenuOpen(false));


  // Calculation for display name and initial
  const { displayName, initial } = useMemo(() => {
    const name = fullName || email || "Logged-in user";
    const initialSource = fullName || email || "?";
    
    return {
      displayName: name,
      initial: initialSource[0]?.toUpperCase(),
    };
  }, [fullName, email]);
  
  return (
    <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-800">
      <div className="relative" ref={menuRef}>
        
        <button
          type="button"
          onClick={() => setIsMenuOpen((prev) => !prev)}
          className="flex w-full items-center gap-3 p-2 rounded-lg bg-slate-900/80 hover:bg-slate-800 transition-colors text-left focus:outline-none focus:ring-2 focus:ring-orange-500"
        >
          {/* avatar */}
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full bg-orange-600 text-sm font-semibold text-white overflow-hidden flex-shrink-0"
          >
          {profileUrl ? (
            <img src={profileUrl} alt={`${displayName} avatar`} className="w-full h-full object-cover" />
          ) : initial ? (
            initial
          ) : (
            <UserIcon className="w-5 h-5" />
          )}
          </div>

          {/* text */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{displayName}</p>
            {email && <p className="text-xs text-slate-400 truncate">{email}</p>}
          </div>
        </button>

        {/* dropdown menu */}
        {isMenuOpen && (
          // Adjusted positioning for the dropdown menu
          <div className="absolute bottom-[4.5rem] left-0 right-0 mx-4 w-auto rounded-lg border border-slate-700 bg-slate-950 shadow-2xl z-20"> 
            
            <Link
              href="/profile"
              className="block px-3 py-2 text-xs text-slate-100 hover:bg-slate-800 rounded-t-lg"
              onClick={() => setIsMenuOpen(false)}
            >
              View profile
            </Link>
            
            <button
              type="button"
              onClick={async () => {
                setIsMenuOpen(false);
                await onLogout();
              }}
              disabled={isLoggingOut}
              className="block w-full px-3 py-2 text-left text-xs text-red-300 hover:bg-slate-800 rounded-b-lg disabled:text-slate-500"
            >
              {isLoggingOut ? "Logging out..." : "Logout"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}