// components/layout/AppHeader.tsx


"use client";

import { Menu } from "lucide-react";

type AppHeaderProps = {
  subtitle?: string;   // Small line under the logo 
  onOpenSidebar: () => void;   // Called when the left menu button is clicked 
  onLogout?: () => Promise<void>; //Called when Logout is clicked (optional) */
  isLoggingOut?: boolean;
};

export function AppHeader({
  subtitle,
  onOpenSidebar,
  onLogout,
  isLoggingOut = false,
}: AppHeaderProps) {

    // Determine if the logout button should be displayed
    const shouldShowLogout = !!onLogout;


  return (
    <header className="sticky top-0 z-30 bg-white border-b border-orange-100 shadow-sm">
      <div className="relative flex items-center justify-center h-16 px-4 sm:px-6 lg:px-8">
        {/* menu button in the nav bar to the left */}
        <button
          onClick={onOpenSidebar}
          className="absolute left-4 p-2 hover:bg-orange-50 rounded-lg transition-colors"
        >
          <Menu className="w-6 h-6 text-gray-700" />
        </button>

        {/* logo in nav bar in the center */}
        <div className="flex flex-col items-center">
          <h1 className="text-2xl font-extrabold tracking-tight leading-tight">
            <span className="text-orange-600">Job</span>{" "}
            <span className="text-slate-900">Busters</span>
          </h1>
          <span className="text-xs text-gray-600">{subtitle}</span>
        </div>

        {/* Logout button in nav bar to the right */}
        {shouldShowLogout && (
                    <button
                    onClick={onLogout}
                    disabled={isLoggingOut}
                    className="absolute right-4 px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed"
                    >
                    {isLoggingOut ? "Logging out..." : "Logout"}
                    </button>
                )}
      </div>
    </header>
  );
}
