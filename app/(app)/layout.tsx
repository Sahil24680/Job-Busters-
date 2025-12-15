// app/(app)/layout.tsx

import { getMyProfileSettings, logout} from "@/utils/supabase/action";
import { redirect } from 'next/navigation';
import { AppLayoutClientWrapper, ProfileDataForClient } from './AppLayoutClientWrapper';

//// Type definition for the content passed inside the <AppLayout> tags.
type LayoutProps = {
  children: React.ReactNode;
};

export default async function AppLayout({ children }: LayoutProps) {
  // fetching and authenticating data 
  const res = await getMyProfileSettings();

// ideally this check shouldnt be hit bc getMyProfileSettings() should only return a full profile if successful 
    if (!res.success) { 
    if (res.error?.includes("Not authenticated")) { 
        redirect('/auth/login?error=unauthenticated')
    }
    // Fallback display for any other error
    return (
        <div className="min-h-screen bg-gray-100 flex items-center justify-center">
            <div className="max-w-xl p-8 bg-white shadow-xl rounded-lg border-l-4 border-red-500">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">System Error</h2>
                <p className="text-gray-600">We couldn't load your account. Please try refreshing the page.</p>
                <p className="text-sm text-gray-500 mt-4">Details: {res.error}</p>
            </div>
        </div>
      );
    }

  // res is { success: true; profile: Profile; }
    const profile = res.profile;
    const profileDataForClient: ProfileDataForClient = {
    name: profile.first_name || null,  // sideBarFooter needs the name in 1 field so we just use first name for initial 
    email: profile.email ?? "",
    profileUrl: profile.profileUrl ?? null,
  };
  // Create a server action wrapper for the client component to call.
  const logoutServerAction = async () => {
    'use server';
    await logout();
  }

  return (
    <AppLayoutClientWrapper 
    profile={profileDataForClient} 
        onLogoutServerAction={logoutServerAction}
    >
        {children}
    </AppLayoutClientWrapper>
  );
}