// app/(app)/AppLayoutClientWrapper.tsx
"use client";

import React, { useState, useContext, createContext } from 'react';
import { Sidebar } from "../components/layout/SideBar"; 
import { AppHeader } from "../components/layout/AppHeader";


type AppLayoutClientWrapperProps = {
    profile: ProfileDataForClient;
    children: React.ReactNode;
    onLogoutServerAction: () => Promise<void>; 
};

export type ProfileDataForClient = {
  name: string | null;
  email: string;
  profileUrl: string | null;
};

interface SubtitleContextType {
    subtitle: string | null;
    setSubtitle: (text: string | null) => void;
}

const SubtitleContext = createContext<SubtitleContextType | undefined>(undefined);

// for children to update their subtitle
export const useSubtitle = () => {
    const context = useContext(SubtitleContext);
    if (context === undefined) {
        throw new Error('useSubtitle must be used within a SubtitleProvider');
    }
    return context.setSubtitle;
};

export function AppLayoutClientWrapper({ profile, children, onLogoutServerAction }: AppLayoutClientWrapperProps) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [dynamicSubtitle, setDynamicSubtitle] = useState<string | null>(null);

    // Default subtitle
    const headerSubtitle = dynamicSubtitle || 'Welcome to Job Busters';

    // This handles the client-side logging out state
    const handleLogout = async () => {
        setIsLoggingOut(true);
        try {
            await onLogoutServerAction();
        } finally {
            setIsLoggingOut(false);
        }
    };

return (
    <SubtitleContext.Provider value={{ subtitle: headerSubtitle, setSubtitle: setDynamicSubtitle }}>
        <div className="min-h-screen bg-gradient-to-br from-orange-50 to-white"> 
                
            <AppHeader
                subtitle={headerSubtitle}
                onOpenSidebar={() => setSidebarOpen(prev => !prev)}
                onLogout={handleLogout}
                isLoggingOut={isLoggingOut}
            />

            <main className="flex-1 overflow-y-auto pt-16 p-4 md:p-8">
                {children}
            </main>

            <Sidebar
               isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
                fullName={profile.name}
                email={profile.email}
                profileUrl={profile.profileUrl}
                onLogout={handleLogout}
                isLoggingOut={isLoggingOut}
            />
        </div>
    </SubtitleContext.Provider>
);}