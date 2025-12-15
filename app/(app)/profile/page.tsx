// app/(app)/profile/page.tsx
//Server component 

import { getMyProfileSettings } from "@/utils/supabase/action";
import { redirect } from 'next/navigation';
import ProfileClient from './ProfileClient'; 

export default async function ProfilePage() {
    const res = await getMyProfileSettings();

    // Authentication check (Redirect if not logged in)
    if (!res.success) {
        if (res.error?.includes("Not authenticated")) {
            redirect('/auth/login');
        }
        // Handle other fatal errors if the layout didn't catch them
        return <div>Error loading profile data: {res.error}</div>;
    }

    // Pass the successfully fetched profile data to the client component
    return <ProfileClient initialProfile={res.profile} />;
}