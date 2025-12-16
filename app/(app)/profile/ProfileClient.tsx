// app/(app)/profile/ProfileClient.tsx

"use client";

import React, { useMemo, useRef, useState, useTransition, useEffect } from "react";
import { uploadProfilePicture, updateName, getMyProfileSettings, logout } from "@/utils/supabase/action";
import { Camera, Save, User } from "lucide-react";
import { ProfileField } from "../../components/ui/ProfileField";
import { toast } from "react-toastify";
import { useSubtitle } from "../AppLayoutClientWrapper";

type Profile = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  created_at: string | null;
  profileUrl: string | null;
  profile_picture_path: string | null;
};

// For exisitng profile state 
export default function ProfileClient({ initialProfile }: { initialProfile: Profile }) {
  const [isEditing, setIsEditing] = useState(false); // view vs edit mode 
  const [isSaving, setIsSaving] = useState(false); // save button 
  const [uploadingPhoto, setUploadingPhoto] = useState(false); // track profile picture upload 
  const [profile, setProfile] = useState<Profile>(initialProfile); // currently saved profile 
  const [editedProfile, setEditedProfile] = useState<Profile>(initialProfile); // data modified by user 
  const fileInput = useRef<HTMLInputElement>(null); // clears file after upload 
  const setHeaderSubtitle = useSubtitle(); // to set subtitles on page 

  // Set the subtitle text
    useEffect(() => {
        setHeaderSubtitle("Manage your profile");
        return () => setHeaderSubtitle(null); // Cleanup 
    }, [setHeaderSubtitle]);


  //Editing name strings if an edit occurs 
  const fullName = useMemo(() => {
    const parts = [profile.first_name, profile.last_name].map(s => (s ?? "").trim()).filter(Boolean);
    return parts.join(" ") || "Logged-in user";
  }, [profile.first_name, profile.last_name]); 


  // Formating date 
  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Unknown";
    return new Date(dateString).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  // Calls getMyProfileSettings() and if successful, updates both (setProfile) and (setEditedProfile) states.
  const refreshProfile= async (): Promise<boolean> => {
    try {
        const res = await getMyProfileSettings();
        if (res.success) {
            setProfile(res.profile);
            setEditedProfile(res.profile);
            return true; // Success! State updated.
        }
        console.error("[refreshProfile] Failed to fetch profile:", res.error);
        return false; // If res.success is false
    } catch (e) 
    {
        console.error("[refreshProfile] Network error during refresh:", e);
        return false; // Error during the network call
    }
  };

  // Creates the changes made by the user to the database
  const handleSave = async () => {
    setIsSaving(true);
    try {
        const res = await updateName(editedProfile.first_name, editedProfile.last_name);
        if (!res.success) throw new Error(res.error);
        const successfulRefresh = await refreshProfile();
        // If the update was successful but the refresh failed, use the local state to ensure the UI reflects the change.
        if (!successfulRefresh) {
            console.warn("[handleSave] Profile refresh failed, updating state locally for UI consistency.");
            setProfile(editedProfile);
        }
        setIsEditing(false);
        toast.success("Profile details updated successfully!");

    } catch (e: any) {
      console.error(e);

      toast.error(`Failed to save changes: ${e.message}`);

    } finally {
      setIsSaving(false);
    }
  };

  // Discards unsaved changes.
  const handleCancel = () => {
    setEditedProfile(profile);
    setIsEditing(false);
  };

  return (
    <>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/*Profile Settings Content */}
        
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Profile Settings</h2>
            <p className="text-gray-600">Manage your account information</p>
          </div>

          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="px-4 py-2 bg-orange-600 text-white font-medium rounded-lg hover:bg-orange-700 transition-colors"
            >
              Edit Profile
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleCancel}
                disabled={isSaving}
                className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 bg-orange-600 text-white font-medium rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isSaving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4" />
                    Save Changes
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Profile Picture */}
        <div className="bg-white rounded-xl shadow-sm border border-orange-100 p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Profile Picture</h3>
          <div className="flex items-center gap-6">
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center overflow-hidden">
                {profile.profileUrl ? (
                  <img src={profile.profileUrl} alt="Profile" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-12 h-12 text-white" />
                )}
              </div>
              
              {isEditing && (
                <label className="absolute bottom-0 right-0 p-2 bg-orange-600 text-white rounded-full cursor-pointer hover:bg-orange-700 transition-colors">
                  <Camera className="w-4 h-4" />
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;

                      setUploadingPhoto(true);
                      try {
                        const fd = new FormData();
                        fd.append("file", file);

                        const res = await uploadProfilePicture(fd);
                        if (!res.success) throw new Error(res.error);

                        await refreshProfile();
                        toast.success("Profile picture uploaded!");
                        
                      } catch (err: any) {
                        console.error(err);
                        toast.error(`Photo upload failed: ${err.message}`);
                        
                      } finally {
                        setUploadingPhoto(false);
                        if (fileInput.current) fileInput.current.value = "";
                      }
                    }}
                  />
                </label>
              )}
              {uploadingPhoto && (
                <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            <div>
              <p className="text-sm text-gray-600 mb-1">JPG, PNG or WEBP (max. 5 MB)</p>
              <p className="text-xs text-gray-500">Recommended: Square image, at least 400×400px</p>
            </div>
          </div>
        </div>

        {/* Personal Information */}
        <div className="bg-white rounded-xl shadow-sm border border-orange-100 p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Personal Information</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {/* First Name Field */}
            <ProfileField
              label="First Name"
              value={isEditing ? editedProfile.first_name : profile.first_name}
              isEditing={isEditing}
              onChange={(newValue) => setEditedProfile((prev) => ({ ...prev, first_name: newValue }))}
            />

            {/* Last Name Field */}
            <ProfileField
              label="Last Name"
              value={isEditing ? editedProfile.last_name : profile.last_name}
              isEditing={isEditing}
              onChange={(newValue) => setEditedProfile((prev) => ({ ...prev, last_name: newValue }))}
            />
            
            {/* Email Field */}
            <div className="md:col-span-2">
              <ProfileField
                label="Email"
                value={profile.email}
                isEditing={false} // email is read-only
              />
            </div>
          </div>
        </div>

        {/* Account Info */}
        <div className="bg-white rounded-xl shadow-sm border border-orange-100 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Account Information</h3>

          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between py-2 border-b border-gray-100">
              <span className="text-gray-600">Member since</span>
              <span className="font-medium text-gray-900">{formatDate(profile.created_at)}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-600">Account ID</span>
              <span className="font-mono text-xs text-gray-500">{profile.id}</span>
            </div>
          </div>
        </div>
    
      </div> 
    </>
  );
}